package com.bonako.aioffice

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Ditado por voz com o SpeechRecognizer do Android.
 *
 * É a razão pela qual esta app existe em vez de ser só uma página web: o
 * webkitSpeechRecognition não existe dentro de um WebView, por isso a voz
 * simplesmente não funcionaria. Aqui é nativo, em pt-PT, e com 2,5s de
 * silêncio antes de cortar — os briefings são frases longas e o valor por
 * omissão cortava a meio.
 */
class Voz(private val contexto: Context) {

    private val _aOuvir = MutableStateFlow(false)
    val aOuvir: StateFlow<Boolean> = _aOuvir

    private val _texto = MutableStateFlow("")
    val texto: StateFlow<String> = _texto

    private val _erro = MutableStateFlow<String?>(null)
    val erro: StateFlow<String?> = _erro

    private var motor: SpeechRecognizer? = null

    fun limpar() { _texto.value = "" }

    fun comecar() {
        if (_aOuvir.value) return

        if (!SpeechRecognizer.isRecognitionAvailable(contexto)) {
            _erro.value = "Este telemóvel não tem reconhecimento de voz."
            return
        }

        motor?.destroy()
        motor = SpeechRecognizer.createSpeechRecognizer(contexto).apply {
            setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(p: Bundle?) { _aOuvir.value = true }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(v: Float) {}
                override fun onBufferReceived(b: ByteArray?) {}
                override fun onEndOfSpeech() {}

                override fun onPartialResults(b: Bundle?) {
                    b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()?.let { _texto.value = it }
                }

                override fun onResults(b: Bundle?) {
                    b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()?.let { if (it.isNotBlank()) _texto.value = it }
                    _aOuvir.value = false
                }

                override fun onError(codigo: Int) {
                    _aOuvir.value = false
                    _erro.value = descrever(codigo)
                }

                override fun onEvent(t: Int, b: Bundle?) {}
            })
        }

        val intencao = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-PT")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
            if (Build.VERSION.SDK_INT >= 33) {
                putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, "quality")
            }
        }

        _texto.value = ""
        motor?.startListening(intencao)
    }

    fun parar() {
        if (!_aOuvir.value) return
        _aOuvir.value = false
        motor?.stopListening()
    }

    fun destruir() {
        motor?.destroy()
        motor = null
    }

    private fun descrever(c: Int) = when (c) {
        SpeechRecognizer.ERROR_AUDIO -> "Problema a gravar áudio."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Falta autorização do micro."
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Sem rede para reconhecer voz."
        SpeechRecognizer.ERROR_NO_MATCH -> "Não percebi. Tenta outra vez."
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "O reconhecimento está ocupado."
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Não ouvi nada."
        else -> "Falhou o reconhecimento ($c)."
    }
}
