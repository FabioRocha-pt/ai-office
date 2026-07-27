package com.bonako.aioffice

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.*

/**
 * Mantém a ligação ao escritório viva com a app fechada.
 *
 * O caso de uso é este: ditas o briefing no ecrã exterior, fechas o
 * telemóvel, e vais fazer outra coisa. Sem isto, ou ficavas a espreitar
 * a app, ou só descobrias que tinha acabado na próxima vez que a
 * abrisses.
 *
 * Um serviço em primeiro plano é a única forma de o Android permitir uma
 * ligação de rede duradoura com a app em segundo plano — daí a
 * notificação permanente, que é a contrapartida imposta pelo sistema.
 */
class ServicoEstado : Service() {

    companion object {
        private const val CANAL_ESTADO = "daisy_estado"
        private const val CANAL_AVISOS = "daisy_avisos"
        private const val ID_PERMANENTE = 1
        private var idAviso = 100

        const val EXTRA_URL = "url"
        const val EXTRA_TOKEN = "token"

        fun arrancar(ctx: Context, baseUrl: String, token: String) {
            val i = Intent(ctx, ServicoEstado::class.java).apply {
                putExtra(EXTRA_URL, baseUrl)
                putExtra(EXTRA_TOKEN, token)
            }
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i)
            else ctx.startService(i)
        }

        fun parar(ctx: Context) {
            ctx.stopService(Intent(ctx, ServicoEstado::class.java))
        }
    }

    private val ambito = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var cliente: Cliente? = null
    private var ultimoProjeto: String? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        criarCanais()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val url = intent?.getStringExtra(EXTRA_URL)
        val token = intent?.getStringExtra(EXTRA_TOKEN)

        if (url.isNullOrBlank() || token.isNullOrBlank()) {
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(ID_PERMANENTE, permanente("À escuta do escritório"))

        if (cliente == null) {
            // Com a app aberta há duas ligações ao mesmo servidor: a do
            // ecrã e a deste serviço. É desperdício pequeno e o servidor
            // difunde para todas; partilhar uma só exigia vincular o
            // serviço à activity, o que traz mais problemas do que
            // resolve. A do ecrã fecha-se sozinha quando a app sai.
            val c = Cliente(url, token)
            cliente = c
            ambito.launch { c.carregarAgentes() }
            c.ligar()
            observar(c)
        }

        // START_STICKY: se o sistema matar o serviço por pressão de
        // memória, volta a arrancá-lo quando houver folga.
        return START_STICKY
    }

    private fun observar(c: Cliente) {
        // Nome do projeto em curso, para a notificação dizer o que está
        // a ser construído em vez de "a trabalhar".
        ambito.launch {
            c.projetoAtual.collect { ultimoProjeto = it }
        }

        ambito.launch {
            var estavaACorrer = false
            c.aCorrer.collect { correndo ->
                if (correndo) {
                    estavaACorrer = true
                    atualizarPermanente(
                        ultimoProjeto?.let { "A construir: $it" } ?: "A equipa está a trabalhar"
                    )
                } else if (estavaACorrer) {
                    // Só notifica na transição: sem isto, cada reconexão
                    // do WebSocket disparava um aviso.
                    estavaACorrer = false
                    atualizarPermanente("À escuta do escritório")
                    avisar(
                        "Plataforma pronta",
                        ultimoProjeto ?: "A equipa terminou o trabalho."
                    )
                }
            }
        }

        ambito.launch {
            c.agentes.collect { lista ->
                val falhou = lista.firstOrNull { it.estado == "error" } ?: return@collect
                avisar("${falhou.nome} falhou", "Abre a Daisy para veres o que aconteceu.")
            }
        }
    }

    /* ---------------- notificações ---------------- */

    private fun criarCanais() {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = getSystemService(NotificationManager::class.java)

        // Canal do estado: silencioso e discreto. É permanente, e uma
        // notificação permanente que faz barulho é insuportável.
        nm.createNotificationChannel(
            NotificationChannel(CANAL_ESTADO, "Estado do escritório", NotificationManager.IMPORTANCE_MIN)
                .apply { setShowBadge(false) }
        )

        nm.createNotificationChannel(
            NotificationChannel(CANAL_AVISOS, "Trabalho concluído", NotificationManager.IMPORTANCE_DEFAULT)
                .apply { description = "Quando a equipa acaba uma plataforma" }
        )
    }

    private fun abrirApp(): PendingIntent = PendingIntent.getActivity(
        this, 0,
        Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    private fun permanente(texto: String) =
        NotificationCompat.Builder(this, CANAL_ESTADO)
            .setContentTitle("Daisy")
            .setContentText(texto)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setContentIntent(abrirApp())
            .build()

    private fun atualizarPermanente(texto: String) {
        runCatching {
            NotificationManagerCompat.from(this).notify(ID_PERMANENTE, permanente(texto))
        }
    }

    private fun avisar(titulo: String, texto: String) {
        runCatching {
            NotificationManagerCompat.from(this).notify(
                idAviso++,
                NotificationCompat.Builder(this, CANAL_AVISOS)
                    .setContentTitle(titulo)
                    .setContentText(texto)
                    .setSmallIcon(android.R.drawable.stat_notify_chat)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setAutoCancel(true)
                    .setContentIntent(abrirApp())
                    .build()
            )
        }
    }

    override fun onDestroy() {
        cliente?.desligar()
        cliente = null
        ambito.cancel()
        super.onDestroy()
    }
}
