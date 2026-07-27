package com.bonako.aioffice

import android.annotation.SuppressLint
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import kotlin.math.max
import kotlinx.coroutines.launch

/* ---------------------------------------------------------------------
   Paleta. Preto puro de propósito: o ecrã exterior é AMOLED, e um pixel
   apagado gasta zero e dá mais contraste do que qualquer cinzento.
   --------------------------------------------------------------------- */
val FUNDO = Color(0xFF000000)
val CARTAO = Color(0xFF12151B)
val LINHA = Color(0xFF1F242D)
val TEXTO = Color(0xFFDCE3ED)
val TEXTO_2 = Color(0xFF7B8699)

val CORES = mapOf(
    "ceo" to Color(0xFFF59E0B),
    "cto" to Color(0xFF3B82F6),
    "designer" to Color(0xFF10B981),
    "developer" to Color(0xFF8B5CF6),
    "qa" to Color(0xFFEF4444),
)
val ORDEM = listOf("ceo", "cto", "designer", "developer", "qa")

fun corDe(id: String) = CORES[id] ?: Color(0xFF94A3B8)

fun estadoDe(s: String) = when (s) {
    "working" -> EstadoRobo.TRABALHA
    "done" -> EstadoRobo.PRONTO
    "error" -> EstadoRobo.FALHOU
    else -> EstadoRobo.DORME
}

fun textoEstado(s: String) = when (s) {
    "working" -> "a trabalhar"
    "done" -> "pronto"
    "error" -> "falhou"
    else -> "a dormir"
}

/* ====================================================================
   ESCRITÓRIO — os cinco robôs
   ==================================================================== */

@Composable
fun EcraEscritorio(cliente: Cliente, aoTocar: (Agente) -> Unit) {
    val agentes by cliente.agentes.collectAsState()
    val projeto by cliente.projetoAtual.collectAsState()

    val ordenados = remember(agentes) {
        ORDEM.mapNotNull { id -> agentes.firstOrNull { it.id == id } }
            .ifEmpty { agentes }
    }
    val prontos = ordenados.count { it.estado == "done" }

    // Sem agentes não há nada para desenhar. Antes isto dava um vazio
    // preto e ninguém percebia se era falha de rede, de sessão, ou um bug.
    if (ordenados.isEmpty()) {
        Box(Modifier.fillMaxSize().padding(22.dp), Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Sem resposta do escritório", color = TEXTO,
                    fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(6.dp))
                Text(
                    "Não consegui ler a lista de agentes. Confirma que o " +
                        "orchestrator está a correr e que a sessão continua válida.",
                    color = TEXTO_2, fontSize = 12.sp, textAlign = TextAlign.Center,
                    lineHeight = 17.sp
                )
            }
        }
        return
    }

    Column(
        Modifier.fillMaxSize().padding(horizontal = 10.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp)
    ) {
        // grelha: 3 em cima, 2 em baixo centrados
        Column(
            Modifier.weight(1f).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(
                Modifier.weight(1f).fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                ordenados.take(3).forEach { a ->
                    CartaoRobo(a, Modifier.weight(1f).fillMaxHeight()) { aoTocar(a) }
                }
            }
            Row(
                Modifier.weight(1f).fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Spacer(Modifier.weight(0.5f))
                ordenados.drop(3).take(2).forEach { a ->
                    CartaoRobo(a, Modifier.weight(1f).fillMaxHeight()) { aoTocar(a) }
                }
                Spacer(Modifier.weight(0.5f))
            }
        }

        // linha do projeto
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                projeto ?: "Nenhum a decorrer",
                color = TEXTO, fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            Box(
                Modifier.clip(RoundedCornerShape(7.dp))
                    .background(CARTAO).border(1.dp, LINHA, RoundedCornerShape(7.dp))
                    .padding(horizontal = 9.dp, vertical = 4.dp)
            ) {
                Text("$prontos/5", color = TEXTO_2, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        // A consola vive num composable próprio: assim, quando o texto
        // muda, só ela recompõe — os cinco robôs ficam quietos.
        Consola(cliente)
    }
}

@Composable
private fun Consola(cliente: Cliente) {
    val consola by cliente.consola.collectAsState()
    Box(
        Modifier.fillMaxWidth().height(34.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(CARTAO).border(1.dp, LINHA, RoundedCornerShape(10.dp))
            .padding(horizontal = 9.dp, vertical = 5.dp)
    ) {
        Text(
            consola.takeLast(160).ifBlank { "À espera." },
            color = Color(0xFF9FB0C6), fontSize = 10.sp, lineHeight = 13.sp,
            maxLines = 2, overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
private fun CartaoRobo(a: Agente, modifier: Modifier, aoTocar: () -> Unit) {
    val cor = corDe(a.id)
    val ativo = a.estado != "idle"
    val contorno by animateColorAsState(
        when (a.estado) {
            "working" -> cor
            "done" -> Color(0xFF1E4034)
            "error" -> Color(0xFF4A2020)
            else -> LINHA
        }, tween(300), label = "contorno"
    )

    Box(
        modifier
            .clip(RoundedCornerShape(11.dp))
            .background(if (a.estado == "working") Color(0xFF151A22) else CARTAO)
            .border(1.dp, contorno, RoundedCornerShape(11.dp))
            .clickable { aoTocar() }
    ) {
        Robo(
            estado = estadoDe(a.estado),
            cor = cor,
            semente = a.id.hashCode().toFloat() % 6f,
            modifier = Modifier.fillMaxSize().padding(start = 3.dp, end = 3.dp, top = 3.dp, bottom = 15.dp)
        )
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                .background(FUNDO.copy(alpha = 0.82f))
                .padding(top = 2.dp, bottom = 4.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                a.nome, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold,
                color = if (a.estado == "working") cor else TEXTO,
                maxLines = 1, overflow = TextOverflow.Ellipsis
            )
            Text(
                textoEstado(a.estado), fontSize = 10.sp,
                color = when (a.estado) {
                    "working" -> cor.copy(alpha = 0.9f)
                    "done" -> Color(0xFF34D399)
                    else -> TEXTO_2
                }
            )
        }
    }
}

/* ====================================================================
   GRÁFICOS — nativos e animados
   ==================================================================== */

@Composable
fun EcraGraficos(cliente: Cliente) {
    var s by remember { mutableStateOf(Estatisticas()) }
    var carregou by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        s = cliente.estatisticas()
        carregou = true
    }

    if (!carregou) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Text("A carregar…", color = TEXTO_2, fontSize = 13.sp)
        }
        return
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Kpi("${s.projetos}", "plataformas", Modifier.weight(1f))
                Kpi("${s.ficheiros}", "ficheiros", Modifier.weight(1f))
                Kpi(formatarBytes(s.bytes), "código", Modifier.weight(1f))
            }
        }

        item {
            Painel("Ritmo de produção", "commits acumulados") {
                GraficoArea(s.acumulado, Modifier.fillMaxWidth().height(86.dp))
            }
        }

        item {
            Painel("Quem entregou o quê", "commits por agente") {
                s.porAgente.entries.sortedByDescending { it.value }.forEach { (nome, v) ->
                    BarraAnimada(nome, v.toFloat(), s.porAgente.values.maxOrNull()?.toFloat() ?: 1f,
                        corPorNome(nome), "$v")
                }
            }
        }

        item {
            Painel("Tempo médio por etapa", "quanto demora cada um") {
                val max = s.duracaoMedia.values.maxOrNull()?.toFloat() ?: 1f
                s.duracaoMedia.entries.sortedByDescending { it.value }.forEach { (nome, seg) ->
                    BarraAnimada(nome, seg.toFloat(), max, corPorNome(nome), formatarTempo(seg))
                }
            }
        }

        item {
            Painel("Composição do código", "ficheiros por extensão") {
                val max = s.porExtensao.values.maxOrNull()?.toFloat() ?: 1f
                val paleta = listOf(
                    Color(0xFF3B82F6), Color(0xFF10B981), Color(0xFFF59E0B),
                    Color(0xFF8B5CF6), Color(0xFFEF4444), Color(0xFF06B6D4),
                )
                s.porExtensao.entries.sortedByDescending { it.value }.take(6)
                    .forEachIndexed { i, (ext, v) ->
                        BarraAnimada(".$ext", v.toFloat(), max, paleta[i % paleta.size], "$v")
                    }
            }
        }

        item { Spacer(Modifier.height(4.dp)) }
    }
}

private fun corPorNome(nome: String) = when {
    nome.startsWith("CEO") -> CORES["ceo"]!!
    nome.startsWith("CTO") -> CORES["cto"]!!
    nome.startsWith("Des") -> CORES["designer"]!!
    nome.startsWith("Dev") -> CORES["developer"]!!
    nome.startsWith("QA") -> CORES["qa"]!!
    else -> Color(0xFF94A3B8)
}

@Composable
private fun Kpi(valor: String, etiqueta: String, modifier: Modifier) {
    Box(
        modifier.clip(RoundedCornerShape(11.dp)).background(CARTAO)
            .border(1.dp, LINHA, RoundedCornerShape(11.dp))
            .padding(vertical = 9.dp, horizontal = 8.dp)
    ) {
        Column {
            Text(valor, color = TEXTO, fontSize = 19.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            Text(etiqueta, color = TEXTO_2, fontSize = 10.sp)
        }
    }
}

@Composable
private fun Painel(titulo: String, sub: String, conteudo: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).background(CARTAO)
            .border(1.dp, LINHA, RoundedCornerShape(11.dp)).padding(11.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp)
    ) {
        Text(titulo, color = TEXTO, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Text(sub, color = TEXTO_2, fontSize = 10.sp)
        Spacer(Modifier.height(3.dp))
        conteudo()
    }
}

/** Barra que cresce ao entrar no ecrã. */
@Composable
private fun BarraAnimada(nome: String, valor: Float, max: Float, cor: Color, texto: String) {
    var visivel by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { visivel = true }
    val fracao by animateFloatAsState(
        if (visivel) (valor / max).coerceIn(0f, 1f) else 0f,
        tween(750, easing = FastOutSlowInEasing), label = "barra"
    )

    Row(
        Modifier.fillMaxWidth().padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(nome, color = TEXTO, fontSize = 11.sp, fontWeight = FontWeight.Medium,
            modifier = Modifier.width(74.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Box(
            Modifier.weight(1f).height(8.dp).clip(RoundedCornerShape(99.dp))
                .background(Color(0xFF1B1F26))
        ) {
            Box(
                Modifier.fillMaxHeight().fillMaxWidth(fracao)
                    .clip(RoundedCornerShape(99.dp)).background(cor)
            )
        }
        Text(texto, color = TEXTO_2, fontSize = 10.sp,
            modifier = Modifier.width(46.dp), textAlign = TextAlign.End)
    }
}

/** Área acumulada, desenhada progressivamente. */
@Composable
private fun GraficoArea(marcos: List<Long>, modifier: Modifier) {
    if (marcos.size < 2) {
        Text("Poucos dados para desenhar.", color = TEXTO_2, fontSize = 11.sp)
        return
    }
    var visivel by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { visivel = true }
    val progresso by animateFloatAsState(
        if (visivel) 1f else 0f, tween(900, easing = FastOutSlowInEasing), label = "area"
    )

    val azul = Color(0xFF3B82F6)
    Canvas(modifier) {
        val n = marcos.size
        val minX = marcos.first().toFloat()
        val maxX = marcos.last().toFloat()
        val spanX = max(1f, maxX - minX)

        val ate = (n * progresso).toInt().coerceAtLeast(2)
        val pontos = (0 until ate).map { i ->
            val x = (marcos[i].toFloat() - minX) / spanX * size.width
            val y = size.height - ((i + 1).toFloat() / n) * size.height * 0.92f
            Offset(x, y)
        }

        val linha = Path().apply {
            moveTo(pontos.first().x, pontos.first().y)
            pontos.drop(1).forEach { lineTo(it.x, it.y) }
        }
        val area = Path().apply {
            addPath(linha)
            lineTo(pontos.last().x, size.height)
            lineTo(pontos.first().x, size.height)
            close()
        }
        drawPath(area, azul.copy(alpha = 0.22f))
        drawPath(linha, azul, style = Stroke(width = 2.5f, cap = StrokeCap.Round))
    }
}

fun formatarBytes(b: Long) = when {
    b < 1024 -> "$b B"
    b < 1048576 -> "${b / 1024} KB"
    else -> String.format("%.1f MB", b / 1048576.0)
}

fun formatarTempo(seg: Int) =
    if (seg >= 60) "${seg / 60}m${(seg % 60).toString().padStart(2, '0')}" else "${seg}s"

/* ====================================================================
   VAULT — nativo. O WebView só aparece ao abrir a plataforma em si.
   ==================================================================== */

@Composable
fun EcraVault(
    cliente: Cliente,
    baseUrl: String,
    token: String,
    avisar: (String) -> Unit,
) {
    var lista by remember { mutableStateOf<List<Projeto>>(emptyList()) }
    var carregou by remember { mutableStateOf(false) }
    var aberto by remember { mutableStateOf<Detalhe?>(null) }
    var preview by remember { mutableStateOf<String?>(null) }
    val ambito = rememberCoroutineScope()

    suspend fun recarregar() {
        lista = cliente.projetos()
        carregou = true
    }
    LaunchedEffect(Unit) { recarregar() }

    // 1. a ver a plataforma a funcionar — aqui sim, WebView
    preview?.let { url ->
        VerPlataforma(url) { preview = null }
        return
    }

    // 2. detalhe de uma plataforma
    aberto?.let { d ->
        DetalhePlataforma(
            d = d,
            aoFechar = { aberto = null },
            aoAbrir = {
                ambito.launch {
                    avisar("A preparar…")
                    val url = cliente.lancar(d.id)
                    if (url != null) preview = url else avisar("Não consegui abrir.")
                }
            },
            githubUrl = d.github,
            aoCorrigir = { texto ->
                ambito.launch {
                    val (ok, erro) = cliente.corrigir(d.id, texto, "auto")
                    if (ok) { avisar("A equipa vai corrigir."); aberto = null }
                    else avisar(erro)
                }
            },
            aoPublicar = { privado ->
                ambito.launch {
                    avisar("A publicar…")
                    val (url, erro) = cliente.publicar(d.id, privado)
                    if (url != null) {
                        avisar("Publicado.")
                        cliente.detalhe(d.id)?.let { aberto = it }
                    } else avisar(erro)
                }
            },
            aoAnular = {
                ambito.launch {
                    val (ok, erro) = cliente.apagar(d.id)
                    if (ok) { avisar("Plataforma anulada."); aberto = null; recarregar() }
                    else avisar(erro)
                }
            },
        )
        return
    }

    // 3. lista
    if (!carregou) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Text("A carregar…", color = TEXTO_2, fontSize = 13.sp)
        }
        return
    }
    if (lista.isEmpty()) {
        Box(Modifier.fillMaxSize().padding(22.dp), Alignment.Center) {
            Text(
                "O vault está vazio. Dita um briefing em Construir.",
                color = TEXTO_2, fontSize = 13.sp, textAlign = TextAlign.Center
            )
        }
        return
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        items(lista) { p ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp))
                    .background(CARTAO).border(1.dp, LINHA, RoundedCornerShape(11.dp))
                    .clickable {
                        ambito.launch {
                            val d = cliente.detalhe(p.id)
                            if (d != null) aberto = d else avisar("Não consegui ler o projeto.")
                        }
                    }
                    .padding(horizontal = 11.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(Modifier.size(9.dp).clip(CircleShape).background(corEstado(p.estado)))
                Spacer(Modifier.width(9.dp))
                Column(Modifier.weight(1f)) {
                    Text(p.nome, color = TEXTO, fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        "${p.ficheiros} ficheiros · ${p.commits} commits" +
                            if (p.revisoes > 0) " · ${p.revisoes} alt." else "",
                        color = TEXTO_2, fontSize = 11.sp
                    )
                }
                Text("›", color = TEXTO_2, fontSize = 19.sp)
            }
        }
        item { Spacer(Modifier.height(4.dp)) }
    }
}

fun corEstado(e: String) = when (e) {
    "done" -> Color(0xFF10B981)
    "failed" -> Color(0xFFEF4444)
    "incomplete" -> Color(0xFFF59E0B)
    else -> Color(0xFF8B96A8)
}

@Composable
private fun DetalhePlataforma(
    d: Detalhe,
    aoFechar: () -> Unit,
    aoAbrir: () -> Unit,
    aoCorrigir: (String) -> Unit,
    aoAnular: () -> Unit,
    aoPublicar: (Boolean) -> Unit,
    githubUrl: String?,
) {
    var correcao by remember { mutableStateOf("") }
    var aCorrigir by remember { mutableStateOf(false) }
    var confirmar by remember { mutableStateOf(false) }
    var relatorioAberto by remember { mutableStateOf<Relatorio?>(null) }

    // relatório em ecrã inteiro
    relatorioAberto?.let { r ->
        Column(Modifier.fillMaxSize().padding(horizontal = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("‹", color = TEXTO, fontSize = 22.sp,
                    modifier = Modifier.clickable { relatorioAberto = null }
                        .padding(end = 8.dp))
                Column {
                    Text(r.titulo, color = TEXTO, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    Text(r.autor, color = TEXTO_2, fontSize = 11.sp)
                }
            }
            Spacer(Modifier.height(7.dp))
            Box(
                Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(10.dp))
                    .background(CARTAO).border(1.dp, LINHA, RoundedCornerShape(10.dp))
                    .verticalScroll(rememberScrollState()).padding(11.dp)
            ) {
                Text(r.texto, color = Color(0xFFB9C4D4), fontSize = 11.5.sp, lineHeight = 17.sp)
            }
            Spacer(Modifier.height(6.dp))
        }
        return
    }

    Column(
        Modifier.fillMaxSize().padding(horizontal = 10.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(7.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("‹", color = TEXTO, fontSize = 22.sp,
                modifier = Modifier.clickable { aoFechar() }.padding(end = 8.dp))
            Text(d.nome, color = TEXTO, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                maxLines = 2, overflow = TextOverflow.Ellipsis)
        }

        // ---- o que foi pedido ----
        Coluna("O que pediste") {
            Text(d.briefing.ifBlank { "Sem briefing registado." },
                color = Color(0xFFB9C4D4), fontSize = 12.5.sp, lineHeight = 18.sp)
        }

        // ---- etapas ----
        if (d.etapas.isNotEmpty()) {
            Coluna("Como correu") {
                d.etapas.forEach { e ->
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 3.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            Modifier.size(7.dp).clip(CircleShape)
                                .background(if (e.ok) Color(0xFF10B981) else Color(0xFFEF4444))
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(e.nome, color = TEXTO, fontSize = 12.sp, modifier = Modifier.weight(1f),
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(formatarTempo(e.segundos), color = TEXTO_2, fontSize = 11.sp)
                    }
                    e.erro?.let {
                        Text(it, color = Color(0xFFEF4444), fontSize = 10.5.sp,
                            modifier = Modifier.padding(start = 15.dp, bottom = 3.dp))
                    }
                }
            }
        }

        // ---- relatórios dos agentes ----
        if (d.relatorios.isNotEmpty()) {
            Coluna("Relatórios") {
                d.relatorios.forEach { r ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
                            .clickable { relatorioAberto = r }
                            .padding(vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(r.titulo, color = TEXTO, fontSize = 12.5.sp,
                                fontWeight = FontWeight.Medium)
                            Text(r.autor, color = TEXTO_2, fontSize = 10.5.sp)
                        }
                        Text("›", color = TEXTO_2, fontSize = 17.sp)
                    }
                }
            }
        }

        // ---- ações ----
        Botao(if (d.abrivel) "Abrir plataforma" else "Nada para abrir",
            destaque = true, ativo = d.abrivel) { aoAbrir() }

        Botao(if (aCorrigir) "Cancelar correção" else "Corrigir") {
            aCorrigir = !aCorrigir
        }

        // GitHub: privado por omissão. São plataformas geradas por IA e
        // convém veres antes de as tornares públicas.
        if (githubUrl != null) {
            Coluna("No GitHub") {
                Text(githubUrl, color = Color(0xFF3B82F6), fontSize = 11.5.sp)
                Spacer(Modifier.height(7.dp))
                Botao("Enviar alterações") { aoPublicar(true) }
            }
        } else {
            Botao("Publicar no GitHub (privado)") { aoPublicar(true) }
        }

        if (aCorrigir) {
            CampoEscuro(correcao, "O que está mal? Ex.: o total não fecha ao cêntimo.",
                Modifier.fillMaxWidth().height(74.dp)) { correcao = it }
            Botao("Pôr a equipa a corrigir", destaque = true, ativo = correcao.isNotBlank()) {
                aoCorrigir(correcao)
            }
        }

        Botao(if (confirmar) "Confirmar: apagar tudo" else "Anular plataforma",
            perigo = true) {
            if (confirmar) aoAnular() else confirmar = true
        }
        if (confirmar) {
            Text("Apaga os ficheiros da VPS. Não há como recuperar.",
                color = Color(0xFFEF4444), fontSize = 11.sp)
        }

        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun Coluna(titulo: String, conteudo: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).background(CARTAO)
            .border(1.dp, LINHA, RoundedCornerShape(11.dp)).padding(11.dp)
    ) {
        Text(titulo.uppercase(), color = TEXTO_2, fontSize = 9.5.sp,
            fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        conteudo()
    }
}

@Composable
fun Botao(
    texto: String,
    destaque: Boolean = false,
    perigo: Boolean = false,
    ativo: Boolean = true,
    aoTocar: () -> Unit,
) {
    val fundo = when {
        !ativo -> TEXTO.copy(alpha = 0.22f)
        perigo -> Color(0xFF2A1116)
        destaque -> TEXTO
        else -> CARTAO
    }
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(fundo)
            .border(1.dp, if (perigo) Color(0xFFEF4444) else LINHA, RoundedCornerShape(10.dp))
            .clickable(enabled = ativo) { aoTocar() }
            .padding(vertical = 12.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            texto, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold,
            color = when {
                perigo -> Color(0xFFEF4444)
                destaque && ativo -> Color.Black
                else -> TEXTO
            }
        )
    }
}

/** A plataforma construída, servida pelo orchestrator. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun VerPlataforma(url: String, aoFechar: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("‹ Voltar", color = TEXTO, fontSize = 13.sp,
                modifier = Modifier.clickable { aoFechar() })
        }
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                WebView(ctx).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    setBackgroundColor(0xFF000000.toInt())
                    webViewClient = WebViewClient()
                    loadUrl(url)
                }
            }
        )
    }
}

/* ====================================================================
   Campo de texto escuro, reutilizado no ecrã de construir
   ==================================================================== */

@Composable
fun CampoEscuro(
    valor: String,
    dica: String,
    modifier: Modifier = Modifier,
    aoMudar: (String) -> Unit,
) {
    Box(
        modifier.clip(RoundedCornerShape(10.dp)).background(CARTAO)
            .border(1.dp, LINHA, RoundedCornerShape(10.dp))
            .padding(horizontal = 11.dp, vertical = 9.dp)
    ) {
        if (valor.isEmpty()) Text(dica, color = TEXTO_2, fontSize = 13.sp)
        BasicTextField(
            value = valor,
            onValueChange = aoMudar,
            textStyle = TextStyle(color = TEXTO, fontSize = 13.5.sp),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(TEXTO),
            modifier = Modifier.fillMaxWidth()
        )
    }
}
