// Executa uma CLI (claude / gemini / codex) em modo não-interativo,
// numa pasta de trabalho isolada por agente, e devolve o output.
//
// IMPORTANTE: confirma os flags de cada CLI com `<cli> --help` antes de
// confiar cegamente nisto — o do Claude Code (`-p`) tenho a certeza,
// os outros dois (gemini/codex) confirma na tua VPS porque não são
// produtos Anthropic e podem ter mudado.

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Cada CLI corre em modo não-interativo COM PERMISSÃO DE ESCRITA na pasta
// do projeto — sem isso os agentes não conseguem produzir ficheiros e o
// escritório não constrói nada.
//
// ⚠️ Confirma estes flags na tua VPS com `<cli> --help`. Os do Codex e do
// agy estão confirmados; o do Claude Code (--permission-mode) convém
// verificares, porque os valores aceites podem variar com a versão.
// Modo de permissões do Claude Code.
//   acceptEdits (default) -> escreve ficheiros e corre apenas os comandos
//                            da lista em .claude/settings.json
//   bypassPermissions     -> corre QUALQUER comando sem perguntar. Dá
//                            execução arbitrária numa máquina com internet
//                            e com as tuas credenciais lá dentro.
// Mudar com:
//   AGENT_PERMISSIONS=bypassPermissions pm2 restart ai-office --update-env
const CLAUDE_PERMISSION_MODE = process.env.AGENT_PERMISSIONS || "acceptEdits";

// Nota: o 'agy' tem um flag --effort, mas os nomes dos modelos já trazem o
// nível lá dentro (gemini-3.6-flash-low, ...-high). Passar os dois seria
// dizer a mesma coisa duas vezes, com risco de se contradizerem. O escalão
// entra pelo nome do modelo; ver agents/models.js.

// Ativa com: AGY_SKIP_PERMISSIONS=1 pm2 restart ai-office --update-env
const AGY_SKIP_PERMISSIONS = process.env.AGY_SKIP_PERMISSIONS === "1";

// Cada construtor recebe (prompt, model, tier). Um model vazio significa "não
// passes flag nenhum" — a CLI usa o default dela. Isso importa sobretudo
// no 'agy', que falha com erro se o nome do modelo não resolver, em vez
// de cair no default como as outras.
const CLI_COMMANDS = {
  claude: (prompt, model) => [
    "claude",
    [
      ...(model ? ["--model", model] : []),
      "--permission-mode", CLAUDE_PERMISSION_MODE,
      "-p", prompt,
    ],
  ],

  // workspace-write: escrita limitada à pasta de trabalho.
  codex: (prompt, model) => [
    "codex",
    [
      "exec", "--skip-git-repo-check", "-s", "workspace-write",
      ...(model ? ["-m", model] : []),
      prompt,
    ],
  ],

  // Google Antigravity CLI — binário 'agy'.
  //
  // Flags confirmados com 'agy --help' na VPS (25/07). Não confies em
  // artigos: '--headless' e '--approve' NÃO existem nesta versão, e
  // passá-los faz a CLI sair com código 2 sem correr nada.
  //
  //   -p / --print               corre um prompt não-interativamente
  //   --mode accept-edits        aceita edições de ficheiros sem perguntar
  //   --dangerously-skip-permissions  auto-aprova TODOS os pedidos de
  //                              permissão de ferramentas. Em headless não
  //                              há quem aprove, por isso sem isto o agente
  //                              fica bloqueado à primeira ferramenta que
  //                              precise de autorização. Opt-in, porque o
  //                              nome não está lá por acaso.
  antigravity: (prompt, model, tier) => [
    "agy",
    [
      "--mode", "accept-edits",
      ...(AGY_SKIP_PERMISSIONS ? ["--dangerously-skip-permissions"] : []),
      ...(model ? ["--model", model] : []),
      "-p", prompt,
    ],
  ],
};


// Um agente pendurado (à espera de autorização que nunca chega, por
// exemplo) bloquearia o pipeline para sempre. Ao fim deste tempo,
// matamos o processo e seguimos em frente.
// Erros que a CLI imprime em vez de trabalhar. São longos o suficiente
// para passarem por output legítimo — o texto do "modelo não suportado"
// tem centenas de caracteres — por isso a verificação de comprimento não
// chega e é preciso reconhecê-los pelo conteúdo.
const FATAL_PATTERNS = [
  { re: /model is not supported|model metadata for .* not found|unknown model|model not found/i,
    hint: "Nome de modelo inválido para esta conta. Corrige em models.json." },
  { re: /usage limit|rate limit|quota exceeded|insufficient credit|out of credit|billing/i,
    hint: "Créditos ou limite de utilização esgotados. Muda este agente de CLI no painel." },
  { re: /not authenticated|please log ?in|authentication failed|invalid api key/i,
    hint: "Sessão expirada. Volta a autenticar esta CLI na VPS." },
];

/** Devolve a dica se o output for uma mensagem de erro disfarçada. */
function fatalIn(text) {
  for (const { re, hint } of FATAL_PATTERNS) if (re.test(text)) return hint;
  return null;
}

const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS) || 10 * 60 * 1000;

// Abaixo disto, o agente não trabalhou — devolveu uma linha de erro ou
// nada. Serve de rede para CLIs que saem com código 0 mesmo tendo falhado.
const MIN_PLAUSIBLE_OUTPUT = Number(process.env.AGENT_MIN_OUTPUT) || 40;

// Comandos que os agentes podem correr sem pedir autorização. Em modo
// headless não há ninguém para responder a um pedido de permissão, por
// isso sem esta lista o Claude Code recusa executar seja o que for.
//
// A lista é deliberadamente restrita: ler, procurar, correr código e usar
// git. Não inclui coisas como curl, ssh, sudo ou rm -rf. Se um agente se
// queixar de um comando em falta, acrescenta-o aqui em vez de desligares
// as permissões todas.
const ALLOWED_COMMANDS = [
  "ls", "cat", "head", "tail", "wc", "file", "tree", "pwd",
  "grep", "rg", "find", "which",
  "mkdir", "touch", "cp", "mv",
  "echo", "printf", "sed", "awk", "sort", "uniq", "diff",
  "git",
  "node", "npm", "npx",
  "python3", "pip3",
  // Nota: 'curl' e 'wget' ficam de fora de propósito — permitiriam enviar
  // ficheiros para fora ou descarregar e correr scripts arbitrários, o que
  // esvaziaria o sentido de ter uma lista. Acrescenta-os só se precisares.
];

// Sintaxe das regras: Tool ou Tool(especificador). 'command(git)' — que
// esta versão usava antes — não é sintaxe válida e as regras eram
// silenciosamente ignoradas: o Claude Code ficava a pedir confirmação para
// TODOS os comandos de shell, e headless não há ninguém para confirmar.
// Resultado: os agentes só conseguiam escrever ficheiros, nunca correr nada.
//
// 'Bash(git:*)' apanha qualquer subcomando git; o wildcard final também
// torna o comando nu ('git') válido.
function permissionRules() {
  return [
    // Ferramentas de ficheiros — sem isto o agente não constrói nada
    "Read", "Write", "Edit", "Glob", "Grep",
    // Comandos de shell, um wildcard por comando permitido
    ...ALLOWED_COMMANDS.map((c) => `Bash(${c}:*)`),
  ];
}

// Explicitamente negados, mesmo que alguém alargue a lista acima por
// distração. deny tem prioridade sobre allow.
const DENIED_RULES = [
  "Bash(curl:*)", "Bash(wget:*)", "Bash(ssh:*)", "Bash(scp:*)",
  "Bash(sudo:*)", "Bash(rm -rf:*)",
  "Read(./.env)", "Read(./.env.*)",
];

function writeClaudeSettings(dir) {
  const settingsDir = path.join(dir, ".claude");
  const settingsFile = path.join(settingsDir, "settings.json");
  if (fs.existsSync(settingsFile)) return; // não sobrescreve ajustes teus

  try {
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      settingsFile,
      JSON.stringify(
        {
          permissions: {
            allow: permissionRules(),
            deny: DENIED_RULES,
            defaultMode: CLAUDE_PERMISSION_MODE,
          },
        },
        null,
        2
      )
    );
  } catch (err) {
    console.warn(`[settings] não consegui escrever ${settingsFile}: ${err.message}`);
  }
}

function ensureWorkspace(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  writeClaudeSettings(dir);

  // O Codex CLI só corre dentro de um repo git ("trusted directory"),
  // e o histórico dá-nos rede de segurança: se um agente estragar algo,
  // consegues ver o que mudou com `git diff` / `git log`.
  if (!fs.existsSync(path.join(dir, ".git"))) {
    try {
      execSync("git init -q", { cwd: dir, stdio: "ignore" });
      execSync('git config user.email "office@ai.local"', { cwd: dir, stdio: "ignore" });
      execSync('git config user.name "AI Office"', { cwd: dir, stdio: "ignore" });
    } catch (err) {
      console.warn(`[workspace] git init falhou em ${dir}: ${err.message}`);
    }
  }
}

/**
 * Grava um commit com o que o agente produziu, para haver histórico de
 * quem mudou o quê. Falhar aqui nunca deve deitar abaixo uma tarefa.
 */
function commitWork(dir, roleLabel) {
  try {
    execSync("git add -A", { cwd: dir, stdio: "ignore" });
    // --allow-empty evita erro quando o agente não mexeu em nada
    execSync(
      `git commit --allow-empty -q -m ${JSON.stringify(roleLabel + ": alterações")}`,
      { cwd: dir, stdio: "ignore" }
    );
  } catch (err) {
    console.warn(`[git] commit falhou: ${err.message}`);
  }
}

/**
 * Limpa o ruído que cada CLI imprime à volta da resposta real
 * (cabeçalhos, avisos, contagem de tokens), para a interface mostrar
 * só o conteúdo útil.
 */
function cleanOutput(cli, raw) {
  let text = raw;

  if (cli === "codex") {
    // O Codex imprime um bloco de metadata entre '---' e depois a resposta
    // a seguir a uma linha 'codex'. Corta o rodapé de tokens.
    const marker = text.lastIndexOf("\ncodex\n");
    if (marker !== -1) {
      text = text.slice(marker + "\ncodex\n".length);
    }
    text = text.replace(/\ntokens used[\s\S]*$/i, "");
  }

  // Remove avisos comuns que não interessam ao utilizador
  text = text
    .split("\n")
    .filter((line) => !/^warning: Codex could not find bubblewrap/i.test(line))
    .filter((line) => !/^Warning: no stdin data received/i.test(line))
    .join("\n");

  return text.trim();
}

/**
 * Corre um agente com uma tarefa.
 * @param {object} role - entrada de roles.js (ceo/developer/etc)
 * @param {string} task - a instrução do dono da empresa
 * @param {string} workspace - pasta do projeto onde o agente trabalha
 * @param {(chunk:string)=>void} onData - callback para output em streaming
 * @param {{model?:string}} opts - modelo a usar, escolhido por complexidade
 * @returns {Promise<string>} output completo
 */
function runAgent(role, task, workspace, onData = () => {}, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!workspace) return reject(new Error("runAgent: falta indicar o workspace"));
    ensureWorkspace(workspace);

    // Modelo escolhido pelo pipeline em função da complexidade. Vazio =
    // deixa a CLI decidir.
    const model = opts.model || "";

    const fullPrompt = `${role.persona}\n\n--- TAREFA ---\n${task}`;

    const builder = CLI_COMMANDS[role.cli];
    if (!builder) {
      return reject(new Error(`CLI desconhecida para o agente ${role.id}: ${role.cli}`));
    }
    const [cmd, args] = builder(fullPrompt, model, opts.tier || "standard");

    // O 'agy' (Antigravity) instala em ~/.local/bin, que muitas vezes não
    // está no PATH quando o processo corre via pm2/systemd. Garantimos aqui.
    const homeDir = process.env.HOME || "/root";
    const env = {
      ...process.env,
      PATH: `${homeDir}/.local/bin:${process.env.PATH || ""}`,
    };

    const child = spawn(cmd, args, {
      cwd: workspace,
      env,
      shell: false,
      // stdin fechado: as CLIs esperam 3s por input que nunca vem e
      // imprimem um aviso. Equivalente a redirecionar < /dev/null.
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";

    // O Codex ecoa o cabeçalho e o prompt inteiro (incluindo a persona)
    // antes de responder. Seguramos o stream até passar esse eco, senão
    // o painel enche-se com as nossas próprias instruções.
    const ECHO_MARKER = "\ncodex\n";
    let echoPassed = role.cli !== "codex";
    let echoBuffer = "";

    const emit = (text) => {
      if (echoPassed) return onData(text);

      echoBuffer += text;
      const at = echoBuffer.indexOf(ECHO_MARKER);
      if (at !== -1) {
        echoPassed = true;
        const rest = echoBuffer.slice(at + ECHO_MARKER.length);
        echoBuffer = "";
        if (rest) onData(rest);
      }
    };

    child.stdout.on("data", (data) => {
      const text = data.toString();
      output += text;
      emit(text);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      output += text;
      emit(text);
    });

    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[${role.id}] timeout ao fim de ${TIMEOUT_MS / 1000}s — a matar processo`);
      try { child.kill("SIGKILL"); } catch {}
      commitWork(workspace, role.label);
      reject(new Error(
        `${role.label} não respondeu em ${Math.round(TIMEOUT_MS / 60000)} minutos e foi interrompido. ` +
        `Costuma ser a CLI presa à espera de autorização — verifica os flags de permissões.`
      ));
    }, TIMEOUT_MS);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Falha a arrancar "${cmd}": ${err.message}. Está instalada e no PATH?`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      commitWork(workspace, role.label);

      const clean = cleanOutput(role.cli, output);
      const thin = clean.length < MIN_PLAUSIBLE_OUTPUT;

      // Antes de tudo: a CLI pode ter imprimido uma mensagem de erro
      // comprida e saído com 0. Comprimento não distingue isso de
      // trabalho real — só o conteúdo distingue.
      const fatal = fatalIn(output);
      if (fatal) {
        const linha = output.split("\n").find((l) => fatalIn(l)) || "";
        return reject(new Error(
          `${role.label} (${cmd}): ${fatal}\n${linha.trim().slice(0, 300)}`
        ));
      }

      // O código de saída sozinho não serve de veredicto. Observado na
      // VPS: o Claude Code sai com 1 depois de 7 minutos de trabalho bem
      // feito, porque a sessão acaba numa ação bloqueada. Tratar isso
      // como falha deitaria fora trabalho real.
      //
      // O que decide é a combinação: saída suja E output residual = a CLI
      // rebentou à entrada. Saída suja com trabalho lá dentro = correu,
      // só acabou mal, e fica registado como aviso.
      if (code !== 0 && thin) {
        const tail = clean.split("\n").slice(-15).join("\n").trim();
        return reject(new Error(
          `${role.label}: a CLI '${cmd}' saiu com código ${code} ao fim de ` +
          `poucos segundos, sem produzir nada.` +
          (tail ? `\n${tail}` : " Não imprimiu nada que explicasse porquê.")
        ));
      }

      // Saiu limpo mas de mãos a abanar. É o caso do 'agy', que sai com 0
      // e larga o stdout quando corre sob pipe.
      if (thin) {
        return reject(new Error(
          `${role.label}: a CLI terminou sem erro mas devolveu ` +
          `${clean.length} caracteres — não chegou a trabalhar. ` +
          `Verifica os flags e, no caso do 'agy', o bug do stdout sob pipe.`
        ));
      }

      if (code !== 0) {
        console.warn(
          `[${role.id}] saiu com código ${code} mas produziu ${clean.length} ` +
          `caracteres — aceite. Costuma ser uma ação bloqueada por permissões no fim.`
        );
      }

      resolve(clean);
    });
  });
}

// Quais as CLIs que o runner sabe invocar. O painel usa isto para
// preencher os seletores, para nunca te oferecer uma opção que rebentaria.
const SUPPORTED_CLIS = Object.keys(CLI_COMMANDS);

module.exports = { runAgent, SUPPORTED_CLIS };
