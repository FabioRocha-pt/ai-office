package com.bonako.aioffice

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.*
import android.view.MotionEvent
import android.view.View
import android.view.animation.DecelerateInterpolator
import kotlin.math.abs

/**
 * Barra de navegação entre as secções da D.A.I.S.Y.
 *
 * Nativa e desenhada em Canvas, não HTML: assim a barra fica imóvel
 * enquanto o conteúdo transita, e a app deixa de parecer um site dentro
 * de uma moldura. O indicador desliza entre secções em vez de saltar —
 * é o que dá continuidade à navegação.
 */
class DaisyNavBar(context: Context) : View(context) {

    data class Seccao(val etiqueta: String, val caminho: String)

    /** Ordem das secções. O índice é usado na direção da transição. */
    val seccoes = listOf(
        Seccao("Escritório", "/office.html"),
        Seccao("Domínios", "/dominios.html"),
        Seccao("Mensalidades", "/faturacao.html"),
        Seccao("Vault", "/vault.html"),
    )

    var aoEscolher: ((indice: Int, seccao: Seccao, direcao: Int) -> Unit)? = null

    private val ciano = Color.parseColor("#00E5FF")
    private val esmeralda = Color.parseColor("#34D399")
    private val inativo = Color.parseColor("#7C93A6")
    private val fundo = Color.parseColor("#070C16")
    private val linha = Color.parseColor("#16232F")

    private val pincel = Paint(Paint.ANTI_ALIAS_FLAG)
    private val pincelTexto = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = 34f
        textAlign = Paint.Align.CENTER
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }

    private var atual = 0
    /** Posição do indicador em unidades de secção — anima entre inteiros. */
    private var posIndicador = 0f
    private var animador: ValueAnimator? = null

    fun seleccionar(indice: Int, animar: Boolean = true, notificar: Boolean = true) {
        if (indice !in seccoes.indices) return
        val direcao = if (indice > atual) 1 else if (indice < atual) -1 else 0
        val anterior = atual
        atual = indice

        animador?.cancel()
        if (animar) {
            animador = ValueAnimator.ofFloat(posIndicador, indice.toFloat()).apply {
                duration = 260
                interpolator = DecelerateInterpolator(1.6f)
                addUpdateListener { posIndicador = it.animatedValue as Float; invalidate() }
                start()
            }
        } else {
            posIndicador = indice.toFloat(); invalidate()
        }

        if (notificar && anterior != indice) {
            aoEscolher?.invoke(indice, seccoes[indice], direcao)
        }
    }

    fun indiceDe(caminho: String): Int =
        seccoes.indexOfFirst { caminho.contains(it.caminho) }

    override fun onDraw(canvas: Canvas) {
        val larguraCelula = width / seccoes.size.toFloat()

        canvas.drawColor(fundo)
        pincel.color = linha
        pincel.strokeWidth = 1f
        canvas.drawLine(0f, 0f, width.toFloat(), 0f, pincel)

        // Indicador: barra curta por cima da secção ativa
        val cxInd = larguraCelula * (posIndicador + 0.5f)
        val meia = larguraCelula * 0.28f
        pincel.shader = LinearGradient(
            cxInd - meia, 0f, cxInd + meia, 0f, ciano, esmeralda, Shader.TileMode.CLAMP
        )
        pincel.style = Paint.Style.FILL
        canvas.drawRoundRect(cxInd - meia, 0f, cxInd + meia, 6f, 3f, 3f, pincel)
        pincel.shader = null

        // Brilho ténue por baixo do indicador
        pincel.shader = RadialGradient(
            cxInd, 0f, larguraCelula * 0.6f,
            Color.argb(38, 0, 229, 255), Color.TRANSPARENT, Shader.TileMode.CLAMP
        )
        canvas.drawRect(cxInd - larguraCelula, 0f, cxInd + larguraCelula, height.toFloat(), pincel)
        pincel.shader = null

        for ((i, s) in seccoes.withIndex()) {
            // A cor acompanha a distância ao indicador, para o texto
            // acender à medida que ele chega — e não só no fim.
            val proximidade = (1f - abs(posIndicador - i)).coerceIn(0f, 1f)
            pincelTexto.color = misturar(inativo, Color.WHITE, proximidade)
            canvas.drawText(
                s.etiqueta,
                larguraCelula * (i + 0.5f),
                height / 2f + pincelTexto.textSize / 3f,
                pincelTexto
            )
        }
    }

    private fun misturar(de: Int, para: Int, f: Float): Int = Color.rgb(
        (Color.red(de) + (Color.red(para) - Color.red(de)) * f).toInt(),
        (Color.green(de) + (Color.green(para) - Color.green(de)) * f).toInt(),
        (Color.blue(de) + (Color.blue(para) - Color.blue(de)) * f).toInt()
    )

    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (e.action == MotionEvent.ACTION_UP) {
            val i = (e.x / (width / seccoes.size.toFloat())).toInt().coerceIn(seccoes.indices)
            performClick()
            seleccionar(i)
        }
        return true
    }

    override fun performClick(): Boolean = super.performClick()
}
