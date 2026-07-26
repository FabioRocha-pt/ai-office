package com.bonako.aioffice

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Um agente e o seu estado atual. */
data class Agente(
    val id: String,
    val nome: String,
    val cli: String,
    val estado: String = "idle",
)

/** Uma plataforma do vault. */
data class Projeto(
    val id: String,
    val nome: String,
    val estado: String,
    val ficheiros: Int,
    val commits: Int,
    val revisoes: Int,
    val abrivel: Boolean,
)

/** Uma stack que o escritório sabe construir. */
data class Stack(
    val id: String,
    val nome: String,
    val resumo: String,
    val pronta: Boolean,
)

/** Um relatório escrito por um agente. */
data class Relatorio(
    val autor: String,
    val titulo: String,
    val texto: String,
)

/** Uma etapa do pipeline, para o histórico. */
data class Etapa(
    val agente: String,
    val nome: String,
    val ok: Boolean,
    val segundos: Int,
    val erro: String?,
)

/** Tudo o que se sabe sobre uma plataforma. */
data class Detalhe(
    val id: String,
    val nome: String,
    val briefing: String,
    val estado: String,
    val ficheiros: Int,
    val commits: Int,
    val abrivel: Boolean,
    val etapas: List<Etapa>,
    val relatorios: List<Relatorio>,
    val github: String?,
)

/** Números para os gráficos. */
data class Estatisticas(
    val projetos: Int = 0,
    val ficheiros: Int = 0,
    val bytes: Long = 0,
    val commits: Int = 0,
    val porAgente: Map<String, Int> = emptyMap(),
    val duracaoMedia: Map<String, Int> = emptyMap(),
    val porExtensao: Map<String, Int> = emptyMap(),
    val acumulado: List<Long> = emptyList(),
)

/**
 * Ligação ao orchestrator.
 *
 * O token vai como cookie e não como cabeçalho: é o mesmo mecanismo que o
 * WebView do vault usa, por isso as duas metades da app partilham a
 * sessão sem duplicar autenticação.
 */
class Cliente(private val baseUrl: String, private val token: String) {

    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)   // 0 = sem limite, o WS fica aberto
        .pingInterval(25, TimeUnit.SECONDS)
        .build()

    private val json = "application/json; charset=utf-8".toMediaType()

    // ---------------- estado observável ----------------

    private val _agentes = MutableStateFlow<List<Agente>>(emptyList())
    val agentes: StateFlow<List<Agente>> = _agentes

    private val _ligado = MutableStateFlow(false)
    val ligado: StateFlow<Boolean> = _ligado

    private val _projetoAtual = MutableStateFlow<String?>(null)
    val projetoAtual: StateFlow<String?> = _projetoAtual

    private val _aCorrer = MutableStateFlow(false)
    val aCorrer: StateFlow<Boolean> = _aCorrer

    private val _consola = MutableStateFlow("")
    val consola: StateFlow<String> = _consola

    // ---------------- REST ----------------

    private fun pedido(caminho: String) = Request.Builder()
        .url("$baseUrl$caminho")
        .header("Cookie", "office_sess=$token")

    private suspend fun get(caminho: String): String? = withContext(Dispatchers.IO) {
        runCatching {
            http.newCall(pedido(caminho).build()).execute().use { r ->
                if (r.isSuccessful) r.body?.string() else null
            }
        }.getOrNull()
    }

    private suspend fun post(caminho: String, corpo: JSONObject): Pair<Boolean, String> =
        withContext(Dispatchers.IO) {
            runCatching {
                val req = pedido(caminho).post(corpo.toString().toRequestBody(json)).build()
                http.newCall(req).execute().use { r ->
                    val texto = r.body?.string() ?: ""
                    val erro = runCatching { JSONObject(texto).optString("error") }.getOrNull()
                    r.isSuccessful to (if (r.isSuccessful) "" else (erro ?: "Falhou (${r.code})"))
                }
            }.getOrElse { false to (it.message ?: "Sem ligação") }
        }

    suspend fun carregarAgentes() {
        val texto = get("/agents") ?: return
        val lista = runCatching {
            val arr = JSONArray(texto)
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                Agente(
                    id = o.getString("id"),
                    nome = o.optString("label", o.getString("id")),
                    cli = o.optString("cli", ""),
                    estado = o.optString("status", "idle"),
                )
            }
        }.getOrNull() ?: return
        _agentes.value = lista
    }

    suspend fun projetos(): List<Projeto> {
        val texto = get("/projects") ?: return emptyList()
        return runCatching {
            val arr = JSONArray(texto)
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                val f = o.optJSONObject("files")
                val g = o.optJSONObject("git")
                val e = o.optJSONObject("entry")
                Projeto(
                    id = o.getString("id"),
                    nome = o.optString("name", o.getString("id")),
                    estado = o.optString("status", "unknown"),
                    ficheiros = f?.optInt("files") ?: 0,
                    commits = g?.optInt("total") ?: 0,
                    revisoes = o.optInt("revisions", 0),
                    abrivel = (e?.optString("type") ?: "none") != "none",
                )
            }
        }.getOrElse { emptyList() }
    }

    suspend fun estatisticas(): Estatisticas {
        val texto = get("/stats") ?: return Estatisticas()
        return runCatching {
            val o = JSONObject(texto)
            val t = o.getJSONObject("totals")

            fun mapaInt(nome: String): Map<String, Int> {
                val m = o.optJSONObject(nome) ?: return emptyMap()
                return m.keys().asSequence().associateWith { m.optInt(it) }
            }

            // linha do tempo -> commits acumulados, para o gráfico de ritmo
            val linha = o.optJSONArray("timeline")
            val acumulado = mutableListOf<Long>()
            if (linha != null) {
                for (i in 0 until linha.length()) {
                    acumulado.add(linha.getJSONObject(i).optLong("at"))
                }
            }

            Estatisticas(
                projetos = t.optInt("projects"),
                ficheiros = t.optInt("files"),
                bytes = t.optLong("bytes"),
                commits = t.optInt("commits"),
                porAgente = mapaInt("byAgent"),
                duracaoMedia = mapaInt("avgDuration"),
                porExtensao = mapaInt("byExt"),
                acumulado = acumulado,
            )
        }.getOrElse { Estatisticas() }
    }

    suspend fun atribuicoes(): Map<String, String> {
        val texto = get("/assignments") ?: return emptyMap()
        return runCatching {
            val m = JSONObject(texto).getJSONObject("assignments")
            m.keys().asSequence().associateWith { m.getString(it) }
        }.getOrElse { emptyMap() }
    }

    suspend fun gravarAtribuicoes(mapa: Map<String, String>): Pair<Boolean, String> {
        val o = JSONObject()
        mapa.forEach { (k, v) -> o.put(k, v) }
        return post("/assignments", o)
    }

    suspend fun construir(briefing: String, complexidade: String, stack: String) =
        post(
            "/pipeline",
            JSONObject().put("brief", briefing)
                .put("complexity", complexidade)
                .put("stack", stack)
        )

    suspend fun corrigir(projeto: String, briefing: String, complexidade: String) =
        post(
            "/projects/$projeto/revise",
            JSONObject().put("brief", briefing).put("complexity", complexidade)
        )

    suspend fun destrancar() = post("/reset", JSONObject())

    suspend fun stacks(): List<Stack> {
        val texto = get("/stacks") ?: return emptyList()
        return runCatching {
            val arr = JSONObject(texto).getJSONArray("stacks")
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                Stack(
                    id = o.getString("id"),
                    nome = o.optString("label", o.getString("id")),
                    resumo = o.optString("resumo", ""),
                    pronta = o.optBoolean("prontaParaUsar", true),
                )
            }
        }.getOrElse { emptyList() }
    }

    suspend fun detalhe(id: String): Detalhe? {
        val texto = get("/projects/$id") ?: return null
        return runCatching {
            val o = JSONObject(texto)

            val etapas = mutableListOf<Etapa>()
            o.optJSONArray("stages")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val e = arr.getJSONObject(i)
                    val ini = e.optLong("startedAt")
                    val fim = e.optLong("finishedAt")
                    etapas.add(
                        Etapa(
                            agente = e.optString("agent"),
                            nome = e.optString("label", e.optString("agent")),
                            ok = e.optBoolean("ok"),
                            segundos = if (fim > ini) ((fim - ini) / 1000).toInt() else 0,
                            erro = e.optString("error").ifBlank { null },
                        )
                    )
                }
            }

            val relatorios = mutableListOf<Relatorio>()
            o.optJSONArray("relatorios")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val r = arr.getJSONObject(i)
                    relatorios.add(
                        Relatorio(
                            autor = r.optString("autor"),
                            titulo = r.optString("titulo"),
                            texto = r.optString("texto"),
                        )
                    )
                }
            }

            Detalhe(
                id = o.getString("id"),
                nome = o.optString("name", o.getString("id")),
                briefing = o.optString("brief", ""),
                estado = o.optString("status", "unknown"),
                ficheiros = o.optJSONObject("files")?.optInt("files") ?: 0,
                commits = o.optJSONObject("git")?.optInt("total") ?: 0,
                abrivel = (o.optJSONObject("entry")?.optString("type") ?: "none") != "none",
                etapas = etapas,
                relatorios = relatorios,
                github = o.optJSONObject("github")?.optString("url")?.ifBlank { null },
            )
        }.getOrNull()
    }

    /** Prepara a plataforma e devolve o URL onde a ver. */
    suspend fun lancar(id: String): String? = withContext(Dispatchers.IO) {
        runCatching {
            val req = pedido("/projects/$id/launch")
                .post("{}".toRequestBody(json)).build()
            http.newCall(req).execute().use { r ->
                if (!r.isSuccessful) return@use null
                val u = JSONObject(r.body?.string() ?: "").optString("url")
                when {
                    u.isBlank() -> null
                    u.startsWith("http") -> u
                    else -> "$baseUrl$u"
                }
            }
        }.getOrNull()
    }

    /** Cria o repositório no GitHub e empurra. Devolve o URL ou o erro. */
    suspend fun publicar(id: String, privado: Boolean = true): Pair<String?, String> =
        withContext(Dispatchers.IO) {
            runCatching {
                val corpo = JSONObject().put("privado", privado)
                val req = pedido("/projects/$id/publicar")
                    .post(corpo.toString().toRequestBody(json)).build()
                http.newCall(req).execute().use { r ->
                    val o = JSONObject(r.body?.string() ?: "{}")
                    if (r.isSuccessful) o.optString("url").ifBlank { null } to ""
                    else null to o.optString("error").ifBlank { "Falhou (${r.code})" }
                }
            }.getOrElse { null to (it.message ?: "Sem ligação") }
        }

    suspend fun apagar(id: String): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        runCatching {
            val req = pedido("/projects/$id").delete().build()
            http.newCall(req).execute().use { r ->
                r.isSuccessful to if (r.isSuccessful) "" else "Não consegui apagar (${r.code})"
            }
        }.getOrElse { false to (it.message ?: "Sem ligação") }
    }

    // ---------------- WebSocket ----------------

    private var ws: WebSocket? = null
    private var aFechar = false

    fun ligar() {
        aFechar = false
        abrirSocket()
    }

    fun desligar() {
        aFechar = true
        ws?.close(1000, null)
        ws = null
    }

    private fun abrirSocket() {
        val url = baseUrl.replaceFirst("http", "ws")
        val req = Request.Builder().url(url)
            .header("Cookie", "office_sess=$token")
            .build()

        ws = http.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                _ligado.value = true
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                tratarMensagem(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                _ligado.value = false
                if (!aFechar) reconectar()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                _ligado.value = false
                if (!aFechar) reconectar()
            }
        })
    }

    private fun reconectar() {
        Thread {
            Thread.sleep(2500)
            if (!aFechar) abrirSocket()
        }.start()
    }

    private fun tratarMensagem(texto: String) {
        val m = runCatching { JSONObject(texto) }.getOrNull() ?: return

        when (m.optString("type")) {
            "state" -> {
                val estados = m.optJSONObject("state") ?: return
                _agentes.value = _agentes.value.map { a ->
                    val e = estados.optJSONObject(a.id)?.optString("status") ?: a.estado
                    a.copy(estado = e)
                }
                m.optJSONObject("pipeline")?.let {
                    _aCorrer.value = it.optBoolean("running")
                    _projetoAtual.value = it.optString("project").ifBlank { null }
                }
            }

            "status" -> {
                val id = m.optString("agentId")
                val estado = m.optString("status")
                _agentes.value = _agentes.value.map { if (it.id == id) it.copy(estado = estado) else it }
                if (estado == "working") {
                    val nome = _agentes.value.firstOrNull { it.id == id }?.nome ?: id
                    escrever("\n— $nome —\n")
                }
            }

            "stream" -> escrever(m.optString("chunk"))

            "pipeline" -> {
                when (m.optString("phase")) {
                    "start" -> {
                        _aCorrer.value = true
                        _consola.value = ""
                        _projetoAtual.value = m.optJSONObject("project")?.optString("name")
                    }
                    "end" -> {
                        _aCorrer.value = false
                        val erro = m.optString("error")
                        escrever(if (erro.isNullOrBlank()) "\n— concluído —\n" else "\n— falhou: $erro —\n")
                    }
                }
            }
        }
    }

    private fun escrever(texto: String) {
        if (texto.isEmpty()) return
        val novo = _consola.value + texto
        // Mantém só a cauda: a consola do ecrã exterior mostra duas linhas,
        // guardar megabytes de output não serve para nada.
        _consola.value = if (novo.length > 4000) novo.takeLast(3000) else novo
    }
}
