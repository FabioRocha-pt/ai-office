// Que MODELO cada agente usa, em função da complexidade do trabalho.
//
// O problema que isto resolve: usar o modelo mais caro para mudar a cor de
// um botão gasta a quota que faz falta a quem constrói. Cada projeto é
// classificado uma vez, e cada agente recebe um escalão em função dessa
// classificação e do peso da sua função.
//
// Os nomes dos modelos mudam depressa e dependem do teu plano — por isso
// vivem num ficheiro editável (models.json, ao lado do vault) em vez de
// estarem enterrados no código. Se um nome deixar de existir, editas o
// ficheiro em vez de esperares por um zip novo.

const fs = require("fs");
const path = require("path");

const FILE = process.env.MODELS_FILE
  || path.join(__dirname, "..", "..", "models.json");

const TIERS = ["light", "standard", "heavy"];

// String vazia = não passar flag nenhum, deixando a CLI usar o default
// dela. É a opção segura quando não sabes que nomes o teu plano aceita.
const DEFAULT_MODELS = {
  claude: {
    light: "haiku",
    standard: "sonnet",
    heavy: "opus",
  },
  codex: {
    // Testados na VPS (25/07): a conta ChatGPT aceita as VARIANTES do
    // 5.6 mas rejeita o nome de família nu — 'gpt-5.6' dá
    // "model is not supported when using Codex with a ChatGPT account".
    // Foi isso que impediu o CEO e o QA de correrem.
    //
    // O 5.4-mini é o mais barato e chega para retoques; se preferires
    // ficar na família 5.6, troca 'light' por gpt-5.6-luna.
    light: "gpt-5.4-mini",
    standard: "gpt-5.6-terra",   // o cavalo de batalha
    heavy: "gpt-5.6-sol",        // detalhe e acabamento
  },
  antigravity: {
    // Nomes reais, tirados de 'agy models' na VPS (25/07). Repara que o
    // nível de esforço faz parte do NOME do modelo — daí não passarmos
    // --effort. E o 'agy' falha com erro se o nome não resolver, em vez
    // de cair no default, por isso confirma com 'agy models' antes de
    // mexer aqui.
    //
    // Alternativa para 'standard': gemini-3.1-pro-low. Escolhi o flash
    // alto por ser modelo mais recente; troca se preferires o Pro.
    // (O 3.1 Pro não tem nível médio: só -low e -high.)
    light: "gemini-3.6-flash-low",
    standard: "gemini-3.6-flash-high",
    heavy: "gemini-3.1-pro-high",
  },
};

// Quem usa que escalão, por complexidade do projeto. Matriz explícita em
// vez de aritmética de offsets: é o sítio onde vais querer mexer, e assim
// lê-se de uma vez o que cada agente vai custar.
//
// Duas decisões deliberadas, tiradas do que correu mal antes:
//
//   - O CTO nunca passa de 'standard'. Numa corrida real gastou 7m42 e
//     escreveu 35 KB de arquitetura para uma app de dividir contas, e
//     deixou o Developer sem créditos. Documentos de arquitetura são o
//     trabalho que menos beneficia do modelo caro e o que mais texto
//     produz. É um teto, não um castigo.
//   - O Developer nunca desce de 'standard'. É o único cujo output o
//     cliente usa; poupar aqui é poupar no produto.
const TIER_MATRIX = {
  simples: {
    ceo: "light", cto: "light", designer: "light",
    developer: "standard", qa: "light",
  },
  medio: {
    ceo: "light", cto: "standard", designer: "light",
    developer: "standard", qa: "standard",
  },
  complexo: {
    ceo: "standard", cto: "standard", designer: "standard",
    developer: "heavy", qa: "standard",
  },
};

function readModels() {
  const base = JSON.parse(JSON.stringify(DEFAULT_MODELS));
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
    for (const [cli, tiers] of Object.entries(saved)) {
      if (!base[cli]) continue;
      for (const [tier, name] of Object.entries(tiers)) {
        if (TIERS.includes(tier) && typeof name === "string") base[cli][tier] = name;
      }
    }
  } catch {
    // sem ficheiro ainda — ficamos pelos defaults
  }
  return base;
}

function writeModels(map) {
  const next = readModels();
  for (const [cli, tiers] of Object.entries(map || {})) {
    if (!next[cli]) throw new Error(`CLI '${cli}' desconhecida`);
    for (const [tier, name] of Object.entries(tiers)) {
      if (!TIERS.includes(tier)) throw new Error(`Escalão '${tier}' inválido`);
      next[cli][tier] = String(name || "");
    }
  }
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}

/** Escalão final de um agente, dado o nível de complexidade do projeto. */
function tierFor(agentId, complexity) {
  const row = TIER_MATRIX[complexity] || TIER_MATRIX.medio;
  return row[agentId] || "standard";
}

/** Nome do modelo a passar à CLI. Vazio = usar o default da própria CLI. */
function modelFor(cli, tier, models = readModels()) {
  return models[cli]?.[tier] || "";
}

/**
 * Classificação sem gastar chamada nenhuma.
 *
 * Deliberadamente grosseira: só precisa de distinguir "mudar a cor de um
 * botão" de "construir uma plataforma". Errar para cima custa quota;
 * errar para baixo custa uma repetição. Por isso, na dúvida, fica em
 * 'medio' e deixa o offset por função fazer o resto.
 */
function classify(brief) {
  const text = String(brief || "").toLowerCase();
  const words = text.split(/\s+/).filter(Boolean).length;

  const trivial = /\b(cor|cores|texto|label|etiqueta|espa[çc]amento|margem|padding|fonte|tipo de letra|[íi]cone|renomear|mudar o nome|corrigir typo|gralha|ajustar|trocar)\b/;
  const heavy = /\b(plataforma|autentica[çc][ãa]o|login|base de dados|multiutilizador|tempo real|pagamentos?|api|dashboard|integra[çc][ãa]o|permiss[õo]es|escal|migra[çc][ãa]o)\b/;

  // Um pedido curto que fala em aparência é quase sempre um retoque.
  if (words <= 25 && trivial.test(text) && !heavy.test(text)) return "simples";
  if (words >= 60 || heavy.test(text)) return "complexo";
  return "medio";
}

module.exports = {
  TIERS, DEFAULT_MODELS, TIER_MATRIX, FILE,
  readModels, writeModels, tierFor, modelFor, classify,
};
