package com.bonako.aioffice

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/**
 * A app inteira: quatro páginas que se deslizam lateralmente.
 *
 * Escritório, Construir e Gráficos são Compose nativo. O Vault é a única
 * que continua em WebView — é uma lista com pré-visualização de projetos,
 * onde a página web já faz o trabalho todo e não se ganha nada em
 * reescrevê-la.
 */
@Composable
fun DaisyApp(
    cliente: Cliente,
    baseUrl: String,
    token: String,
    voz: Voz,
    aoAbrirDefinicoes: () -> Unit,
) {
    val ligado by cliente.ligado.collectAsState()
    val pager = rememberPagerState(pageCount = { 4 })
    val ambito = rememberCoroutineScope()

    var aviso by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(aviso) {
        if (aviso != null) {
            kotlinx.coroutines.delay(2600)
            aviso = null
        }
    }

    LaunchedEffect(Unit) {
        // Tenta algumas vezes: à primeira abertura o servidor pode ainda
        // estar a acordar, e uma falha silenciosa deixava o ecrã vazio.
        repeat(4) {
            cliente.carregarAgentes()
            if (cliente.agentes.value.isNotEmpty()) return@repeat
            kotlinx.coroutines.delay(1500)
        }
        cliente.ligar()
    }
    DisposableEffect(Unit) { onDispose { cliente.desligar() } }

    Box(Modifier.fillMaxSize().background(FUNDO)) {
        Column(Modifier.fillMaxSize()) {

            // ---- cabeçalho ----
            Row(
                Modifier.fillMaxWidth().height(30.dp).padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                val pisca by rememberInfiniteTransition(label = "p").animateFloat(
                    0.45f, 1f,
                    infiniteRepeatable(tween(1400), RepeatMode.Reverse), label = "pisca"
                )
                Box(
                    Modifier.size(8.dp).clip(CircleShape).background(
                        if (ligado) Color(0xFF10B981).copy(alpha = pisca) else Color(0xFF3A4150)
                    )
                )
                Spacer(Modifier.width(7.dp))
                Text(
                    if (ligado) "ligado" else "a reconectar",
                    color = TEXTO_2, fontSize = 12.sp, fontWeight = FontWeight.Medium
                )
                Spacer(Modifier.weight(1f))
                Text(
                    listOf("Escritório", "Construir", "Gráficos", "Vault")[pager.currentPage],
                    color = TEXTO_2, fontSize = 12.sp
                )
            }

            // ---- páginas ----
            HorizontalPager(state = pager, modifier = Modifier.weight(1f)) { pagina ->
                when (pagina) {
                    0 -> EcraEscritorio(cliente) { a ->
                        aviso = "${a.nome} — ${textoEstado(a.estado)}"
                    }
                    1 -> EcraConstruir(cliente, voz) { aviso = it }
                    2 -> EcraGraficos(cliente)
                    else -> EcraVault(cliente, baseUrl, token) { aviso = it }
                }
            }

            // ---- pontos ----
            // Espaço à esquerda porque as lentes das câmaras ficam no canto
            // inferior esquerdo da Flex Window.
            Row(
                Modifier.fillMaxWidth().height(28.dp).padding(start = 64.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                repeat(4) { i ->
                    val ativo = pager.currentPage == i
                    Box(
                        Modifier.padding(horizontal = 4.dp)
                            .height(7.dp).width(if (ativo) 18.dp else 7.dp)
                            .clip(RoundedCornerShape(99.dp))
                            .background(if (ativo) TEXTO else Color(0xFF2A303A))
                            .clickable { ambito.launch { pager.animateScrollToPage(i) } }
                    )
                }
            }
        }

        // ---- aviso passageiro ----
        aviso?.let {
            Box(
                Modifier.align(Alignment.BottomCenter).padding(bottom = 34.dp, start = 12.dp, end = 12.dp)
                    .clip(RoundedCornerShape(10.dp)).background(Color(0xFF1C2029))
                    .border(1.dp, LINHA, RoundedCornerShape(10.dp))
                    .padding(horizontal = 13.dp, vertical = 9.dp)
            ) {
                Text(it, color = TEXTO, fontSize = 12.5.sp)
            }
        }
    }
}

/* ====================================================================
   CONSTRUIR — voz, correção e configuração da equipa
   ==================================================================== */

private enum class Modo { NOVO, CORRIGIR, EQUIPA }

private val CLIS = listOf("claude", "codex", "antigravity")
private val CLI_NOME = mapOf(
    "claude" to "Claude", "codex" to "Codex", "antigravity" to "Antigravity"
)
private val COMPLEXIDADES = listOf(
    "auto" to "Auto", "simples" to "Simples", "medio" to "Médio", "complexo" to "Complexo"
)

@Composable
private fun EcraConstruir(cliente: Cliente, voz: Voz, avisar: (String) -> Unit) {
    var modo by remember { mutableStateOf(Modo.NOVO) }
    var briefing by remember { mutableStateOf("") }
    var complexidade by remember { mutableStateOf("auto") }
    var stacks by remember { mutableStateOf<List<Stack>>(emptyList()) }
    var stack by remember { mutableStateOf("estatico") }
    var projetos by remember { mutableStateOf<List<Projeto>>(emptyList()) }
    var escolhido by remember { mutableStateOf<String?>(null) }
    var atribuicoes by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var aEnviar by remember { mutableStateOf(false) }

    val aOuvir by voz.aOuvir.collectAsState()
    val ouvido by voz.texto.collectAsState()
    val ambito = rememberCoroutineScope()

    // o que a voz apanha entra directamente no briefing
    LaunchedEffect(ouvido) { if (ouvido.isNotBlank()) briefing = ouvido }

    LaunchedEffect(Unit) { if (stacks.isEmpty()) stacks = cliente.stacks() }

    LaunchedEffect(modo) {
        if (modo == Modo.CORRIGIR && projetos.isEmpty()) projetos = cliente.projetos()
        if (modo == Modo.EQUIPA && atribuicoes.isEmpty()) atribuicoes = cliente.atribuicoes()
    }

    Column(
        Modifier.fillMaxSize().padding(horizontal = 10.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp)
    ) {
        // ---- separadores ----
        Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            listOf(Modo.NOVO to "Novo", Modo.CORRIGIR to "Corrigir", Modo.EQUIPA to "Equipa")
                .forEach { (m, etiqueta) ->
                    val on = modo == m
                    Box(
                        Modifier.weight(1f).clip(RoundedCornerShape(9.dp))
                            .background(if (on) TEXTO else CARTAO)
                            .border(1.dp, if (on) TEXTO else LINHA, RoundedCornerShape(9.dp))
                            .clickable { modo = m }
                            .padding(vertical = 9.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            etiqueta, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold,
                            color = if (on) Color.Black else TEXTO_2
                        )
                    }
                }
        }

        // ---- corpo conforme o modo ----
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (modo) {
                Modo.NOVO -> {
                    // A stack decide o que a equipa constrói. Fica aqui e
                    // não na Equipa porque muda de projeto para projeto,
                    // ao contrário da atribuição de CLIs.
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        item {
                            Text("O QUE VAMOS CONSTRUIR", color = TEXTO_2,
                                fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        }
                        items(stacks) { st ->
                            val on = stack == st.id
                            Row(
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                                    .background(if (on) Color(0xFF1A1E25) else CARTAO)
                                    .border(1.dp, if (on) TEXTO else LINHA, RoundedCornerShape(10.dp))
                                    .clickable(enabled = st.pronta) { stack = st.id }
                                    .padding(horizontal = 11.dp, vertical = 9.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        st.nome,
                                        color = if (st.pronta) TEXTO else TEXTO_2,
                                        fontSize = 13.sp, fontWeight = FontWeight.SemiBold
                                    )
                                    Text(
                                        // uma stack sem chaves configuradas aparece
                                        // mas não deixa escolher, e diz porquê
                                        if (st.pronta) st.resumo else "faltam chaves no servidor",
                                        color = TEXTO_2, fontSize = 10.5.sp, lineHeight = 14.sp,
                                        maxLines = 2, overflow = TextOverflow.Ellipsis
                                    )
                                }
                                if (on) Text("✓", color = Color(0xFF10B981),
                                    fontSize = 15.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                        item {
                            Spacer(Modifier.height(3.dp))
                            Text("COMPLEXIDADE", color = TEXTO_2,
                                fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        }
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                COMPLEXIDADES.forEach { (v, etiqueta) ->
                                    val on = complexidade == v
                                    Box(
                                        Modifier.weight(1f).clip(RoundedCornerShape(8.dp))
                                            .background(if (on) TEXTO else CARTAO)
                                            .border(1.dp, if (on) TEXTO else LINHA,
                                                RoundedCornerShape(8.dp))
                                            .clickable { complexidade = v }
                                            .padding(vertical = 8.dp),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Text(etiqueta, fontSize = 11.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            color = if (on) Color.Black else TEXTO_2)
                                    }
                                }
                            }
                        }
                    }
                }

                Modo.CORRIGIR -> {
                    if (projetos.isEmpty()) {
                        Text("Ainda não há plataformas para corrigir.",
                            color = TEXTO_2, fontSize = 12.5.sp)
                    } else {
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            items(projetos) { p ->
                                val on = escolhido == p.id
                                Row(
                                    Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                                        .background(if (on) Color(0xFF1A1E25) else CARTAO)
                                        .border(1.dp, if (on) TEXTO else LINHA, RoundedCornerShape(10.dp))
                                        .clickable { escolhido = if (on) null else p.id }
                                        .padding(horizontal = 11.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Box(
                                        Modifier.size(9.dp).clip(CircleShape).background(
                                            when (p.estado) {
                                                "done" -> Color(0xFF10B981)
                                                "failed" -> Color(0xFFEF4444)
                                                else -> Color(0xFFF59E0B)
                                            }
                                        )
                                    )
                                    Spacer(Modifier.width(9.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(p.nome, color = TEXTO, fontSize = 13.5.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text(
                                            "${p.ficheiros} ficheiros" +
                                                if (p.revisoes > 0) " · ${p.revisoes} alt." else "",
                                            color = TEXTO_2, fontSize = 11.sp
                                        )
                                    }
                                    if (on) Text("✓", color = Color(0xFF10B981),
                                        fontSize = 15.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }
                }

                Modo.EQUIPA -> {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        item {
                            Text("QUEM CORRE EM QUÊ", color = TEXTO_2, fontSize = 10.sp,
                                fontWeight = FontWeight.Bold)
                        }
                        items(ORDEM) { id ->
                            val cli = atribuicoes[id] ?: "—"
                            Row(
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp))
                                    .background(CARTAO).border(1.dp, LINHA, RoundedCornerShape(9.dp))
                                    .padding(horizontal = 10.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Box(Modifier.size(8.dp).clip(CircleShape).background(corDe(id)))
                                Spacer(Modifier.width(8.dp))
                                Text(nomeAgente(id), color = TEXTO, fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                                Box(
                                    Modifier.clip(RoundedCornerShape(99.dp))
                                        .background(Color(0xFF1B1F26))
                                        .border(1.dp, LINHA, RoundedCornerShape(99.dp))
                                        .clickable {
                                            val i = CLIS.indexOf(cli)
                                            val novo = CLIS[(i + 1) % CLIS.size]
                                            atribuicoes = atribuicoes + (id to novo)
                                            ambito.launch {
                                                val (ok, erro) = cliente.gravarAtribuicoes(atribuicoes)
                                                if (!ok) {
                                                    avisar(erro)
                                                    atribuicoes = cliente.atribuicoes()
                                                }
                                            }
                                        }
                                        .padding(horizontal = 11.dp, vertical = 5.dp)
                                ) {
                                    Text(CLI_NOME[cli] ?: cli, color = TEXTO,
                                        fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }
                }
            }
        }

        // ---- ditado + envio (escondidos na configuração) ----
        if (modo != Modo.EQUIPA) {
            Box(
                Modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(10.dp))
                    .background(CARTAO).border(1.dp, LINHA, RoundedCornerShape(10.dp))
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 11.dp, vertical = 9.dp)
            ) {
                Text(
                    briefing.ifBlank { "Toca no micro e dita o que queres." },
                    color = if (briefing.isBlank()) TEXTO_2 else TEXTO,
                    fontSize = 13.5.sp, lineHeight = 18.sp
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                // micro
                Box(
                    Modifier.width(62.dp).height(50.dp).clip(RoundedCornerShape(12.dp))
                        .background(if (aOuvir) Color(0xFF2A1116) else CARTAO)
                        .border(1.dp, if (aOuvir) CORES["qa"]!! else LINHA, RoundedCornerShape(12.dp))
                        .clickable { if (aOuvir) voz.parar() else voz.comecar() },
                    contentAlignment = Alignment.Center
                ) {
                    val alfa by rememberInfiniteTransition(label = "m").animateFloat(
                        0.4f, 1f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "alfa"
                    )
                    Box(
                        Modifier.size(17.dp).clip(CircleShape).background(
                            if (aOuvir) Color(0xFFFFD9DE).copy(alpha = alfa) else TEXTO
                        )
                    )
                }

                // enviar
                val podeEnviar = briefing.isNotBlank() &&
                    (modo == Modo.NOVO || escolhido != null) && !aEnviar
                Box(
                    Modifier.weight(1f).height(50.dp).clip(RoundedCornerShape(12.dp))
                        .background(if (podeEnviar) TEXTO else TEXTO.copy(alpha = 0.3f))
                        .clickable(enabled = podeEnviar) {
                            aEnviar = true
                            ambito.launch {
                                val (ok, erro) = if (modo == Modo.CORRIGIR)
                                    cliente.corrigir(escolhido!!, briefing, complexidade)
                                else cliente.construir(briefing, complexidade, stack)

                                if (ok) {
                                    avisar(if (modo == Modo.CORRIGIR) "A equipa vai corrigir." else "A equipa arrancou.")
                                    briefing = ""
                                    voz.limpar()
                                } else avisar(erro)
                                aEnviar = false
                            }
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        if (modo == Modo.CORRIGIR) "Corrigir" else "Construir",
                        color = Color.Black, fontSize = 15.sp, fontWeight = FontWeight.Bold
                    )
                }
            }
        }
        Spacer(Modifier.height(2.dp))
    }
}

fun nomeAgente(id: String) = when (id) {
    "ceo" -> "CEO"
    "cto" -> "CTO"
    "designer" -> "Designer"
    "developer" -> "Developer"
    "qa" -> "QA Tester"
    else -> id
}
