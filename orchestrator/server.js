// PRIMEIRA linha de tudo: os segredos têm de estar no ambiente antes de
// qualquer módulo os ir procurar ao carregar.
const { carregar: carregarEnv, FICHEIRO: ENV_FILE } = require("./agents/env");
const env = carregarEnv();

const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");

const { ROLES } = require("./agents/roles");
const { runAgent } = require("./agents/runner");
const { runPipeline, reviseProject, isRunning, forceReset, current } = require("./agents/pipeline");
const vault = require("./agents/vault");
const stacks = require("./agents/stacks");
const faturacao = require("./agents/faturacao");
const plesk = require("./agents/plesk");
const saude = require("./agents/saude");
const { espacoLivreMB, MIN_DISCO_MB } = require("./agents/build");
const assignments = require("./agents/assignments");
const models = require("./agents/models");
const preview = require("./agents/preview");
const auth = require("./agents/auth");

const app = express();

// CORS restrito. Antes era cors() aberto: qualquer site podia mandar
// pedidos ao orchestrator a partir do browser de quem o visitasse. Só
// origens explicitamente autorizadas passam, e por omissão nenhuma —
// o painel é servido pelo próprio orchestrator e não precisa de CORS.
const ORIGENS = (process.env.OFFICE_CORS_ORIGINS || "")
  .split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors({
  origin: ORIGENS.length ? ORIGENS : false,
  credentials: true,
}));

// Corpo limitado: sem isto, um POST de 500 MB enche a memória do processo.
app.use(express.json({ limit: "1mb" }));

// Cabeçalhos de defesa. Não substituem autenticação, mas reduzem o que
// um problema no HTML de uma plataforma consegue fazer.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

// Guarda o host para construir URLs de projetos Node
app.use((req, _res, next) => { preview.setHost(req.headers.host); next(); });

// A AUTENTICAÇÃO VEM ANTES DOS FICHEIROS ESTÁTICOS. Ao contrário, o
// painel e o vault ficariam acessíveis a qualquer pessoa e só a API
// estaria protegida — que foi exatamente o erro que quase cometi aqui.
app.use(auth.middleware);

app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
// noServer + verificação manual: o WebSocketServer normal aceita o
// handshake antes de nós vermos quem é. Assim autenticamos primeiro.
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (!auth.autorizado(req)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

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

/* ---------------- dispositivos (biometria no telemóvel) ---------------- */

// Trocar credenciais por um token de longa duração. Só por Basic: um
// token não pode gerar outro token, senão um telemóvel roubado
// conseguia multiplicar-se e a revogação deixava de valer.
app.post("/auth/token",
  auth.limitar({ max: 5, janelaMs: 15 * 60 * 1000,
    mensagem: "Demasiadas tentativas de emparelhamento. Espera 15 minutos." }),
  (req, res) => {
    if (!auth.configurado()) {
      return res.status(400).json({
        error: "Define OFFICE_PASSWORD antes de emparelhar dispositivos.",
      });
    }
    if (!auth.credenciaisValidas(req)) {
      res.setHeader("WWW-Authenticate", 'Basic realm="AI Office"');
      return res.status(401).json({ error: "Credenciais inválidas." });
    }
    const { token, id, expira } = auth.criarTokenDispositivo(req.body?.etiqueta);
    // O token vai UMA vez. Não é recuperável: perdido, emparelha-se de novo.
    res.json({ token, id, expira: new Date(expira).toISOString() });
  });

app.get("/auth/devices", (req, res) => {
  res.json({ dispositivos: auth.listarDispositivos() });
});

// O que salva o dia em que o telemóvel desaparecer.
app.post("/auth/devices/:id/revogar", (req, res) => {
  const ok = auth.revogarDispositivo(req.params.id);
  if (!ok) return res.status(404).json({ error: "Dispositivo desconhecido." });
  res.json({ revogado: req.params.id });
});

/* ---------------- faturação: mensalidades dos clientes ---------------- */

// Envolve um handler para não repetir try/catch em cada rota. Os erros do
// módulo de faturação são de validação, por isso 400 e não 500.
const rota = (fn) => (req, res) => {
  try { res.json(fn(req, res)); }
  catch (err) { res.status(400).json({ error: err.message }); }
};

app.get("/faturacao/estado", rota((req) => faturacao.estado(req.query.mes)));
app.get("/faturacao/clientes", rota(() => ({ clientes: faturacao.listarClientes() })));
app.get("/faturacao/clientes/:id", rota((req) => faturacao.historico(req.params.id)));

app.post("/faturacao/clientes", rota((req) => faturacao.adicionarCliente(req.body || {})));
app.patch("/faturacao/clientes/:id", rota((req) => faturacao.editarCliente(req.params.id, req.body || {})));
app.post("/faturacao/clientes/:id/desativar", rota((req) => faturacao.desativarCliente(req.params.id)));

app.post("/faturacao/pagamentos", rota((req) => faturacao.registarPagamento(req.body || {})));
app.post("/faturacao/pagamentos/:id/anular",
  rota((req) => faturacao.anularPagamento(req.params.id, req.body?.motivo)));

/* ---------------- domínios: inventário e saúde ---------------- */

// Cache do último varrimento. Verificar 30 domínios leva 20-40 segundos,
// e a página não pode esperar por isso a cada abertura.
let ultimoVarrimento = null;
let aVarrer = false;

/** Todos os domínios conhecidos: os do Plesk mais os da faturação. */
async function inventario() {
  const clientes = faturacao.listarClientes().filter((c) => c.ativo);

  // Domínio -> cliente. Um domínio pode estar na faturação sem estar no
  // Plesk (alojado noutro sítio) e vice-versa; ambos os casos interessam.
  const dono = new Map();
  for (const c of clientes) {
    for (const d of c.dominios || []) {
      dono.set(String(d).toLowerCase().trim(), { id: c.id, nome: c.nome });
    }
  }

  let noPlesk = [];
  let erroPlesk = null;
  if (plesk.configurado()) {
    try {
      const r = await plesk.dominios();
      noPlesk = r.dominios.map((d) => ({
        nome: String(d.name).toLowerCase(),
        id: d.id, criado: d.created, tipo: d.hosting_type,
      }));
    } catch (e) { erroPlesk = e.message; }
  }

  const todos = new Map();
  for (const d of noPlesk) {
    todos.set(d.nome, { dominio: d.nome, noPlesk: true, plesk: d, cliente: dono.get(d.nome) || null });
  }
  for (const [nome, c] of dono) {
    if (!todos.has(nome)) {
      todos.set(nome, { dominio: nome, noPlesk: false, plesk: null, cliente: c });
    }
  }

  return { dominios: [...todos.values()], erroPlesk, pleskConfigurado: plesk.configurado() };
}

app.get("/dominios", async (req, res) => {
  try { res.json(await inventario()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Último resultado, sem verificar nada. É o que a página carrega primeiro.
app.get("/dominios/saude", (req, res) => {
  res.json({ aVarrer, ...(ultimoVarrimento || { resultados: [], resumo: null, em: null }) });
});

// Varrimento. Limitado: cada um abre centenas de ligações de rede.
app.post("/dominios/saude/verificar",
  auth.limitar({ max: 6, janelaMs: 10 * 60 * 1000,
    mensagem: "Demasiados varrimentos seguidos. Espera uns minutos." }),
  async (req, res) => {
    if (aVarrer) return res.status(409).json({ error: "Já está a decorrer um varrimento." });

    try {
      const inv = await inventario();
      const nomes = inv.dominios.map((d) => d.dominio);
      if (!nomes.length) return res.json({ resultados: [], resumo: null, aviso: "Não há domínios para verificar." });

      aVarrer = true;
      // Responde já e continua em fundo: com 30 domínios isto passa dos
      // 30 segundos e qualquer proxy à frente cortaria a ligação.
      res.json({ iniciado: true, total: nomes.length });

      const r = await saude.verificarVarios(nomes, 5);
      const porDominio = new Map(inv.dominios.map((d) => [d.dominio, d]));
      ultimoVarrimento = {
        em: new Date().toISOString(),
        resumo: r.resumo,
        resultados: r.resultados.map((x) => ({ ...x, ...(porDominio.get(x.dominio) || {}) })),
      };
    } catch (err) {
      console.error("[saude] varrimento falhou:", err.message);
    } finally {
      aVarrer = false;
    }
  });

// Um domínio só, à vontade — para verificar depois de mexer em DNS.
app.get("/dominios/saude/:dominio", async (req, res) => {
  try { res.json(await saude.verificar(req.params.dominio)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

/* ---------------- Plesk (opcional, só enriquecimento) ---------------- */

app.get("/plesk/estado", async (req, res) => {
  res.json({ configurado: plesk.configurado(), ...(await plesk.testar()) });
});

app.get("/plesk/cruzar", async (req, res) => {
  if (!plesk.configurado()) {
    // 200 e não erro: a faturação funciona sem Plesk, e a interface
    // precisa de saber distinguir "não configurado" de "avariado".
    return res.json({ configurado: false, porCliente: [], orfaos: [] });
  }
  try {
    const r = await plesk.cruzar(faturacao.listarClientes().filter((c) => c.ativo));
    res.json({ configurado: true, ...r });
  } catch (err) {
    res.status(502).json({ configurado: true, error: err.message });
  }
});

app.get("/stacks", (req, res) => {
  const livre = espacoLivreMB(__dirname);
  res.json({
    stacks: stacks.listar(),
    defeito: stacks.DEFEITO,
    // Ficar sem disco a meio de um npm install é dos piores sítios onde
    // se pode falhar: o painel avisa antes de deixar escolher.
    disco: { livreMB: livre, minimoMB: MIN_DISCO_MB, chega: livre === null || livre >= MIN_DISCO_MB },
  });
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
    // O pipeline emite etapas que NÃO são agentes — o "build", por
    // exemplo. Escrever em state[id] às cegas rebentava com TypeError
    // (state vem dos ROLES e não tem "build"), e a exceção matava o
    // pipeline a meio: sem build, sem QA, e o projeto fechado como
    // concluído. Um hook de notificação nunca deve poder abortar o
    // trabalho que está a notificar.
    onAgentStart: (id, projectId, escolha) => {
      if (state[id]) state[id].status = "working";
      broadcast({ type: "status", agentId: id, status: "working", projectId, ...escolha });
    },
    onAgentChunk: (id, chunk) => broadcast({ type: "stream", agentId: id, chunk }),
    onAgentDone: (id, output) => {
      if (state[id]) { state[id].status = "done"; state[id].lastOutput = output; }
      broadcast({ type: "status", agentId: id, status: "done", output });
    },
    onAgentError: (id, error) => {
      if (state[id]) state[id].status = "error";
      broadcast({ type: "status", agentId: id, status: "error", error });
    },
  };
}

// Construir custa quota e tempo; apagar é irreversível. São estes dois
// que interessa travar, não os GET de leitura.
const travaoConstrucao = auth.limitar({
  max: 6, janelaMs: 10 * 60 * 1000,
  mensagem: "Demasiadas construções seguidas. Espera um pouco.",
});
const travaoGeral = auth.limitar({
  max: 60, janelaMs: 60 * 1000,
  mensagem: "Demasiados pedidos. Espera um minuto.",
});

app.post("/pipeline", travaoConstrucao, (req, res) => {
  const { brief, complexity, stack } = req.body;

  if (!brief || typeof brief !== "string") {
    return res.status(400).json({ error: "Campo 'brief' (string) é obrigatório" });
  }
  if (isRunning()) {
    return res.status(409).json({ error: "Já está a correr um pipeline. Espera que termine." });
  }

  res.json({ accepted: true });

  runPipeline(brief, pipelineHooks(), { complexity, stack })
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
  console.log(auth.configurado()
    ? `Autenticação: ativa (utilizador "${auth.UTILIZADOR()}")`
    : `AUTENTICAÇÃO DESLIGADA — qualquer pessoa com o IP pode usar isto. ` +
      `Define OFFICE_PASSWORD no .env.`);
  // Diz QUANTOS segredos leu e QUAIS existem — nunca os valores.
  console.log(env.existe
    ? `Segredos: ${env.carregadas} de ${ENV_FILE}`
    : `Sem ${ENV_FILE} (as chaves de Stripe e Sanity ficam por definir)`);
});
