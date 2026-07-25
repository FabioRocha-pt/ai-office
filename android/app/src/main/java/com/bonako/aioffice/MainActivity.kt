package com.bonako.aioffice

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.content.Intent
import android.view.View
import android.webkit.*
import android.widget.LinearLayout
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Wrapper nativo do painel de controlo do AI Office.
 *
 * A razão de existir (além de ser uma app a sério): dentro de um WebView
 * o `webkitSpeechRecognition` não existe. A voz que funciona no Chrome
 * morre num wrapper simples. Aqui usamos o SpeechRecognizer nativo do
 * Android e ligamo-lo ao JavaScript por uma ponte, o que dá reconhecimento
 * melhor e sem depender do browser.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var overlay: LinearLayout
    private lateinit var ovTitle: TextView
    private lateinit var ovMsg: TextView
    private lateinit var ovBtn: Button
    private var speech: SpeechRecognizer? = null
    private var listening = false

    private val prefs by lazy { getSharedPreferences("aioffice", Context.MODE_PRIVATE) }
    private var serverUrl: String
        get() = prefs.getString("server", "") ?: ""
        set(v) = prefs.edit().putString("server", v).apply()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (serverUrl.isBlank()) showSetup() else showWeb()
    }

    /* ---------------- ecrã de configuração ---------------- */

    private fun showSetup(error: String? = null) {
        setContentView(R.layout.activity_setup)

        val input = findViewById<EditText>(R.id.url)
        val err = findViewById<TextView>(R.id.err)
        input.setText(serverUrl.ifBlank { "http://" })

        if (error != null) {
            err.text = error
            err.visibility = View.VISIBLE
        }

        findViewById<Button>(R.id.save).setOnClickListener {
            val v = normalize(input.text.toString())
            if (v == null) {
                err.text = "Escreve o endereço com IP e porta, por exemplo http://1.2.3.4:3000"
                err.visibility = View.VISIBLE
                return@setOnClickListener
            }
            serverUrl = v
            showWeb()
        }
    }

    /**
     * Aceita o que o utilizador escrever e devolve a base limpa.
     * Colar "http://ip:3000/flip.html" é o erro mais natural do mundo —
     * em vez de rebentar, cortamos o caminho e ficamos com a base.
     */
    private fun normalize(raw: String): String? {
        var v = raw.trim()
        if (v.isBlank()) return null
        if (!v.startsWith("http://") && !v.startsWith("https://")) v = "http://$v"

        // corta qualquer caminho depois do host:porta
        val afterScheme = v.indexOf("://") + 3
        val slash = v.indexOf('/', afterScheme)
        if (slash != -1) v = v.substring(0, slash)

        v = v.trimEnd('/')
        val hostPart = v.substringAfter("://")
        if (hostPart.isBlank() || hostPart == "localhost") return null
        return v
    }

    /* ---------------- WebView ---------------- */

    @SuppressLint("SetJavaScriptEnabled")
    private fun showWeb() {
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        overlay = findViewById(R.id.overlay)
        ovTitle = findViewById(R.id.ov_title)
        ovMsg = findViewById(R.id.ov_msg)
        ovBtn = findViewById(R.id.ov_btn)

        ovBtn.setOnClickListener { showSetup() }
        setOverlay("A ligar…", serverUrl, false)

        // Permite inspecionar a página a partir do Chrome do PC em
        // chrome://inspect — foi assim que se caçou o ecrã preto.
        WebView.setWebContentsDebuggingEnabled(true)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            // useWideViewPort/loadWithOverviewMode ficam FALSE de propósito:
            // a página já traz meta viewport própria, e ligá-los fazia o
            // WebView reescalar tudo e cortar o layout.
            useWideViewPort = false
            loadWithOverviewMode = false
        }
        web.setBackgroundColor(0xFF000000.toInt())

        web.webChromeClient = object : WebChromeClient() {
            // O WebView tem de conceder explicitamente o micro à página
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                        request.grant(request.resources)
                    else request.deny()
                }
            }
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                android.util.Log.d("AIOffice", "${m.messageLevel()}: ${m.message()} @${m.lineNumber()}")
                return true
            }
        }

        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                overlay.visibility = View.GONE
            }

            override fun onReceivedError(
                view: WebView?, req: WebResourceRequest?, err: WebResourceError?
            ) {
                // Só o documento principal interessa: um recurso secundário
                // a falhar não deve deitar abaixo o ecrã todo.
                if (req?.isForMainFrame != true) return
                setOverlay(
                    "Não consegui ligar",
                    "$serverUrl\n\n${err?.description ?: "sem resposta"}\n\n" +
                        "Confirma que o orchestrator está a correr (pm2 list) e que o IP e a porta estão certos.",
                    true
                )
            }

            override fun onReceivedHttpError(
                view: WebView?, req: WebResourceRequest?, resp: WebResourceResponse?
            ) {
                if (req?.isForMainFrame != true) return
                setOverlay(
                    "O servidor respondeu ${resp?.statusCode}",
                    "$serverUrl/flip.html\n\nSe for 404, a versão instalada na VPS ainda não tem o flip.html — " +
                        "faz unzip do zip novo e pm2 restart.",
                    true
                )
            }
        }

        web.addJavascriptInterface(Bridge(), "AndroidHost")
        ensureMicPermission()
        web.loadUrl("$serverUrl/flip.html")
    }

    private fun setOverlay(title: String, msg: String, showButton: Boolean) {
        runOnUiThread {
            overlay.visibility = View.VISIBLE
            ovTitle.text = title
            ovMsg.text = msg
            ovBtn.visibility = if (showButton) View.VISIBLE else View.GONE
        }
    }

    override fun onBackPressed() {
        if (this::web.isInitialized && web.canGoBack()) web.goBack()
        else super.onBackPressed()
    }

    /* ---------------- ponte JavaScript <-> nativo ---------------- */

    inner class Bridge {
        /** A página usa isto para saber que corre dentro da app. */
        @JavascriptInterface fun isNative(): Boolean = true

        @JavascriptInterface fun startSpeech() = runOnUiThread { startListening() }
        @JavascriptInterface fun stopSpeech() = runOnUiThread { stopListening() }
        @JavascriptInterface fun openSettings() = runOnUiThread { showSetup() }
    }

    /** Envia um evento para o JavaScript da página. */
    private fun emit(event: String, payload: String) {
        val js = "window.__nativeEvent && window.__nativeEvent(" +
                JSONObject.quote(event) + "," + JSONObject.quote(payload) + ")"
        runOnUiThread { if (this::web.isInitialized) web.evaluateJavascript(js, null) }
    }

    /* ---------------- reconhecimento de voz ---------------- */

    private fun ensureMicPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), 1)
        }
    }

    private fun startListening() {
        if (listening) return

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ensureMicPermission()
            emit("speech-error", "Falta autorização do micro.")
            return
        }

        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            emit("speech-error", "Este telemóvel não tem reconhecimento de voz disponível.")
            return
        }

        speech?.destroy()
        speech = SpeechRecognizer.createSpeechRecognizer(this).apply {
            setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(p: Bundle?) { emit("speech-start", "") }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(v: Float) {}
                override fun onBufferReceived(b: ByteArray?) {}
                override fun onEndOfSpeech() {}

                override fun onPartialResults(b: Bundle?) {
                    b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()?.let { emit("speech-partial", it) }
                }

                override fun onResults(b: Bundle?) {
                    val text = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull() ?: ""
                    listening = false
                    emit("speech-final", text)
                }

                override fun onError(code: Int) {
                    listening = false
                    emit("speech-error", errorText(code))
                }

                override fun onEvent(t: Int, b: Bundle?) {}
            })
        }

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-PT")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            // Briefings são frases longas — damos tempo para respirar
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
            if (Build.VERSION.SDK_INT >= 33) putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, "quality")
        }

        listening = true
        speech?.startListening(intent)
    }

    private fun stopListening() {
        if (!listening) return
        listening = false
        speech?.stopListening()
    }

    private fun errorText(code: Int) = when (code) {
        SpeechRecognizer.ERROR_AUDIO -> "Problema a gravar áudio."
        SpeechRecognizer.ERROR_CLIENT -> "Erro no reconhecimento."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Falta autorização do micro."
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Sem rede para reconhecer voz."
        SpeechRecognizer.ERROR_NO_MATCH -> "Não percebi. Tenta outra vez."
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "O reconhecimento está ocupado."
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Não ouvi nada."
        else -> "Falhou o reconhecimento ($code)."
    }

    override fun onDestroy() {
        speech?.destroy()
        speech = null
        super.onDestroy()
    }
}
