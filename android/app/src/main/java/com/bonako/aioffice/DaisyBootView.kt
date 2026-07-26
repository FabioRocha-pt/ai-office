package com.bonako.aioffice

import android.content.Context
import android.graphics.*
import android.view.View
import kotlin.math.cos
import kotlin.math.sin

/**
 * Ecrã de arranque da D.A.I.S.Y.
 *
 * Desenhado em Canvas e não em WebView, de propósito: este ecrã tem de
 * aparecer ANTES de existir qualquer ligação ao servidor. Se dependesse
 * da web app, uma falha de rede dava exatamente o ecrã preto que estamos
 * a tentar eliminar.
 *
 * O motivo visual é uma margarida vista de frente que também parece um
 * diafragma de lente: pétalas que abrem, anéis que rodam a velocidades
 * diferentes, e um varrimento que dá a volta.
 */
class DaisyBootView(context: Context) : View(context) {

    private val cianoClaro = Color.parseColor("#7DF9FF")
    private val ciano = Color.parseColor("#00E5FF")
    private val cianoEscuro = Color.parseColor("#0E7490")
    private val fundo = Color.parseColor("#04070F")
    private val texto = Color.parseColor("#CFE9F5")
    private val esmeralda = Color.parseColor("#34D399")

    private val pincel = Paint(Paint.ANTI_ALIAS_FLAG)
    private val pincelTexto = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = texto
        textSize = 30f
        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL)
    }
    private val pincelNome = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 74f
        letterSpacing = 0.22f
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        textAlign = Paint.Align.CENTER
    }

    private var inicio = 0L

    /** Linhas de log que vão aparecendo. Definidas de fora. */
    var linhas: List<String> = listOf()
        set(v) { field = v; postInvalidateOnAnimation() }

    /** 0..1 — progresso real, não decorativo. */
    var progresso: Float = 0f
        set(v) { field = v.coerceIn(0f, 1f); postInvalidateOnAnimation() }

    /** Mensagem de estado em baixo. */
    var estado: String = "a iniciar"
        set(v) { field = v; postInvalidateOnAnimation() }

    override fun onDraw(canvas: Canvas) {
        if (inicio == 0L) inicio = System.currentTimeMillis()
        val t = (System.currentTimeMillis() - inicio) / 1000f

        canvas.drawColor(fundo)

        val cx = width / 2f
        val cy = height * 0.38f
        val raio = minOf(width, height) * 0.19f

        desenharGrelha(canvas, t)
        desenharPetalas(canvas, cx, cy, raio, t)
        desenharAneis(canvas, cx, cy, raio, t)
        desenharCentro(canvas, cx, cy, raio, t)
        desenharVarrimento(canvas, cx, cy, raio * 1.85f, t)

        // Nome, a compor-se letra a letra
        val nome = "D.A.I.S.Y."
        val visiveis = (t / 0.16f).toInt().coerceIn(0, nome.length)
        pincelNome.alpha = ((t / 0.6f).coerceIn(0f, 1f) * 255).toInt()
        canvas.drawText(nome.substring(0, visiveis), cx, cy + raio * 2.6f, pincelNome)

        // Log
        var y = cy + raio * 3.6f
        for ((i, linha) in linhas.withIndex()) {
            val aparece = ((t - 0.35f - i * 0.28f) / 0.3f).coerceIn(0f, 1f)
            if (aparece <= 0f) break
            pincelTexto.color = texto
            pincelTexto.alpha = (aparece * 190).toInt()
            canvas.drawText(linha, width * 0.11f, y, pincelTexto)
            y += 42f
        }

        desenharProgresso(canvas, y + 30f)

        // Só continua a redesenhar enquanto for preciso: sem isto, o
        // ecrã fica a 60fps a gastar bateria depois de estar parado.
        postInvalidateOnAnimation()
    }

    private fun desenharGrelha(canvas: Canvas, t: Float) {
        pincel.style = Paint.Style.STROKE
        pincel.strokeWidth = 1f
        pincel.color = Color.argb(16, 125, 249, 255)
        val passo = 68f
        val desvio = (t * 9f) % passo
        var x = -passo + desvio
        while (x < width) { canvas.drawLine(x, 0f, x, height.toFloat(), pincel); x += passo }
        var y = -passo + desvio
        while (y < height) { canvas.drawLine(0f, y, width.toFloat(), y, pincel); y += passo }
    }

    private fun desenharPetalas(canvas: Canvas, cx: Float, cy: Float, raio: Float, t: Float) {
        val total = 12
        val caminho = Path()
        for (i in 0 until total) {
            // Cada pétala abre com um atraso próprio: é o que dá a
            // sensação de florir em vez de aparecer tudo de uma vez.
            val abre = ((t - 0.1f - i * 0.045f) / 0.55f).coerceIn(0f, 1f)
            if (abre <= 0f) continue
            val suave = 1f - (1f - abre) * (1f - abre) * (1f - abre)   // ease-out

            val ang = (i.toFloat() / total) * 360f + t * 6f
            canvas.save()
            canvas.rotate(ang, cx, cy)

            val comp = raio * 1.55f * suave
            val larg = raio * 0.30f * suave

            caminho.reset()
            caminho.moveTo(cx, cy - raio * 0.42f)
            caminho.cubicTo(cx + larg, cy - raio * 0.7f, cx + larg, cy - comp * 0.8f, cx, cy - comp)
            caminho.cubicTo(cx - larg, cy - comp * 0.8f, cx - larg, cy - raio * 0.7f, cx, cy - raio * 0.42f)

            pincel.style = Paint.Style.FILL
            pincel.shader = LinearGradient(
                cx, cy - comp, cx, cy - raio * 0.42f,
                Color.argb((70 * suave).toInt(), 0, 229, 255),
                Color.argb((16 * suave).toInt(), 14, 116, 144),
                Shader.TileMode.CLAMP
            )
            canvas.drawPath(caminho, pincel)
            pincel.shader = null

            pincel.style = Paint.Style.STROKE
            pincel.strokeWidth = 2f
            pincel.color = Color.argb((150 * suave).toInt(), 125, 249, 255)
            canvas.drawPath(caminho, pincel)

            canvas.restore()
        }
    }

    private fun desenharAneis(canvas: Canvas, cx: Float, cy: Float, raio: Float, t: Float) {
        pincel.style = Paint.Style.STROKE
        pincel.shader = null

        // Anel exterior tracejado, a rodar
        pincel.strokeWidth = 3f
        pincel.color = Color.argb(120, 0, 229, 255)
        val r1 = raio * 1.95f
        val arco = RectF(cx - r1, cy - r1, cx + r1, cy + r1)
        for (i in 0 until 24) {
            val a = i * 15f + t * 22f
            canvas.drawArc(arco, a, 7f, false, pincel)
        }

        // Anel interior, sentido contrário
        pincel.strokeWidth = 2f
        pincel.color = Color.argb(80, 52, 211, 153)
        val r2 = raio * 1.62f
        val arco2 = RectF(cx - r2, cy - r2, cx + r2, cy + r2)
        for (i in 0 until 8) {
            val a = i * 45f - t * 34f
            canvas.drawArc(arco2, a, 22f, false, pincel)
        }
    }

    private fun desenharCentro(canvas: Canvas, cx: Float, cy: Float, raio: Float, t: Float) {
        val pulso = 1f + 0.06f * sin(t * 3.1f)

        pincel.style = Paint.Style.FILL
        pincel.shader = RadialGradient(
            cx, cy, raio * 0.55f * pulso,
            intArrayOf(Color.WHITE, ciano, Color.argb(0, 0, 229, 255)),
            floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP
        )
        canvas.drawCircle(cx, cy, raio * 0.55f * pulso, pincel)
        pincel.shader = null

        // Estames: pequenos traços a irradiar, como no miolo da flor
        pincel.style = Paint.Style.STROKE
        pincel.strokeWidth = 2.5f
        pincel.color = Color.argb(150, 4, 7, 15)
        for (i in 0 until 16) {
            val a = Math.toRadians((i * 22.5f + t * 14f).toDouble())
            val r0 = raio * 0.16f
            val r1 = raio * 0.40f
            canvas.drawLine(
                cx + (cos(a) * r0).toFloat(), cy + (sin(a) * r0).toFloat(),
                cx + (cos(a) * r1).toFloat(), cy + (sin(a) * r1).toFloat(),
                pincel
            )
        }
    }

    private fun desenharVarrimento(canvas: Canvas, cx: Float, cy: Float, raio: Float, t: Float) {
        val ang = (t * 95f) % 360f
        pincel.style = Paint.Style.FILL
        pincel.shader = SweepGradient(
            cx, cy,
            intArrayOf(Color.argb(0, 0, 229, 255), Color.argb(46, 0, 229, 255), Color.argb(0, 0, 229, 255)),
            floatArrayOf(0f, 0.06f, 0.16f)
        )
        canvas.save()
        canvas.rotate(ang, cx, cy)
        canvas.drawCircle(cx, cy, raio, pincel)
        canvas.restore()
        pincel.shader = null
    }

    private fun desenharProgresso(canvas: Canvas, y: Float) {
        val margem = width * 0.11f
        val larguraTotal = width - margem * 2

        pincel.style = Paint.Style.FILL
        pincel.color = Color.argb(40, 125, 249, 255)
        canvas.drawRoundRect(margem, y, margem + larguraTotal, y + 8f, 4f, 4f, pincel)

        if (progresso > 0f) {
            pincel.shader = LinearGradient(
                margem, y, margem + larguraTotal, y,
                ciano, esmeralda, Shader.TileMode.CLAMP
            )
            canvas.drawRoundRect(margem, y, margem + larguraTotal * progresso, y + 8f, 4f, 4f, pincel)
            pincel.shader = null
        }

        pincelTexto.color = cianoClaro
        pincelTexto.alpha = 200
        pincelTexto.textSize = 26f
        canvas.drawText(estado, margem, y + 44f, pincelTexto)
        pincelTexto.textSize = 30f
    }
}
