package com.bonako.aioffice

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.sin

/**
 * O robô, desenhado em Canvas nativo.
 *
 * Antes isto era um SVG dentro de um WebView. Aqui é geometria pura, o
 * que dá duas coisas que o SVG não dava: as animações correm no mesmo
 * ciclo de composição do resto do ecrã (sem um motor de layout inteiro
 * pelo meio), e podemos animar propriedades contínuas — a pálpebra fecha
 * gradualmente em vez de saltar entre dois estados de CSS.
 *
 * Coordenadas pensadas numa tela de 100 x 104, escalada para o espaço
 * disponível. Mantém as proporções do desenho original.
 */

enum class EstadoRobo { DORME, TRABALHA, PRONTO, FALHOU }

private val CREME = Color(0xFFEFEDE0)
private val NAVY = Color(0xFF1B2A4A)
private val NAVY_CLARO = Color(0xFF2A3B62)
private val CINZA = Color(0xFF94A3B8)

@Composable
fun Robo(
    estado: EstadoRobo,
    cor: Color,
    modifier: Modifier = Modifier,
    semente: Float = 0f,
) {
    val transicao = rememberInfiniteTransition(label = "robo")

    // Respiração: sobe e desce devagar. É o que faz o robô parecer vivo
    // mesmo quando não está a fazer nada.
    val respirar by transicao.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(
            tween(3400, easing = LinearEasing), RepeatMode.Restart
        ), label = "respirar"
    )

    // Teclado: oscilação rápida dos braços e do corpo
    val teclar by transicao.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(
            tween(260, easing = LinearEasing), RepeatMode.Restart
        ), label = "teclar"
    )

    // Varrimento da viseira
    val varrer by transicao.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(
            tween(2100, easing = LinearEasing), RepeatMode.Restart
        ), label = "varrer"
    )

    // Zzz a subir
    val sono by transicao.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(
            tween(3400, easing = LinearEasing), RepeatMode.Restart
        ), label = "sono"
    )

    // Saltinho de quem entregou
    val salto by transicao.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(
            tween(1600, easing = LinearEasing), RepeatMode.Restart
        ), label = "salto"
    )

    // Pálpebra: anima entre fechada (dorme) e aberta. Sendo um valor
    // contínuo, a transição de estado é suave em vez de instantânea.
    val palpebra by animateFloatAsState(
        targetValue = when (estado) {
            EstadoRobo.DORME -> 0.14f
            EstadoRobo.FALHOU -> 0f
            else -> 1f
        },
        animationSpec = tween(320), label = "palpebra"
    )

    Canvas(modifier = modifier) {
        val escala = minOf(size.width / 100f, size.height / 104f)
        val larg = 100f * escala
        val alt = 104f * escala
        val dx = (size.width - larg) / 2f
        val dy = (size.height - alt) / 2f

        translate(dx, dy) {
            desenharRobo(
                escala = escala,
                estado = estado,
                cor = cor,
                palpebra = palpebra,
                respirar = respirar,
                teclar = teclar,
                varrer = varrer,
                sono = sono,
                salto = salto,
                semente = semente,
            )
        }
    }
}

private fun DrawScope.desenharRobo(
    escala: Float,
    estado: EstadoRobo,
    cor: Color,
    palpebra: Float,
    respirar: Float,
    teclar: Float,
    varrer: Float,
    sono: Float,
    salto: Float,
    semente: Float,
) {
    fun p(v: Float) = v * escala
    fun off(x: Float, y: Float) = Offset(p(x), p(y))
    fun sz(w: Float, h: Float) = Size(p(w), p(h))
    fun r(v: Float) = CornerRadius(p(v), p(v))

    // ---- deslocamento vertical conforme o estado ----
    val fase = respirar * 2f * Math.PI.toFloat() + semente
    val desloc = when (estado) {
        EstadoRobo.DORME -> sin(fase) * 2.5f
        EstadoRobo.TRABALHA -> -abs(sin(teclar * Math.PI.toFloat())) * 1.6f
        EstadoRobo.PRONTO -> {
            // salta só no fim do ciclo, o resto do tempo está parado
            val t = salto
            if (t > 0.7f) -sin((t - 0.7f) / 0.3f * Math.PI.toFloat()) * 5f else 0f
        }
        EstadoRobo.FALHOU -> 3f
    }

    translate(0f, p(desloc)) {

        // ---- braços ----
        // A trabalhar, alternam; parado, ficam quietos.
        val batida = if (estado == EstadoRobo.TRABALHA)
            sin(teclar * 2f * Math.PI.toFloat()) * p(2.2f) else 0f

        translate(0f, batida) {
            drawRoundRect(CREME, off(10f, 62f), sz(17f, 26f), r(8.5f))
            drawRoundRect(NAVY, off(12f, 84f), sz(4f, 9f), r(2f))
            drawRoundRect(NAVY, off(18f, 85f), sz(4f, 8f), r(2f))
        }
        translate(0f, -batida) {
            drawRoundRect(CREME, off(73f, 62f), sz(17f, 26f), r(8.5f))
            drawRoundRect(NAVY, off(78f, 85f), sz(4f, 8f), r(2f))
            drawRoundRect(NAVY, off(84f, 84f), sz(4f, 9f), r(2f))
        }

        // ---- tronco ----
        drawRoundRect(CREME, off(19f, 60f), sz(62f, 30f), r(11f))
        // base escura, o "queixo" arredondado do corpo
        val base = Path().apply {
            moveTo(p(22f), p(80f))
            cubicTo(p(28f), p(96f), p(72f), p(96f), p(78f), p(80f))
            close()
        }
        drawPath(base, NAVY.copy(alpha = 0.92f))
        // sombra do ombro
        drawRoundRect(
            NAVY_CLARO.copy(alpha = 0.45f),
            off(24f, 60f), sz(52f, 7f), r(5f)
        )

        // ---- orelhas ----
        drawRoundRect(cor, off(4f, 20f), sz(17f, 30f), r(8.5f))
        drawRoundRect(cor, off(79f, 20f), sz(17f, 30f), r(8.5f))

        // ---- cabeça ----
        drawRoundRect(CREME, off(13f, 6f), sz(74f, 56f), r(17f))
        drawRoundRect(Color.White.copy(alpha = 0.5f), off(13f, 6f), sz(74f, 14f), r(7f))

        // ---- viseira ----
        drawRoundRect(NAVY, off(21f, 15f), sz(58f, 35f), r(11f))

        // varrimento: só a trabalhar
        if (estado == EstadoRobo.TRABALHA) {
            val x = 21f + varrer * 44f
            drawRoundRect(
                cor.copy(alpha = 0.26f),
                off(x, 15f), sz(14f, 35f), r(7f)
            )
        }
        drawRoundRect(Color.White.copy(alpha = 0.07f), off(25f, 20f), sz(50f, 7f), r(3.5f))

        // ---- olhos ----
        when (estado) {
            EstadoRobo.FALHOU -> {
                // cruzes cinzentas
                val t = Stroke(width = p(3.4f), cap = StrokeCap.Round)
                drawLine(CINZA, off(36f, 28f), off(43f, 36f), t.width, StrokeCap.Round)
                drawLine(CINZA, off(43f, 28f), off(36f, 36f), t.width, StrokeCap.Round)
                drawLine(CINZA, off(57f, 28f), off(64f, 36f), t.width, StrokeCap.Round)
                drawLine(CINZA, off(64f, 28f), off(57f, 36f), t.width, StrokeCap.Round)
            }
            EstadoRobo.PRONTO -> {
                // arcos contentes
                val arco = Stroke(width = p(4f), cap = StrokeCap.Round)
                listOf(35f, 56f).forEach { x0 ->
                    val caminho = Path().apply {
                        moveTo(p(x0), p(36f))
                        quadraticBezierTo(p(x0 + 4.5f), p(28f), p(x0 + 9f), p(36f))
                    }
                    drawPath(caminho, cor, style = arco)
                }
            }
            else -> {
                // retângulos que encolhem em altura conforme a pálpebra
                val altura = 17f * palpebra
                val topo = 24f + (17f - altura) / 2f
                drawRoundRect(cor, off(35f, topo), sz(9f, altura), r(4.5f * palpebra))
                drawRoundRect(cor, off(56f, topo), sz(9f, altura), r(4.5f * palpebra))
            }
        }
    }

    // ---- zzz, fora do deslocamento do corpo ----
    if (estado == EstadoRobo.DORME) {
        desenharZzz(cor, sono, ::p)
    }
}

/** Dois 'z' a subir e a desvanecer, desfasados no tempo. */
private fun DrawScope.desenharZzz(cor: Color, t: Float, p: (Float) -> Float) {
    fun umZ(fase: Float, x0: Float, y0: Float, tam: Float) {
        val f = (t + fase) % 1f
        val alfa = when {
            f < 0.3f -> f / 0.3f
            else -> 1f - (f - 0.3f) / 0.7f
        }.coerceIn(0f, 1f) * 0.9f
        if (alfa <= 0.01f) return

        val dx = f * 6f
        val dy = -f * 11f
        val s = tam * (0.7f + f * 0.45f)
        val c = cor.copy(alpha = alfa)
        val e = Stroke(width = p(1.8f), cap = StrokeCap.Round)

        val x = x0 + dx
        val y = y0 + dy
        val z = Path().apply {
            moveTo(p(x), p(y))
            lineTo(p(x + s), p(y))
            lineTo(p(x), p(y + s))
            lineTo(p(x + s), p(y + s))
        }
        drawPath(z, c, style = e)
    }
    umZ(0f, 74f, 12f, 6f)
    umZ(0.5f, 84f, 6f, 4.5f)
}
