package com.bonako.aioffice

import android.util.Base64
import android.webkit.CookieManager
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Emparelhamento com o servidor e sessão do WebView.
 *
 * Porque é que não basta guardar utilizador e password: para um 401 com
 * WWW-Authenticate, o WebView chama onReceivedHttpAuthRequest, e a
 * implementação por omissão cancela em silêncio — ecrã preto, sem erro.
 * Mesmo tratando esse callback, ficaria a password em memória a cada
 * pedido.
 *
 * O caminho melhor: trocamos as credenciais UMA vez por um token de
 * longa duração (/auth/token), guardamo-lo cifrado atrás da impressão
 * digital, e metemo-lo num cookie antes de carregar a página. A partir
 * daí o WebView e o WebSocket autenticam-se sozinhos, sem nunca terem
 * visto a password.
 */
object Sessao {

    private val executor = Executors.newSingleThreadExecutor()

    /**
     * Troca credenciais por um token de dispositivo.
     * Corre fora da thread principal e devolve o resultado nela.
     */
    fun emparelhar(
        baseUrl: String,
        utilizador: String,
        password: String,
        etiqueta: String,
        aoConcluir: (token: String?, erro: String?) -> Unit
    ) {
        executor.execute {
            var conexao: HttpURLConnection? = null
            try {
                val url = URL("$baseUrl/auth/token")
                conexao = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 10000
                    readTimeout = 15000
                    doOutput = true
                    val cred = Base64.encodeToString(
                        "$utilizador:$password".toByteArray(Charsets.UTF_8),
                        Base64.NO_WRAP
                    )
                    setRequestProperty("Authorization", "Basic $cred")
                    setRequestProperty("Content-Type", "application/json")
                }

                conexao.outputStream.use {
                    it.write(JSONObject().put("etiqueta", etiqueta).toString().toByteArray())
                }

                val codigo = conexao.responseCode
                val fluxo = if (codigo in 200..299) conexao.inputStream else conexao.errorStream
                val corpo = fluxo?.let {
                    BufferedReader(InputStreamReader(it, Charsets.UTF_8)).use { r -> r.readText() }
                } ?: ""

                val resultado: Pair<String?, String?> = when {
                    codigo == 401 ->
                        null to "Utilizador ou password errados."
                    codigo == 429 ->
                        null to "Demasiadas tentativas. Espera 15 minutos."
                    codigo == 400 ->
                        null to (tentarErro(corpo) ?: "O servidor não tem autenticação configurada.")
                    codigo !in 200..299 ->
                        null to "O servidor respondeu $codigo."
                    else -> {
                        val t = JSONObject(corpo).optString("token", "")
                        if (t.isBlank()) null to "O servidor não devolveu token."
                        else t to null
                    }
                }
                responder(aoConcluir, resultado.first, resultado.second)
            } catch (e: Exception) {
                responder(aoConcluir, null,
                    "Não consegui falar com $baseUrl.\n${e.message ?: "sem detalhe"}")
            } finally {
                conexao?.disconnect()
            }
        }
    }

    private fun tentarErro(corpo: String): String? =
        try { JSONObject(corpo).optString("error").ifBlank { null } } catch (_: Exception) { null }

    private fun responder(
        cb: (String?, String?) -> Unit, token: String?, erro: String?
    ) {
        android.os.Handler(android.os.Looper.getMainLooper()).post { cb(token, erro) }
    }

    /**
     * Põe o token no cookie do WebView. Tem de acontecer ANTES do
     * loadUrl, senão o primeiro pedido vai sem credenciais e leva 401.
     */
    fun aplicarCookie(baseUrl: String, token: String) {
        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        // O servidor aceita o token de dispositivo neste mesmo cookie,
        // o que evita ter de interceptar cada pedido do WebView.
        cm.setCookie(baseUrl, "office_sess=$token; Path=/")
        cm.flush()
    }

    fun limparCookies() {
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
    }
}
