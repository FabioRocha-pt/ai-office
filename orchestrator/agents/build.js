// A etapa de build. Não é um agente: é um passo mecânico entre o
// Developer e o QA, que instala dependências e compila.
//
// Aparece no painel como se fosse um agente (mesmo streaming, mesmo
// registo de etapa) porque é isso que o utilizador quer ver. Mas não
// chama modelo nenhum e, portanto, não gasta quota.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// npm install de um Next.js leva 1 a 3 minutos; o build mais um par. Os
// 10 minutos dos agentes não chegam com folga, e um timeout apertado dá
// falhas que parecem erros de código e não são.
// 30 minutos, não 20: um npm install frio num disco lento passa
// facilmente dos 20, e morrer no build depois de os cinco agentes terem
// corrido bem é o pior sítio para falhar — perde-se a corrida inteira.
const BUILD_TIMEOUT_MS = Number(process.env.BUILD_TIMEOUT_MS) || 30 * 60 * 1000;

// Cada projeto Next.js são 300-500 MB de node_modules. Começar um build
// sem espaço deixa a pasta a meio e enche o disco da VPS — mais vale
// falhar já, com uma mensagem que se percebe.
const MIN_DISCO_MB = Number(process.env.MIN_DISCO_MB) || 2048;

function espacoLivreMB(dir) {
  try {
    // fs.statfsSync existe a partir do Node 18.15
    const s = fs.statfsSync(dir);
    return Math.floor((s.bavail * s.bsize) / (1024 * 1024));
  } catch {
    return null;   // sem forma de saber: seguimos em frente
  }
}

function correr(cmd, dir, onData, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    // shell:true porque os comandos vêm do catálogo com flags, e queremos
    // escrevê-los como se escreveriam no terminal.
    const filho = spawn(cmd, {
      cwd: dir, shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", NEXT_TELEMETRY_DISABLED: "1", ...extraEnv },
    });

    let saida = "";
    let terminou = false;

    const temporizador = setTimeout(() => {
      if (terminou) return;
      terminou = true;
      filho.kill("SIGKILL");
      reject(new Error(`'${cmd}' passou dos ${Math.round(BUILD_TIMEOUT_MS / 60000)} minutos.`));
    }, BUILD_TIMEOUT_MS);

    const apanhar = (b) => {
      const texto = b.toString();
      saida += texto;
      onData(texto);
    };
    filho.stdout.on("data", apanhar);
    filho.stderr.on("data", apanhar);

    filho.on("error", (e) => {
      if (terminou) return;
      terminou = true; clearTimeout(temporizador);
      reject(new Error(`Não consegui executar '${cmd}': ${e.message}`));
    });

    filho.on("close", (codigo) => {
      if (terminou) return;
      terminou = true; clearTimeout(temporizador);
      if (codigo !== 0) {
        // As últimas linhas são as que interessam: é onde o compilador
        // diz o ficheiro e a linha. É isto que vai para o Developer.
        const cauda = saida.trim().split("\n").slice(-40).join("\n");
        return reject(new Error(`'${cmd}' falhou com código ${codigo}.\n${cauda}`));
      }
      resolve(saida);
    });
  });
}

/**
 * Compila o projeto segundo a stack escolhida.
 * @returns {Promise<{saltou:boolean, motivo?:string}>}
 */
async function construir(stack, dir, onData = () => {}) {
  if (!stack.build) return { saltou: true, motivo: "esta stack não precisa de build" };

  const livre = espacoLivreMB(dir);
  if (livre !== null && livre < MIN_DISCO_MB) {
    throw new Error(
      `Só há ${livre} MB livres e são precisos pelo menos ${MIN_DISCO_MB} MB. ` +
      `Liberta espaço na VPS (os node_modules de projetos antigos no vault ` +
      `são o suspeito habitual) antes de construir com esta stack.`
    );
  }
  if (livre !== null) onData(`[build] ${livre} MB livres em disco\n`);

  // Onde a plataforma vai ser servida. Sem isto, o Next escreve os
  // caminhos dos recursos a partir da raiz e o preview serve HTML sem
  // CSS nem JavaScript — a página aparece em Times New Roman.
  const extraEnv = {};
  if (stack.prefixoDePreview) {
    const id = path.basename(dir);
    extraEnv.PREVIEW_ASSET_PREFIX = `/preview/${encodeURIComponent(id)}`;
    onData(`[build] recursos servidos em ${extraEnv.PREVIEW_ASSET_PREFIX}\n`);
  }

  for (const cmd of stack.build.comandos) {
    onData(`\n[build] ${cmd}\n`);
    await correr(cmd, dir, onData, extraEnv);
  }

  // Export estático: depois de o out/ existir, os node_modules são meio
  // giga de peso morto. O preview serve ficheiros; não precisa deles.
  if (stack.limparNodeModules) {
    const nm = path.join(dir, "node_modules");
    if (fs.existsSync(nm)) {
      onData("[build] a remover node_modules (o out/ já se basta)\n");
      fs.rmSync(nm, { recursive: true, force: true });
    }
  }

  return { saltou: false };
}

/**
 * Apaga os screenshots da execução anterior do QA.
 *
 * São full-page e o QA corre a cada revisão: ao fim de umas correções
 * são dezenas de MB por projeto, que entram nos backups sem servirem
 * para nada. Só interessam os da última execução.
 */
function limparScreenshots(dir) {
  const pasta = path.join(dir, "qa-screenshots");
  try {
    if (fs.existsSync(pasta)) fs.rmSync(pasta, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[qa] não consegui limpar screenshots: ${err.message}`);
  }
}

module.exports = {
  construir, espacoLivreMB, limparScreenshots,
  BUILD_TIMEOUT_MS, MIN_DISCO_MB,
};
