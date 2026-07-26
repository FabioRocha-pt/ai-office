package com.bonako.aioffice

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.text.InputType
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.webkit.*
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * D.A.I.S.Y. — invólucro nativo do painel.
 *
 * Duas regras de desenho, ambas nascidas de problemas reais:
 *
 *  1. NUNCA um ecrã preto sem explicação. A versão anterior carregava o
 *     WebView e, se o servidor respondesse 401, ficava um ecrã escuro sem
 *     uma palavra. Aqui todos os caminhos de falha acabam num painel
 *     nativo com o motivo e um botão para sair dele.
 *
 *  2. O arranque é NATIVO. Se dependesse da web app, uma falha de rede
 *     não teria sequer onde ser mostrada.
 *
 * A voz continua nativa: dentro de um WebView o webkitSpeechRecognition
 * não existe, portanto a voz que funciona no Chrome morreria aqui.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        /** A VPS. Editável no painel de credenciais e guardada depois. */
        const val URL_PADRAO = "http://169.58.37.101:3000"
        private const val PREFS = "daisy"
        private const val CHAVE_URL = "base_url"
        private const val PEDIDO_MICROFONE = 4711
        /** O arranque nunca é mais curto do que isto: dá tempo à animação. */
        private const val ARRANQUE_MIN_MS = 2300L
    }

    private lateinit var raiz: FrameLayout
    private lateinit var web: WebView
    private lateinit var boot: DaisyBootView
    private var painel: View? = null

    private var speech: SpeechRecognizer? = null
    private val principal = Handler(Looper.getMainLooper())
    private var arranqueEm = 0L
    private var jaCarregou = false

    private val prefs by lazy { getSharedPreferences(PREFS, MODE_PRIVATE) }
    private var baseUrl: String
        get() = prefs.getString(CHAVE_URL, URL_PADRAO) ?: URL_PADRAO
        set(v) { prefs.edit().putString(CHAVE_URL, v.trimEnd('/')).apply() }

    /* ───────────────────────── ciclo de vida ───────────────────────── */

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(estado: Bundle?) {
        super.onCreate(estado)
        arranqueEm = System.currentTimeMillis()

        raiz = FrameLayout(this)
        raiz.setBackgroundColor(Color.parseColor("#04070F"))
        setContentView(raiz)

        web = WebView(this)
        web.visibility = View.GONE
        web.setBackgroundColor(Color.parseColor("#04070F"))
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.databaseEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.settings.useWideViewPort = true
        web.settings.loadWithOverviewMode = true
        web.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                android.util.Log.d("DAISY-web", m.message() + " @" + m.lineNumber())
                return true
            }
        }
        web.webViewClient = clienteWeb()
        web.addJavascriptInterface(PonteVoz(), "DaisyNativa")
        raiz.addView(web, ViewGroup.LayoutParams(-1, -1))

        boot = DaisyBootView(this)
        raiz.addView(boot, ViewGroup.LayoutParams(-1, -1))

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        arrancar()
    }

    override fun onDestroy() {
        speech?.destroy()
        speech = null
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (web.visibility == View.VISIBLE && web.canGoBack()) web.goBack()
        else super.onBackPressed()
    }

    /* ──────────────────────── sequência de arranque ──────────────────── */

    private fun arrancar() {
        val anfitriao = baseUrl.replace("http://", "").replace("https://", "")
        boot.linhas = listOf(
            "[0.001] nucleo local iniciado",
            "[0.014] a resolver " + anfitriao,
            "[0.031] a verificar credenciais"
        )
        boot.progresso = 0.25f
        boot.estado = "a verificar acesso"

        if (!BiometricAuth.temTokenGuardado(this)) {
            boot.estado = "primeiro arranque"
            depoisDoArranqueMinimo { mostrarCredenciais(null) }
            return
        }

        if (!BiometricAuth.disponivel(this)) {
            // Há token guardado mas a biometria deixou de estar disponível.
            // Não dá para o decifrar: a chave do Keystore exige-a.
            depoisDoArranqueMinimo {
                mostrarCredenciais(BiometricAuth.motivoIndisponivel(this))
            }
            return
        }

        boot.progresso = 0.5f
        boot.estado = "a aguardar impressao digital"
        BiometricAuth.desbloquear(this) { token, erro ->
            if (token != null) {
                boot.progresso = 0.8f
                boot.estado = "acesso concedido"
                depoisDoArranqueMinimo { carregarPainel(token) }
            } else {
                depoisDoArranqueMinimo { mostrarCredenciais(erro) }
            }
        }
    }

    /** Não engolir a animação: espera o mínimo antes de trocar de ecrã. */
    private fun depoisDoArranqueMinimo(acao: () -> Unit) {
        val decorrido = System.currentTimeMillis() - arranqueEm
        val falta = (ARRANQUE_MIN_MS - decorrido).coerceAtLeast(0L)
        principal.postDelayed({ acao() }, falta)
    }

    /* ──────────────────────────── painel web ─────────────────────────── */

    private fun carregarPainel(token: String) {
        // O token entra como COOKIE e não como cabeçalho: o WebView não
        // deixa pôr cabeçalhos em todos os pedidos, mas o cookie viaja em
        // tudo — incluindo no handshake do WebSocket, que é o que mantém
        // o painel vivo. Tem de ser ANTES do loadUrl.
        Sessao.aplicarCookie(baseUrl, token)

        boot.progresso = 0.95f
        boot.estado = "a carregar painel"
        jaCarregou = false
        web.loadUrl(baseUrl)
    }

    private fun clienteWeb() = object : WebViewClient() {
        override fun onPageFinished(v: WebView?, url: String?) {
            if (jaCarregou) return
            jaCarregou = true
            boot.progresso = 1f
            boot.estado = "pronta"
            principal.postDelayed({
                web.visibility = View.VISIBLE
                boot.visibility = View.GONE
                anunciarVozNativa()
            }, 320)
        }

        override fun onReceivedHttpError(v: WebView?, p: WebResourceRequest?, r: WebResourceResponse?) {
            // Só o documento principal interessa: um 404 num ícone não é
            // razão para mandar o utilizador reautenticar.
            if (p == null || !p.isForMainFrame) return
            val codigo = r?.statusCode ?: 0
            if (codigo == 401) {
                BiometricAuth.esquecer(this@MainActivity)
                Sessao.limparCookies()
                mostrarCredenciais("O servidor recusou o acesso guardado (401). O token pode ter sido revogado ou a palavra-passe mudou.")
            } else if (codigo >= 400) {
                mostrarErro("O servidor respondeu " + codigo,
                    baseUrl + "\n\nConfirma na VPS:\npm2 status")
            }
        }

        override fun onReceivedError(v: WebView?, p: WebResourceRequest?, e: WebResourceError?) {
            if (p == null || !p.isForMainFrame) return
            val desc = if (Build.VERSION.SDK_INT >= 23 && e != null) e.description.toString() else ""
            mostrarErro("Nao consegui ligar",
                baseUrl + "\n\n" + desc + "\n\nVerifica se a VPS esta acessivel e se a porta 3000 esta aberta.")
        }
    }

    /* ───────────────────────── painéis nativos ───────────────────────── */

    private fun limparPainel() {
        val p = painel
        if (p != null) raiz.removeView(p)
        painel = null
    }

    private fun caixa(): LinearLayout {
        val l = LinearLayout(this)
        l.orientation = LinearLayout.VERTICAL
        l.setBackgroundColor(Color.parseColor("#04070F"))
        l.setPadding(dp(28), dp(64), dp(28), dp(28))
        return l
    }

    private fun titulo(t: String): TextView {
        val v = TextView(this)
        v.text = t
        v.setTextColor(Color.WHITE)
        v.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
        v.letterSpacing = 0.14f
        v.typeface = Typeface.create("sans-serif", Typeface.BOLD)
        return v
    }

    private fun nota(t: String, cor: Int = Color.parseColor("#8FB3C7")): TextView {
        val v = TextView(this)
        v.text = t
        v.setTextColor(cor)
        v.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        v.setPadding(0, dp(10), 0, dp(6))
        return v
    }

    private fun campo(dica: String, valor: String = "", passe: Boolean = false): EditText {
        val v = EditText(this)
        v.hint = dica
        v.setText(valor)
        v.setHintTextColor(Color.parseColor("#5B7A8C"))
        v.setTextColor(Color.WHITE)
        v.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        v.setPadding(dp(16), dp(16), dp(16), dp(16))
        val fundo = GradientDrawable()
        fundo.cornerRadius = dp(12).toFloat()
        fundo.setColor(Color.parseColor("#0C1520"))
        fundo.setStroke(dp(1), Color.parseColor("#1E3A47"))
        v.background = fundo
        v.inputType = if (passe)
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        else InputType.TYPE_CLASS_TEXT
        return v
    }

    private fun botao(t: String, destaque: Boolean = true): Button {
        val v = Button(this)
        v.text = t
        v.isAllCaps = false
        v.setTextColor(if (destaque) Color.parseColor("#04070F") else Color.parseColor("#7DF9FF"))
        v.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        val fundo = GradientDrawable()
        fundo.cornerRadius = dp(12).toFloat()
        if (destaque) {
            fundo.colors = intArrayOf(Color.parseColor("#00E5FF"), Color.parseColor("#34D399"))
        } else {
            fundo.setColor(Color.TRANSPARENT)
            fundo.setStroke(dp(1), Color.parseColor("#1E3A47"))
        }
        v.background = fundo
        return v
    }

    private fun mostrarCredenciais(aviso: String?) {
        limparPainel()
        boot.visibility = View.GONE
        web.visibility = View.GONE

        val c = caixa()
        c.addView(titulo("D.A.I.S.Y."))
        c.addView(nota("Emparelhamento deste aparelho. As credenciais sao pedidas uma unica vez; depois entra-se com a impressao digital."))
        if (aviso != null) c.addView(nota(aviso, Color.parseColor("#FCA5A5")))

        val cUrl = campo("Endereco do servidor", baseUrl)
        val cUser = campo("Utilizador", "fabio")
        val cPass = campo("Palavra-passe", "", true)
        val estadoTxt = nota("")

        val lp = LinearLayout.LayoutParams(-1, -2)
        lp.topMargin = dp(12)
        c.addView(cUrl, lp)
        c.addView(cUser, LinearLayout.LayoutParams(lp))
        c.addView(cPass, LinearLayout.LayoutParams(lp))

        val btn = botao("Emparelhar aparelho")
        val lpBtn = LinearLayout.LayoutParams(-1, dp(52))
        lpBtn.topMargin = dp(20)
        c.addView(btn, lpBtn)
        c.addView(estadoTxt)

        if (!BiometricAuth.disponivel(this)) {
            c.addView(nota("Biometria: " + BiometricAuth.motivoIndisponivel(this),
                Color.parseColor("#FCD34D")))
        }

        btn.setOnClickListener {
            val url = cUrl.text.toString().trim().trimEnd('/')
            val u = cUser.text.toString().trim()
            val p = cPass.text.toString()
            if (url.isEmpty() || u.isEmpty() || p.isEmpty()) {
                estadoTxt.text = "Preenche os tres campos."
            } else {
                btn.isEnabled = false
                estadoTxt.text = "A pedir token ao servidor..."
                emparelhar(url, u, p) { token, erro ->
                    if (token == null) {
                        btn.isEnabled = true
                        estadoTxt.text = erro ?: "Falhou."
                    } else {
                        baseUrl = url
                        if (BiometricAuth.disponivel(this)) {
                            estadoTxt.text = "Confirma com a impressao digital para guardar..."
                            BiometricAuth.guardar(this, token) { ok, msgErro ->
                                if (ok) {
                                    limparPainel()
                                    carregarPainel(token)
                                } else {
                                    btn.isEnabled = true
                                    estadoTxt.text = msgErro ?: "Nao consegui guardar."
                                }
                            }
                        } else {
                            // Sem biometria não guardamos nada: um token em
                            // claro no armazenamento da app seria pior do
                            // que pedir a password no próximo arranque.
                            limparPainel()
                            carregarPainel(token)
                        }
                    }
                }
            }
        }

        val sv = ScrollView(this)
        sv.addView(c)
        painel = sv
        raiz.addView(sv, ViewGroup.LayoutParams(-1, -1))
    }

    private fun mostrarErro(tituloTxt: String, detalhe: String) {
        limparPainel()
        boot.visibility = View.GONE
        web.visibility = View.GONE

        val c = caixa()
        c.addView(titulo(tituloTxt))
        c.addView(nota(detalhe))

        val tentar = botao("Tentar outra vez")
        tentar.setOnClickListener { recreate() }
        val lp = LinearLayout.LayoutParams(-1, dp(52))
        lp.topMargin = dp(20)
        c.addView(tentar, lp)

        val re = botao("Introduzir credenciais", false)
        re.setOnClickListener {
            BiometricAuth.esquecer(this)
            Sessao.limparCookies()
            mostrarCredenciais(null)
        }
        val lp2 = LinearLayout.LayoutParams(-1, dp(52))
        lp2.topMargin = dp(10)
        c.addView(re, lp2)

        painel = c
        raiz.addView(c, ViewGroup.LayoutParams(-1, -1))
    }

    /* ─────────────────────────── emparelhamento ──────────────────────── */

    // A troca de credenciais por token vive no Sessao.kt, que já existia e
    // já documentava a razão de fundo: num 401 com WWW-Authenticate o
    // WebView chama onReceivedHttpAuthRequest e a implementação por
    // omissão CANCELA EM SILÊNCIO — que é uma das causas do ecrã preto.
    private fun emparelhar(url: String, utilizador: String, passe: String,
                           aoConcluir: (String?, String?) -> Unit) {
        val etiqueta = Build.MANUFACTURER + " " + Build.MODEL
        Sessao.emparelhar(url, utilizador, passe, etiqueta, aoConcluir)
    }

    /* ────────────────────────────── voz nativa ───────────────────────── */

    private fun anunciarVozNativa() {
        // Diz à web app que existe voz nativa, para poder mostrar o botão
        // do microfone em vez de esconder a funcionalidade.
        web.evaluateJavascript(
            "window.DAISY_VOZ_NATIVA = true;" +
            "window.dispatchEvent(new Event('daisy-voz-pronta'));", null)
    }

    inner class PonteVoz {
        @JavascriptInterface
        fun ouvir() {
            principal.post {
                if (ContextCompat.checkSelfPermission(this@MainActivity,
                        Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(this@MainActivity,
                        arrayOf(Manifest.permission.RECORD_AUDIO), PEDIDO_MICROFONE)
                } else {
                    comecarAOuvir()
                }
            }
        }
    }

    private fun comecarAOuvir() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            paraJs("daisy-voz-erro", "Reconhecimento de voz indisponivel neste aparelho.")
            return
        }
        speech?.destroy()
        val r = SpeechRecognizer.createSpeechRecognizer(this)
        r.setRecognitionListener(object : RecognitionListener {
            override fun onResults(b: Bundle?) {
                val lista = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                paraJs("daisy-voz-texto", lista?.firstOrNull() ?: "")
            }
            override fun onPartialResults(b: Bundle?) {
                val lista = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val texto = lista?.firstOrNull() ?: ""
                if (texto.isNotEmpty()) paraJs("daisy-voz-parcial", texto)
            }
            override fun onError(e: Int) { paraJs("daisy-voz-erro", "codigo " + e) }
            override fun onReadyForSpeech(p: Bundle?) { paraJs("daisy-voz-inicio", "") }
            override fun onEndOfSpeech() { paraJs("daisy-voz-fim", "") }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(v: Float) {}
            override fun onBufferReceived(b: ByteArray?) {}
            override fun onEvent(t: Int, b: Bundle?) {}
        })
        speech = r

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-PT")
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        r.startListening(intent)
    }

    override fun onRequestPermissionsResult(codigo: Int, p: Array<out String>, r: IntArray) {
        super.onRequestPermissionsResult(codigo, p, r)
        if (codigo == PEDIDO_MICROFONE) {
            if (r.isNotEmpty() && r[0] == PackageManager.PERMISSION_GRANTED) comecarAOuvir()
            else paraJs("daisy-voz-erro", "Permissao de microfone recusada.")
        }
    }

    /** Passa texto ao JS sem risco de injeção: vai como JSON, não concatenado. */
    private fun paraJs(evento: String, dados: String) {
        val json = JSONObject().put("d", dados).toString()
        web.evaluateJavascript(
            "(function(o){window.dispatchEvent(new CustomEvent('" + evento +
            "',{detail:o.d}));})(" + json + ");", null)
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
