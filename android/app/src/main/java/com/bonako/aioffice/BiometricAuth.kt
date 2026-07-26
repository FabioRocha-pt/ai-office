package com.bonako.aioffice

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.os.Build
import android.content.Context
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Acesso à D.A.I.S.Y. por impressão digital.
 *
 * Como isto funciona, porque é contraintuitivo: a impressão digital NÃO
 * é enviada para o servidor e não é comparada por nós. Ela nunca sai do
 * enclave seguro do telemóvel.
 *
 * O que acontece é outra coisa:
 *
 *   1. Uma vez só, escreves utilizador e password. A app troca-os por um
 *      token de longa duração no /auth/token.
 *   2. O token é cifrado com uma chave AES que vive no Keystore do
 *      Android, criada com setUserAuthenticationRequired(true). Essa
 *      chave é inutilizável sem uma autenticação biométrica — a proteção
 *      é imposta pelo hardware, não por código nosso.
 *   3. Nos arranques seguintes, o sensor desbloqueia a chave, a chave
 *      decifra o token, e o token entra no cookie do WebView.
 *
 * Consequência prática: mesmo com o telemóvel na mão e acesso ao
 * armazenamento da app, o token cifrado não serve de nada a ninguém sem
 * o teu dedo.
 */
object BiometricAuth {

    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "daisy_token_key"
    private const val PREFS = "daisy"
    private const val CHAVE_TOKEN = "token_cifrado"
    private const val CHAVE_IV = "token_iv"
    private const val TRANSFORMACAO = "AES/GCM/NoPadding"
    private const val TAG_BITS = 128

    /* ─────────── disponibilidade ─────────── */

    /** O aparelho tem biometria utilizável e já registada? */
    fun disponivel(ctx: Context): Boolean =
        BiometricManager.from(ctx).canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG
        ) == BiometricManager.BIOMETRIC_SUCCESS

    /** Mensagem legível para o caso de não estar disponível. */
    fun motivoIndisponivel(ctx: Context): String =
        when (BiometricManager.from(ctx).canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG)) {
            BiometricManager.BIOMETRIC_SUCCESS ->
                "Disponível."
            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE ->
                "Este aparelho não tem sensor biométrico."
            BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE ->
                "O sensor está temporariamente indisponível."
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED ->
                "Não há impressões digitais registadas. Adiciona uma nas Definições do Android."
            BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED ->
                "É necessária uma atualização de segurança do Android."
            else ->
                "Biometria indisponível neste aparelho."
        }

    fun temTokenGuardado(ctx: Context): Boolean =
        prefs(ctx).contains(CHAVE_TOKEN)

    private fun prefs(ctx: Context) =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /* ─────────── chave no Keystore ─────────── */

    private fun criarChave(): SecretKey {
        val gerador = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)

        val spec = KeyGenParameterSpec.Builder(
            ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            // O ponto central: a chave exige autenticação do utilizador.
            .setUserAuthenticationRequired(true)
            // Se alguém registar uma impressão digital nova, a chave é
            // invalidada. Sem isto, quem tivesse o telemóvel desbloqueado
            // podia adicionar o próprio dedo e passar a ter acesso.
            .setInvalidatedByBiometricEnrollment(true)
            .apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    // 0 segundos de validade = exige autenticação a CADA uso
                    setUserAuthenticationParameters(
                        0, KeyProperties.AUTH_BIOMETRIC_STRONG
                    )
                } else {
                    @Suppress("DEPRECATION")
                    setUserAuthenticationValidityDurationSeconds(-1)
                }
            }
            .build()

        gerador.init(spec)
        return gerador.generateKey()
    }

    private fun chaveExistente(): SecretKey? {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        return ks.getKey(ALIAS, null) as? SecretKey
    }

    private fun apagarChave() {
        try {
            KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(ALIAS)
        } catch (_: Exception) { }
    }

    /** Esquece token e chave. Usar quando o servidor devolver 401. */
    fun esquecer(ctx: Context) {
        prefs(ctx).edit().remove(CHAVE_TOKEN).remove(CHAVE_IV).apply()
        apagarChave()
    }

    /* ─────────── guardar (primeira vez) ─────────── */

    /**
     * Cifra e guarda o token. Pede biometria uma vez para o fazer, o que
     * confirma logo que o sensor funciona antes de dependermos dele.
     */
    fun guardar(
        activity: FragmentActivity,
        token: String,
        aoConcluir: (Boolean, String?) -> Unit
    ) {
        try {
            apagarChave()            // recomeça limpo em caso de reemparelhamento
            val chave = criarChave()
            val cifra = Cipher.getInstance(TRANSFORMACAO).apply { init(Cipher.ENCRYPT_MODE, chave) }

            pedirBiometria(
                activity,
                titulo = "Guardar acesso à D.A.I.S.Y.",
                subtitulo = "Confirma com a impressão digital",
                cifra = cifra,
                aoFalhar = { msg -> aoConcluir(false, msg) }
            ) { c ->
                val cifrado = c.doFinal(token.toByteArray(Charsets.UTF_8))
                prefs(activity).edit()
                    .putString(CHAVE_TOKEN, Base64.encodeToString(cifrado, Base64.NO_WRAP))
                    .putString(CHAVE_IV, Base64.encodeToString(c.iv, Base64.NO_WRAP))
                    .apply()
                aoConcluir(true, null)
            }
        } catch (e: Exception) {
            aoConcluir(false, "Não consegui preparar o Keystore: ${e.message}")
        }
    }

    /* ─────────── ler (arranques seguintes) ─────────── */

    fun desbloquear(
        activity: FragmentActivity,
        aoConcluir: (String?, String?) -> Unit
    ) {
        val p = prefs(activity)
        val cifrado = p.getString(CHAVE_TOKEN, null)
        val ivB64 = p.getString(CHAVE_IV, null)
        if (cifrado == null || ivB64 == null) {
            return aoConcluir(null, "Ainda não há acesso guardado.")
        }

        val chave = chaveExistente()
        if (chave == null) {
            // Acontece quando registaram uma biometria nova: a chave foi
            // invalidada de propósito. Não é erro — é a proteção a agir.
            esquecer(activity)
            return aoConcluir(null, "A biometria do aparelho mudou. Volta a introduzir as credenciais.")
        }

        try {
            val iv = Base64.decode(ivB64, Base64.NO_WRAP)
            val cifra = Cipher.getInstance(TRANSFORMACAO).apply {
                init(Cipher.DECRYPT_MODE, chave, GCMParameterSpec(TAG_BITS, iv))
            }

            pedirBiometria(
                activity,
                titulo = "D.A.I.S.Y.",
                subtitulo = "Impressão digital para entrar",
                cifra = cifra,
                aoFalhar = { msg -> aoConcluir(null, msg) }
            ) { c ->
                val bruto = c.doFinal(Base64.decode(cifrado, Base64.NO_WRAP))
                aoConcluir(String(bruto, Charsets.UTF_8), null)
            }
        } catch (e: Exception) {
            esquecer(activity)
            aoConcluir(null, "Acesso guardado ilegível. Volta a introduzir as credenciais.")
        }
    }

    /* ─────────── prompt ─────────── */

    private fun pedirBiometria(
        activity: FragmentActivity,
        titulo: String,
        subtitulo: String,
        cifra: Cipher,
        aoFalhar: (String) -> Unit,
        aoConseguir: (Cipher) -> Unit
    ) {
        val executor = ContextCompat.getMainExecutor(activity)

        val prompt = BiometricPrompt(activity, executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(r: BiometricPrompt.AuthenticationResult) {
                    val c = r.cryptoObject?.cipher
                    if (c == null) aoFalhar("O sistema não devolveu a cifra autenticada.")
                    else try { aoConseguir(c) } catch (e: Exception) {
                        aoFalhar("Falhou a decifrar: ${e.message}")
                    }
                }
                override fun onAuthenticationError(codigo: Int, msg: CharSequence) {
                    // Cancelar não é erro a reportar com alarme
                    if (codigo == BiometricPrompt.ERROR_USER_CANCELED ||
                        codigo == BiometricPrompt.ERROR_NEGATIVE_BUTTON) {
                        aoFalhar("Cancelado.")
                    } else {
                        aoFalhar(msg.toString())
                    }
                }
                // onAuthenticationFailed é uma leitura que não bateu certo;
                // o prompt continua aberto, por isso não fazemos nada.
            })

        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle(titulo)
                .setSubtitle(subtitulo)
                .setNegativeButtonText("Cancelar")
                // Só BIOMETRIC_STRONG: obrigatório para usar chaves do
                // Keystore. Aceitar credenciais do aparelho (PIN) aqui
                // faria o CryptoObject deixar de funcionar.
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .setConfirmationRequired(false)
                .build(),
            BiometricPrompt.CryptoObject(cifra)
        )
    }
}
