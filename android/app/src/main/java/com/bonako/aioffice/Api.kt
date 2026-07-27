package com.bonako.aioffice

import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Cliente da API da D.A.I.S.Y.
 *
 * Pedidos pontuais, sem ligação persistente. É uma decisão de consumo,
 * não de simplicidade: quando o rádio acorda para transmitir, fica
 * alguns segundos num estado de alta energia à espera de mais tráfego.
 * Um WebSocket com keepalives mantém esse ciclo a andar em permanência,
 * mesmo sem passar informação útil.
 *
 * No ecrã exterior do Flip, onde as sessões duram segundos, isso é
 * desperdício puro — e o calor nota-se num corpo tão fino. O estado dos
 * domínios não é tempo real: certificados não mudam ao segundo.
 *
 * O WebSocket fica reservado ao Escritório, onde há mesmo output ao
 * vivo, e só enquanto esse ecrã estiver visível.
 */
object Api {

    // Uma só thread: os pedidos são poucos e sequenciais, e assim não há
    // um pool a manter threads vivas à espera de trabalho que não vem.
    private val executor = Executors.newSingleThreadExecutor()
    private val principal = Handler(Looper.getMainLooper())

    var baseUrl: String = MainActivity.URL_PADRAO
    var token: String? = null

    class ErroApi(mensagem: String, val codigo: Int = 0) : Exception(mensagem)

    private fun abrir(caminho: String, metodo: String): HttpURLConnection {
        val c = URL(baseUrl.trimEnd('/') + caminho).openConnection() as HttpURLConnection
        c.requestMethod = metodo
        c.connectTimeout = 10000
        c.readTimeout = 20000
        c.setRequestProperty("Accept", "application/json")
        token?.let { c.setRequestProperty("Authorization", "Bearer $it") }
        return c
    }

    private fun ler(c: HttpURLConnection): String {
        val codigo = c.responseCode
        val fluxo = if (codigo in 200..299) c.inputStream else c.errorStream
        val corpo = fluxo?.bufferedReader()?.use(BufferedReader::readText) ?: ""

        if (codigo == 401) throw ErroApi("Acesso recusado. É preciso emparelhar outra vez.", 401)
        if (codigo == 429) throw ErroApi("Demasiados pedidos. Espera um pouco.", 429)
        if (codigo !in 200..299) {
            val msg = try { JSONObject(corpo).optString("error", "") } catch (_: Exception) { "" }
            throw ErroApi(if (msg.isNotEmpty()) msg else "O servidor respondeu $codigo.", codigo)
        }
        return corpo
    }

    /** GET que devolve objeto. O callback corre na thread principal. */
    fun obter(caminho: String, aoConcluir: (JSONObject?, String?) -> Unit) {
        executor.execute {
            var r: JSONObject? = null
            var erro: String? = null
            var c: HttpURLConnection? = null
            try {
                c = abrir(caminho, "GET")
                r = JSONObject(ler(c))
            } catch (e: Exception) {
                erro = e.message ?: "Falha de rede."
            } finally { c?.disconnect() }
            principal.post { aoConcluir(r, erro) }
        }
    }

    /** GET que devolve array. */
    fun obterLista(caminho: String, aoConcluir: (JSONArray?, String?) -> Unit) {
        executor.execute {
            var r: JSONArray? = null
            var erro: String? = null
            var c: HttpURLConnection? = null
            try {
                c = abrir(caminho, "GET")
                r = JSONArray(ler(c))
            } catch (e: Exception) {
                erro = e.message ?: "Falha de rede."
            } finally { c?.disconnect() }
            principal.post { aoConcluir(r, erro) }
        }
    }

    fun enviar(caminho: String, corpo: JSONObject? = null,
               aoConcluir: (JSONObject?, String?) -> Unit) {
        executor.execute {
            var r: JSONObject? = null
            var erro: String? = null
            var c: HttpURLConnection? = null
            try {
                c = abrir(caminho, "POST")
                c.setRequestProperty("Content-Type", "application/json")
                c.doOutput = true
                c.outputStream.use { it.write((corpo ?: JSONObject()).toString().toByteArray()) }
                val texto = ler(c)
                r = if (texto.isBlank()) JSONObject() else JSONObject(texto)
            } catch (e: Exception) {
                erro = e.message ?: "Falha de rede."
            } finally { c?.disconnect() }
            principal.post { aoConcluir(r, erro) }
        }
    }
}
