const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");

const { ROLES } = require("./agents/roles");
const { runAgent } = require("./agents/runner");
const { runPipeline, reviseProject, isRunning, forceReset, current } = require("./agents/pipeline");
const vault = require("./agents/vault");
const assignments = require("./agents/assignments");
const models = require("./agents/models");
const preview = require("./agents/preview");

const app = express();
app.use(cors());
app.use(express.json());

// Guarda o host para construir URLs de projetos Node
app.use((req, _res, next) => { preview.setHost(req.headers.host); next(); });

app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Traz o projeto antigo (ai-office/project) para dentro do vault
vault.migrateLegacy();

// Nada pode estar a correr no arranque: arruma o que ficou preso a meio.
vault.reconcileOnBoot();

/* ---------------- estado ---------------- */

const state = {};
for (const id of Object.keys(ROLES)) {
  state[id] = { status: "idle", lastOutput: "" };
}

function broadcast(event) {
  const payload = JSON.stringify(event);
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(payload); });
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({
    type: "state",
    state,
    pipeline: { running: isRunning(), project: current() },
  }));
});

/* ---------------- agentes ---------------- */

app.get("/agents", (req, res) => {
  const map = assignments.read();
  res.json(Object.values(ROLES).map((r) => ({
    id: r.id,
    label: r.label,
    cli: map[r.id] || r.cli,       // CLI em vigor
    defaultCli: r.cli,             // a de fábrica, para o painel assinalar
    options: assignments.SUPPORTED_CLIS,
    status: state[r.id].status,
  })));
});

/* ---------------- atribuição de CLI e modelos ---------------- */

app.get("/assignments", (req, res) => {
  res.json({
    assignments: assignments.read(),
    defaults: assignments.defaults(),
    options: assignments.SUPPORTED_CLIS,
  });
});

app.post("/assignments", (req, res) => {
  if (isRunning()) {
    return res.status(409).json({
      error: "Está a correr um projeto. Muda as atribuições quando terminar.",
    });
  }
  try {
    res.json({ assignments: assignments.write(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/assignments/reset", (req, res) => {
  res.json({ assignments: assignments.reset() });
});

app.get("/models", (req, res) => {
  res.json({
    models: models.readModels(),
    defaults: models.DEFAULT_MODELS,
    tiers: models.TIERS,
    matrix: models.TIER_MATRIX,
  });
});

app.post("/models", (req, res) => {
  try {
    res.json({ models: models.writeModels(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Mostra o plano de execução ANTES de construir: que CLI e que modelo
// cada agente vai usar para este briefing. Sem gastar nada.
app.post("/plan", (req, res) => {
  const brief = String(req.body?.brief || "");
  const forced = req.body?.complexity;
  const complexity = forced && forced !== "auto" ? forced : models.classify(brief);

  const cliMap = assignments.read();
  const modelMap = models.readModels();

  res.json({
    complexity,
    detected: models.classify(brief),
    plan: Object.values(ROLES).map((r) => {
      const cli = cliMap[r.id] || r.cli;
      const tier = models.tierFor(r.id, complexity);
      return {
        id: r.id, label: r.label, cli, tier,
        model: models.modelFor(cli, tier, modelMap) || "(default da CLI)",
      };
    }),
  });
});

// Tarefa avulsa a um agente, dentro de um projeto existente do vault
app.post("/task/:agentId", async (req, res) => {
  const { agentId } = req.params;
  const { task, projectId } = req.body;

  const role = assignments.effectiveRole(agentId);
  if (!role) return res.status(404).json({ error: `Agente '${agentId}' não existe` });
  if (!task || typeof task !== "string") {
    return res.status(400).json({ error: "Campo 'task' (string) é obrigatório" });
  }

  // Sem projeto indicado, usa o mais recente; se o vault estiver vazio, cria um.
  let target = projectId;
  if (!target) {
    const all = vault.listProjects();
    target = all[0]?.id || vault.createProject(task, "trabalho-avulso").id;
  }

  state[agentId].status = "working";
  broadcast({ type: "status", agentId, status: "working" });
  res.json({ accepted: true, agentId, projectId: target });

  try {
    const output = await runAgent(
      role, task, vault.projectPath(target),
      (chunk) => broadcast({ type: "stream", agentId, chunk })
    );
    state[agentId].status = "done";
    state[agentId].lastOutput = output;
    broadcast({ type: "status", agentId, status: "done", output });
  } catch (err) {
    state[agentId].status = "error";
    broadcast({ type: "status", agentId, status: "error", error: err.message });
  }
});

/* ---------------- pipeline ---------------- */


/** Hooks de broadcast partilhados por /pipeline e /projects/:id/revise. */
function pipelineHooks() {
  return {
    onProject: (meta) => broadcast({ type: "pipeline", phase: "start", project: meta }),
    onAgentStart: (id, projectId) => {
      state[id].status = "working";
      broadcast({ type: "status", agentId: id, status: "working", projectId });
    },
    onAgentChunk: (id, chunk) => broadcast({ type: "stream", agentId: id, chunk }),
    onAgentDone: (id, output) => {
      state[id].status = "done";
      state[id].lastOutput = output;
      broadcast({ type: "status", agentId: id, status: "done", output });
    },
    onAgentError: (id, error) => {
      state[id].status = "error";
      broadcast({ type: "status", agentId: id, status: "error", error });
    },
  };
}

app.post("/pipeline", (req, res) => {
  const { brief, complexity } = req.body;

  if (!brief || typeof brief !== "string") {
    return res.status(400).json({ error: "Campo 'brief' (string) é obrigatório" });
  }
  if (isRunning()) {
    return res.status(409).json({ error: "Já está a correr um pipeline. Espera que termine." });
  }

  res.json({ accepted: true });

  runPipeline(brief, pipelineHooks(), { complexity })
    .then((meta) => broadcast({ type: "pipeline", phase: "end", project: meta }))
    .catch((err) => broadcast({ type: "pipeline", phase: "end", error: err.message }));
});


// Alterar uma plataforma que já existe no vault
app.post("/projects/:id/revise", (req, res) => {
  const { brief, agents, complexity } = req.body;

  if (!brief || typeof brief !== "string") {
    return res.status(400).json({ error: "Campo 'brief' (string) é obrigatório" });
  }
  if (isRunning()) {
    return res.status(409).json({ error: "Já está a correr um pipeline. Espera que termine." });
  }
  // Validar aqui, e não só quando o pipeline arranca: senão a interface
  // recebe "aceite" e só descobre o erro segundos depois, pelo WebSocket.
  if (!vault.readMeta(req.params.id)) {
    return res.status(404).json({ error: `O projeto '${req.params.id}' não existe no vault.` });
  }

  res.json({ accepted: true, projectId: req.params.id });

  reviseProject(
    req.params.id, brief,
    Array.isArray(agents) ? agents : null,
    pipelineHooks(), { complexity }
  )
    .then((meta) => broadcast({ type: "pipeline", phase: "end", project: meta }))
    .catch((err) => broadcast({ type: "pipeline", phase: "end", error: err.message }));
});

app.post("/reset", (req, res) => {
  forceReset();
  for (const id of Object.keys(ROLES)) {
    state[id].status = "idle";
    broadcast({ type: "status", agentId: id, status: "idle" });
  }
  broadcast({ type: "pipeline", phase: "end" });
  res.json({ reset: true });
});

/* ---------------- vault ---------------- */

app.get("/projects", (req, res) => {
  try {
    res.json(vault.listProjects());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/projects/:id/launch", (req, res) => {
  try {
    res.json(preview.launch(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/projects/:id/stop", (req, res) => {
  res.json({ stopped: preview.stop(req.params.id) });
});

app.delete("/projects/:id", (req, res) => {
  try {
    preview.stop(req.params.id);
    vault.deleteProject(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Serve os ficheiros de um projeto estático em /preview/<id>/
app.use("/preview/:id", (req, res, next) => {
  const root = preview.staticRoot(req.params.id);
  if (!root) return res.status(404).send("Este projeto não tem nada estático para mostrar.");
  express.static(root)(req, res, next);
});

/* ---------------- estatísticas (graphify) ---------------- */

app.get("/stats", (req, res) => {
  try {
    const projects = vault.listProjects();

    const totals = { projects: projects.length, files: 0, bytes: 0, commits: 0 };
    const byExt = {};
    const byAgent = {};
    const timeline = [];

    for (const p of projects) {
      totals.files += p.files.files;
      totals.bytes += p.files.bytes;
      totals.commits += p.git.total;

      for (const [ext, n] of Object.entries(p.files.byExt)) {
        byExt[ext] = (byExt[ext] || 0) + n;
      }
      for (const [agent, n] of Object.entries(p.git.byAgent)) {
        byAgent[agent] = (byAgent[agent] || 0) + n;
      }
      for (const c of p.git.commits) {
        timeline.push({ project: p.id, agent: c.agent, at: c.at });
      }

      // Duração de cada etapa, para o gráfico de tempos
      for (const s of p.stages || []) {
        if (s.startedAt && s.finishedAt) {
          const key = s.label || s.agent;
          byAgent[key] = byAgent[key] || 0;
        }
      }
    }

    const durations = {};
    for (const p of projects) {
      for (const s of p.stages || []) {
        if (!s.startedAt || !s.finishedAt) continue;
        const key = s.label || s.agent;
        (durations[key] = durations[key] || []).push(s.finishedAt - s.startedAt);
      }
    }
    const avgDuration = {};
    for (const [k, arr] of Object.entries(durations)) {
      avgDuration[k] = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length / 1000);
    }

    timeline.sort((a, b) => a.at - b.at);

    res.json({
      totals, byExt, byAgent, avgDuration,
      timeline: timeline.slice(-200),
      projects: projects.map((p) => ({
        id: p.id, name: p.name, status: p.status, createdAt: p.createdAt,
        files: p.files.files, bytes: p.files.bytes, commits: p.git.total,
        stages: (p.stages || []).length,
        // por projeto, para o grafo poder desenhar aglomerados
        byExt: p.files.byExt,
        byAgent: p.git.byAgent,
        deliverable: p.deliverable || p.entry?.type || 'none',
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`AI Office orchestrator a correr em http://0.0.0.0:${PORT}`);
  console.log(`Vault: ${vault.VAULT_DIR}`);
});
