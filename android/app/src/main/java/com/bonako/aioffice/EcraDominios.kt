package com.bonako.aioffice

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import org.json.JSONObject

/**
 * Domínios, em nativo.
 *
 * Lê ao abrir e quando pedes — sem ligação persistente. O estado de um
 * health check é válido durante horas; manter o rádio acordado para o
 * vigiar seria gastar bateria para não saber nada de novo.
 *
 * Desenhado a pensar no ecrã exterior do Flip: quando o espaço é pouco,
 * o cartão reduz-se ao essencial (cor de estado, domínio, resumo) em vez
 * de encolher tudo proporcionalmente. Numa sessão de três segundos, o
 * que interessa é a cor e o nome.
 */
class EcraDominios(context: Context) : FrameLayout(context) {

    private val fundo = Color.parseColor("#04070F")
    private val superficie = Color.parseColor("#0C1520")
    private val borda = Color.parseColor("#16232F")
    private val texto = Color.parseColor("#E6F1F7")
    private val texto2 = Color.parseColor("#7C93A6")
    private val ciano = Color.parseColor("#00E5FF")
    private val bom = Color.parseColor("#34D399")
    private val aviso = Color.parseColor("#FBBF24")
    private val critico = Color.parseColor("#F87171")

    private val principal = Handler(Looper.getMainLooper())
    private val lista = LinearLayout(context)
    private val cabecalho = LinearLayout(context)
    private val estadoTxt = TextView(context)
    private val btVerificar = Button(context)
    private val progresso = ProgressBar(context)

    private var aVarrer = false
    private var sonda: Runnable? = null

    /** Abaixo desta largura, assume-se o ecrã exterior. */
    private val compacto: Boolean
        get() = resources.displayMetrics.widthPixels < dp(420)

    init {
        setBackgroundColor(fundo)

        val raiz = LinearLayout(context)
        raiz.orientation = LinearLayout.VERTICAL

        // Cabeçalho com resumo e botão
        cabecalho.orientation = LinearLayout.VERTICAL
        cabecalho.setPadding(dp(16), dp(14), dp(16), dp(10))

        estadoTxt.setTextColor(texto2)
        estadoTxt.setTextSize(TypedValue.COMPLEX_UNIT_SP, if (compacto) 11f else 13f)
        cabecalho.addView(estadoTxt)

        val linhaBotao = LinearLayout(context)
        linhaBotao.orientation = LinearLayout.HORIZONTAL
        linhaBotao.gravity = Gravity.CENTER_VERTICAL

        btVerificar.text = "Verificar"
        btVerificar.isAllCaps = false
        btVerificar.setTextColor(Color.parseColor("#04070F"))
        btVerificar.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        val fundoBt = GradientDrawable()
        fundoBt.cornerRadius = dp(10).toFloat()
        fundoBt.colors = intArrayOf(ciano, bom)
        btVerificar.background = fundoBt
        btVerificar.setOnClickListener { verificar() }
        linhaBotao.addView(btVerificar, LinearLayout.LayoutParams(0, dp(42), 1f))

        progresso.isIndeterminate = true
        progresso.visibility = View.GONE
        val lpProg = LinearLayout.LayoutParams(dp(28), dp(28))
        lpProg.leftMargin = dp(12)
        linhaBotao.addView(progresso, lpProg)

        val lpLinha = LinearLayout.LayoutParams(-1, -2)
        lpLinha.topMargin = dp(10)
        cabecalho.addView(linhaBotao, lpLinha)

        raiz.addView(cabecalho)

        lista.orientation = LinearLayout.VERTICAL
        lista.setPadding(dp(12), 0, dp(12), dp(20))
        val scroll = ScrollView(context)
        scroll.addView(lista)
        raiz.addView(scroll, LinearLayout.LayoutParams(-1, -1))

        addView(raiz, ViewGroup.LayoutParams(-1, -1))
    }

    /* ─────────────────────────── dados ─────────────────────────── */

    fun carregar() {
        mostrarMensagem("A carregar…")
        Api.obter("/dominios/saude") { r, erro ->
            if (erro != null) { mostrarMensagem(erro); return@obter }
            desenhar(r)
        }
    }

    private fun verificar() {
        if (aVarrer) return
        aVarrer = true
        btVerificar.isEnabled = false
        progresso.visibility = View.VISIBLE
        estadoTxt.text = "A verificar…"

        Api.enviar("/dominios/saude/verificar") { _, erro ->
            if (erro != null) {
                aVarrer = false
                btVerificar.isEnabled = true
                progresso.visibility = View.GONE
                estadoTxt.text = erro
                return@enviar
            }
            // O varrimento corre em fundo no servidor. Sondar de 3 em 3
            // segundos ENQUANTO dura é aceitável — é uma janela de meio
            // minuto, não uma ligação sempre aberta.
            sondar()
        }
    }

    private fun sondar() {
        sonda?.let { principal.removeCallbacks(it) }
        val r = object : Runnable {
            override fun run() {
                Api.obter("/dominios/saude") { j, erro ->
                    if (erro != null) { pararSonda(erro); return@obter }
                    desenhar(j)
                    if (j?.optBoolean("aVarrer") == true) principal.postDelayed(this, 3000)
                    else pararSonda(null)
                }
            }
        }
        sonda = r
        principal.postDelayed(r, 3000)
    }

    private fun pararSonda(erro: String?) {
        sonda?.let { principal.removeCallbacks(it) }
        sonda = null
        aVarrer = false
        btVerificar.isEnabled = true
        progresso.visibility = View.GONE
        if (erro != null) estadoTxt.text = erro
    }

    /** Chamado quando o ecrã deixa de estar visível: nada fica a correr. */
    fun parar() {
        sonda?.let { principal.removeCallbacks(it) }
        sonda = null
    }

    /* ─────────────────────────── desenho ─────────────────────────── */

    private fun desenhar(j: JSONObject?) {
        lista.removeAllViews()
        if (j == null) { mostrarMensagem("Sem dados."); return }

        val resumo = j.optJSONObject("resumo")
        aVarrer = j.optBoolean("aVarrer")

        estadoTxt.text = when {
            aVarrer -> "A verificar…"
            resumo == null -> "Ainda não foi verificado"
            else -> {
                val c = resumo.optInt("criticos")
                val a = resumo.optInt("avisos")
                val b = resumo.optInt("bons")
                if (c == 0 && a == 0) "$b domínios, tudo em ordem"
                else "$c críticos · $a avisos · $b em ordem"
            }
        }

        val res = j.optJSONArray("resultados")
        if (res == null || res.length() == 0) {
            mostrarMensagem("Nenhum domínio verificado ainda.")
            return
        }

        for (i in 0 until res.length()) {
            lista.addView(cartao(res.getJSONObject(i)))
        }
    }

    private fun cartao(d: JSONObject): View {
        val estado = d.optJSONObject("estado")
        val nivel = estado?.optString("nivel") ?: ""
        val cor = when (nivel) {
            "critico" -> critico
            "aviso" -> aviso
            "bom" -> bom
            else -> texto2
        }

        val caixa = LinearLayout(context)
        caixa.orientation = LinearLayout.HORIZONTAL
        val f = GradientDrawable()
        f.cornerRadius = dp(12).toFloat()
        f.setColor(superficie)
        f.setStroke(dp(1), borda)
        caixa.background = f
        caixa.setPadding(0, dp(12), dp(14), dp(12))

        // Barra de cor à esquerda: no ecrã exterior é o que se lê
        // primeiro, antes de qualquer texto.
        val barra = View(context)
        barra.setBackgroundColor(cor)
        val lpBarra = LinearLayout.LayoutParams(dp(4), -1)
        lpBarra.rightMargin = dp(12)
        caixa.addView(barra, lpBarra)

        val col = LinearLayout(context)
        col.orientation = LinearLayout.VERTICAL

        val nome = TextView(context)
        nome.text = d.optString("dominio")
        nome.setTextColor(texto)
        nome.setTextSize(TypedValue.COMPLEX_UNIT_SP, if (compacto) 13f else 15f)
        nome.typeface = Typeface.MONOSPACE
        nome.maxLines = 1
        nome.ellipsize = android.text.TextUtils.TruncateAt.MIDDLE
        col.addView(nome)

        val resumo = TextView(context)
        resumo.text = estado?.optString("resumo") ?: ""
        resumo.setTextColor(cor)
        resumo.setTextSize(TypedValue.COMPLEX_UNIT_SP, if (compacto) 11f else 12.5f)
        resumo.maxLines = 1
        col.addView(resumo)

        // No compacto ficamos por aqui: cor, nome e resumo dizem tudo o
        // que se precisa numa olhadela. Os detalhes só no ecrã grande.
        if (!compacto) {
            val cert = d.optJSONObject("cert")
            val https = d.optJSONObject("https")
            val partes = mutableListOf<String>()
            https?.let { if (it.has("codigo")) partes.add("HTTP ${it.optInt("codigo")}") }
            https?.let { if (it.has("ms")) partes.add("${it.optInt("ms")}ms") }
            cert?.let {
                if (!it.isNull("diasParaExpirar"))
                    partes.add("cert ${it.optInt("diasParaExpirar")}d")
                val em = it.optString("emissor", "")
                if (em.isNotEmpty() && em != "null") partes.add(em)
            }
            d.optJSONObject("cliente")?.let { partes.add(it.optString("nome")) }

            if (partes.isNotEmpty()) {
                val det = TextView(context)
                det.text = partes.joinToString("  ·  ")
                det.setTextColor(texto2)
                det.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
                det.typeface = Typeface.MONOSPACE
                det.setPadding(0, dp(4), 0, 0)
                col.addView(det)
            }
        }

        caixa.addView(col, LinearLayout.LayoutParams(0, -2, 1f))

        val lp = LinearLayout.LayoutParams(-1, -2)
        lp.bottomMargin = dp(8)
        caixa.layoutParams = lp
        return caixa
    }

    private fun mostrarMensagem(m: String) {
        lista.removeAllViews()
        val t = TextView(context)
        t.text = m
        t.setTextColor(texto2)
        t.gravity = Gravity.CENTER
        t.setPadding(0, dp(40), 0, 0)
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        lista.addView(t)
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
