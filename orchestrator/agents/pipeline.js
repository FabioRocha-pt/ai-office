// Corre a equipa em cadeia dentro de um projeto do vault — de raiz ou
// para alterar algo que já existe.
//
// Ordem: CEO (plano) -> CTO (stack) -> Designer (visual) -> Developer
// (implementa) -> QA (testa). Sequencial de propósito: partilham a mesma
// pasta e correr dois ao mesmo tempo far-los-ia pisar o trabalho um do outro.

const { ROLES } = require("./roles");
const { runAgent } = require("./runner");
const assignments = require("./assignments");
const models = require("./models");
const { createProject, projectPath, readMeta, writeMeta, detectEntry } = require("./vault");
const stacks = require("./stacks");
const { construir } = require("./build");

const ORDER = ["ceo", "cto", "designer", "developer", "qa"];

// Quanto do output do agente anterior passamos ao seguinte. Os ficheiros
// na pasta do projeto são a fonte de verdade — isto é só contexto.
const HANDOFF_CHARS = 2500;

// Espera antes de repetir uma etapa que rebentou depressa demais.
const RETRY_DELAY_MS = Number(process.env.AGENT_RETRY_DELAY_MS) || 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Os agentes tendem a despejar diffs de git inteiros na resposta. Como
 * partilham a pasta, o colega seguinte pode simplesmente ler os ficheiros:
 * o diff é ruído que enche o prompt e distrai.
 */
function stripDiffs(text) {
  const at = text.search(/^diff --git /m);
  return (at === -1 ? text : text.slice(0, at)).trim();
}

let running = false;
let currentProject = null;

function isRunning() { return running; }
function current() { return currentProject; }

/** Destranca o pipeline à força, para quando algo ficou preso. */
function forceReset() {
  running = false;
  currentProject = null;
}

/**
 * Motor único, usado tanto para projetos novos como para alterações.
 *
 * @param {object}   meta        projeto do vault
 * @param {string}   brief       o que se pede desta vez
 * @param {string[]} agentIds    quais os agentes (já pela ordem certa)
 * @param {object}   hooks
 * @param {object}   options     { complexity, isRevision }
 */
async function runAgents(meta, brief, agentIds, hooks = {}, options = {}) {
  if (running) throw new Error("Já está a correr um pipeline. Espera que termine.");
  running = true;

  const isRevision = !!options.isRevision;

  // Lidos uma vez por corrida: se mudares a atribuição a meio, a corrida
  // em curso mantém-se coerente do princípio ao fim.
  const cliMap = assignments.read();
  const modelMap = models.readModels();

  // 'auto' classifica pelo briefing; podes forçar pelo painel.
  const complexity = options.complexity && options.complexity !== "auto"
    ? options.complexity
    : models.classify(brief);

  meta.complexity = complexity;

  // A stack é escolhida uma vez, no início. Numa revisão mantém-se a que
  // o projeto já tem: trocar de framework a meio deitaria fora o trabalho
  // todo que lá está.
  const stackId = isRevision
    ? (meta.stack || stacks.DEFEITO)
    : (options.stack && stacks.STACKS[options.stack] ? options.stack : stacks.DEFEITO);
  const stack = stacks.obter(stackId);
  meta.stack = stack.id;

  writeMeta(meta.id, meta);

  const dir = projectPath(meta.id);
  currentProject = meta.id;
  hooks.onProject?.(meta);

  let previous = null;
  let anyFailed = false;

  // O scaffold entra ANTES do primeiro agente: assim toda a gente,
  // incluindo o CEO, já encontra a estrutura montada em vez de a
  // imaginar. Nunca sobrescreve ficheiros existentes.
  if (!isRevision) {
    const escritos = stacks.aplicar(stack.id, dir);
    if (escritos.length) {
      hooks.onAgentChunk?.("cto", `[stack] ${stack.label}: ${escritos.length} ficheiros de base\n`);
    }
  }

  try {
    for (let i = 0; i < agentIds.length; i++) {
      const id = agentIds[i];
      // A CLI vem da atribuição atual, não do roles.js — é o que te
      // permite mudar um agente de CLI quando os créditos de uma acabam.
      const role = assignments.effectiveRole(id, cliMap);
      if (!role) continue;

      const tier = models.tierFor(id, complexity);
      const model = models.modelFor(role.cli, tier, modelMap);

      const prevText = previous ? stripDiffs(previous.output) : "";
      const handoff = previous
        ? `\n\n--- O QUE O ${previous.label.toUpperCase()} ENTREGOU ANTES DE TI ---\n` +
          prevText.slice(0, HANDOFF_CHARS) +
          (prevText.length > HANDOFF_CHARS ? "\n[...cortado]" : "") +
          `\n(Os ficheiros do projeto têm o detalhe todo — lê-os.)`
        : "";

      const contextoStack =
        `\n\n--- STACK DESTE PROJETO: ${stack.label} ---\n` +
        `${stack.resumo}\n` +
        `Entrega: ${stack.entrada}.\n` +
        (stack.id === "estatico"
          ? `Não há passo de build: escreve HTML, CSS e JS que o browser corre tal como estão.`
          : `O scaffold já está na pasta — package.json, configuração e estrutura. ` +
            `NÃO o refaças nem mudes de framework: preenche-o. As dependências ` +
            `são instaladas e o projeto é compilado automaticamente depois da ` +
            `etapa do Developer, por isso não corras npm install tu.`);

      const header = isRevision
        ? `Etapa ${i + 1} de ${agentIds.length} de uma ALTERAÇÃO a um projeto que já existe.\n\n` +
          `--- O PROJETO ---\n${meta.brief || meta.name}\n\n` +
          `--- O QUE O CLIENTE PEDE AGORA ---\n${brief}\n\n` +
          `IMPORTANTE: o projeto já está construído. Lê primeiro o que lá está ` +
          `e altera só o necessário para satisfazer este pedido. Não recomeces do ` +
          `zero nem deites fora trabalho que continua válido.`
        : `Etapa ${i + 1} de ${agentIds.length}. Estás a trabalhar no seguinte projeto.\n\n` +
          `--- BRIEFING DO CLIENTE ---\n${brief}`;

      const task = header + contextoStack + handoff +
        `\n\n--- O QUE TE COMPETE AGORA ---\n` +
        `Faz a tua parte, dentro da tua função. Grava o teu trabalho em ficheiros ` +
        `na pasta do projeto para os colegas seguintes poderem continuar a partir daí.`;

      const stage = {
        agent: id, label: role.label, cli: role.cli, tier, model,
        startedAt: Date.now(), finishedAt: null, ok: false,
        revision: isRevision,
      };
      hooks.onAgentStart?.(id, meta.id, { cli: role.cli, tier, model });

      try {
        const output = await runAgent(
          role, task, dir,
          (chunk) => hooks.onAgentChunk?.(id, chunk),
          { model, tier }
        );
        stage.ok = true;
        stage.finishedAt = Date.now();
        previous = { label: role.label, output };
        hooks.onAgentDone?.(id, output);
      } catch (err) {
        anyFailed = true;
        stage.ok = false;
        stage.error = err.message;
        stage.finishedAt = Date.now();
        hooks.onAgentError?.(id, err.message);
        // Um agente falhar não para a cadeia: o seguinte pode ainda
        // trabalhar a partir dos ficheiros que já existem.
        previous = null;
      }

      const m = readMeta(meta.id) || meta;
      m.stages = [...(m.stages || []), stage];
      writeMeta(meta.id, m);

      // --- PORTÃO DE ENTREGA ---
      // O Developer é quem tem de deixar algo que abra. Se a pasta
      // continua sem ponto de entrada — quer ele tenha falhado, quer
      // tenha dito que sim e não feito nada — mandamo-lo de volta uma
      // vez, com instrução específica em vez do briefing genérico.
      if (id === "developer" && detectEntry(dir).type === "none") {
        hooks.onAgentChunk?.(id, "\n[portão] Nada para abrir na pasta. A repetir a implementação.\n");

        // Se a etapa anterior rebentou em segundos, costuma ser limite de
        // utilização da CLI. Uma pausa curta antes de insistir evita
        // gastar a segunda tentativa contra a mesma parede.
        if (!stage.ok) await sleep(RETRY_DELAY_MS);

        const retryTask =
          `A tua etapa terminou mas a pasta do projeto não tem entrega: ` +
          `esperava-se ${stack.entrada}.\n\n` +
          `Do ponto de vista do cliente, não foi entregue nada.\n\n` +
          `--- O QUE SE PEDE ---\n${brief}\n\n` +
          `--- O QUE TENS DE FAZER AGORA ---\n` +
          (stack.id === "estatico"
            ? `Cria o index.html na raiz, com a aplicação a funcionar. HTML, CSS e ` +
              `JS simples, sem build e sem dependências.`
            : `Preenche o scaffold que já está na pasta (${stack.label}). Não mudes ` +
              `de framework nem refaças a estrutura: escreve os componentes e as ` +
              `páginas que faltam. Não corras npm install — a compilação é feita ` +
              `automaticamente a seguir.`) +
          ` Usa o que os teus colegas deixaram nos ficheiros. Escreve mesmo em ` +
          `disco e confirma no fim que ficou lá.`;

        // Se falhou à primeira, a segunda tentativa não deve ser mais
        // fraca do que a primeira — sobe um escalão.
        const retryTier = models.TIERS[
          Math.min(models.TIERS.length - 1, models.TIERS.indexOf(tier) + 1)
        ];
        const retryModel = models.modelFor(role.cli, retryTier, modelMap);

        const retry = {
          agent: id, label: role.label + " (2ª tentativa)",
          cli: role.cli, tier: retryTier, model: retryModel,
          startedAt: Date.now(), finishedAt: null, ok: false,
          revision: isRevision,
        };
        try {
          const output = await runAgent(
            role, retryTask, dir,
            (chunk) => hooks.onAgentChunk?.(id, chunk),
            { model: retryModel, tier: retryTier }
          );
          retry.ok = true;
          previous = { label: role.label, output };
          hooks.onAgentDone?.(id, output);
        } catch (err) {
          retry.error = err.message;
          hooks.onAgentError?.(id, err.message);
        }
        retry.finishedAt = Date.now();

        const m2 = readMeta(meta.id) || meta;
        m2.stages = [...(m2.stages || []), retry];
        writeMeta(meta.id, m2);
      }

      /* ── ETAPA DE BUILD ─────────────────────────────────────
         Entre o Developer e o QA. Não é agente e não gasta quota:
         instala dependências e compila. Se falhar, o Developer leva
         o erro do compilador e uma segunda tentativa — o mesmo
         padrão do portão de entrega, que já existia. */
      if (id === "developer" && stack.build) {
        const bStage = {
          agent: "build", label: "Build", cli: "npm", tier: "-", model: "-",
          startedAt: Date.now(), finishedAt: null, ok: false,
        };
        hooks.onAgentStart?.("build", meta.id, { cli: "npm", tier: "-", model: "-" });

        let erroBuild = null;
        try {
          await construir(stack, dir, (c) => hooks.onAgentChunk?.("build", c));
          bStage.ok = true;
          hooks.onAgentDone?.("build", "Compilado.");
        } catch (err) {
          erroBuild = err.message;
          bStage.error = err.message;
          hooks.onAgentError?.("build", err.message);
        }
        bStage.finishedAt = Date.now();

        const mb = readMeta(meta.id) || meta;
        mb.stages = [...(mb.stages || []), bStage];
        writeMeta(meta.id, mb);

        // Uma tentativa de reparação, com o erro real do compilador.
        // Sem isto o QA recebia um projeto que nem chega a arrancar.
        if (erroBuild) {
          const devRole = assignments.effectiveRole("developer", cliMap);
          const repTier = models.TIERS[
            Math.min(models.TIERS.length - 1, models.TIERS.indexOf(models.tierFor("developer", complexity)) + 1)
          ];
          const repStage = {
            agent: "developer", label: "Developer (a corrigir o build)",
            cli: devRole.cli, tier: repTier,
            model: models.modelFor(devRole.cli, repTier, modelMap),
            startedAt: Date.now(), finishedAt: null, ok: false,
          };
          hooks.onAgentStart?.("developer", meta.id, { cli: devRole.cli, tier: repTier, model: repStage.model });

          try {
            const saida = await runAgent(devRole,
              `O build do projeto FALHOU. Corrige o código para compilar.\n\n` +
              `--- ERRO DO COMPILADOR ---\n${erroBuild.slice(0, 3000)}\n\n` +
              `--- REGRAS ---\n` +
              `Stack: ${stack.label}. Corrige apenas o que impede a compilação. ` +
              `Não mudes de framework, não refaças a estrutura e não corras ` +
              `npm install — a compilação volta a correr sozinha a seguir.`,
              dir, (c) => hooks.onAgentChunk?.("developer", c), { model: repStage.model, tier: repTier });
            repStage.ok = true;
            previous = { label: devRole.label, output: saida };
            hooks.onAgentDone?.("developer", saida);
          } catch (e) {
            repStage.error = e.message;
            hooks.onAgentError?.("developer", e.message);
          }
          repStage.finishedAt = Date.now();

          const mr = readMeta(meta.id) || meta;
          mr.stages = [...(mr.stages || []), repStage];
          writeMeta(meta.id, mr);

          // segunda e última compilação
          const b2 = {
            agent: "build", label: "Build (2ª tentativa)", cli: "npm", tier: "-", model: "-",
            startedAt: Date.now(), finishedAt: null, ok: false,
          };
          hooks.onAgentStart?.("build", meta.id, { cli: "npm", tier: "-", model: "-" });
          try {
            await construir(stack, dir, (c) => hooks.onAgentChunk?.("build", c));
            b2.ok = true;
            hooks.onAgentDone?.("build", "Compilado à segunda.");
          } catch (e) {
            b2.error = e.message;
            anyFailed = true;
            hooks.onAgentError?.("build", e.message);
          }
          b2.finishedAt = Date.now();

          const m3 = readMeta(meta.id) || meta;
          m3.stages = [...(m3.stages || []), b2];
          writeMeta(meta.id, m3);
        }
      }
    }
  } finally {
    const m = readMeta(meta.id) || meta;
    // "Concluído" passa a significar entregue e abrível, não apenas
    // "ninguém rebentou". É este o critério que o vault mostra.
    const entry = detectEntry(dir);
    m.deliverable = entry.type;
    if (anyFailed) m.status = "failed";
    // 'porconstruir' significa que há package.json com script de build mas
    // nada compilado. Não é entrega: o cliente não tem o que abrir. Estava
    // a cair no 'else' e a ser marcado como concluído.
    else if (entry.type === "none" || entry.type === "porconstruir") m.status = "incomplete";
    else m.status = "done";
    m.finishedAt = new Date().toISOString();
    if (isRevision) m.revisions = (m.revisions || 0) + 1;
    writeMeta(meta.id, m);

    running = false;
    currentProject = null;
  }

  return readMeta(meta.id);
}

/** Projeto novo do zero, com a equipa toda. */
async function runPipeline(brief, hooks = {}, options = {}) {
  const meta = createProject(brief);
  return runAgents(meta, brief, ORDER, hooks, { ...options, isRevision: false });
}

/**
 * Alterações a um projeto que já está no vault.
 * Por omissão vai o Developer (implementa) e o QA (verifica) — é o que
 * uma correção normalmente precisa, sem gastar quota a repensar a
 * arquitetura toda.
 */
async function reviseProject(projectId, brief, agentIds, hooks = {}, options = {}) {
  const meta = readMeta(projectId);
  if (!meta) throw new Error(`O projeto '${projectId}' não existe no vault.`);

  const wanted = (agentIds && agentIds.length ? agentIds : ["developer", "qa"])
    .filter((id) => ROLES[id]);
  if (!wanted.length) throw new Error("Nenhum agente válido indicado.");

  // mantém sempre a ordem natural do escritório
  const ordered = ORDER.filter((id) => wanted.includes(id));
  return runAgents(meta, brief, ordered, hooks, { ...options, isRevision: true });
}

module.exports = {
  runPipeline, reviseProject, runAgents,
  isRunning, forceReset, current, ORDER,
};
