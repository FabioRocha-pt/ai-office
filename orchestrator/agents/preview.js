// Abrir um projeto do vault para o veres a funcionar.
//
// Projetos estáticos (HTML/CSS/JS) são servidos pelo próprio orchestrator
// em /preview/<id>/ — sem portas novas, sem mexer na firewall, e continua
// a funcionar quando puseres HTTPS à frente.
//
// Projetos Node (com "start" no package.json) precisam mesmo de processo
// próprio, e aí alocamos uma porta do intervalo abaixo.

const { spawn } = require("child_process");
const path = require("path");
const { projectPath, detectEntry } = require("./vault");

const PORT_MIN = Number(process.env.PREVIEW_PORT_MIN) || 8100;
const PORT_MAX = Number(process.env.PREVIEW_PORT_MAX) || 8149;

const running = new Map(); // id -> { port, proc, startedAt }

function nextPort() {
  const taken = new Set([...running.values()].map((r) => r.port));
  for (let p = PORT_MIN; p <= PORT_MAX; p++) if (!taken.has(p)) return p;
  throw new Error("Não há portas livres para preview.");
}

/**
 * Prepara um projeto para ser visto.
 * @returns {{type:string, url:string, port?:number}}
 */
function launch(id) {
  const dir = projectPath(id);
  const entry = detectEntry(dir);

  if (entry.type === "static") {
    // servido pelo orchestrator — nada para arrancar
    return { type: "static", url: `/preview/${encodeURIComponent(id)}/` };
  }

  if (entry.type === "node") {
    const already = running.get(id);
    if (already && !already.proc.killed) {
      return { type: "node", url: `http://${hostOf()}:${already.port}`, port: already.port };
    }

    const port = nextPort();
    const proc = spawn("npm", ["run", entry.script], {
      cwd: dir,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    proc.stdout.on("data", (d) => console.log(`[preview:${id}] ${d}`));
    proc.stderr.on("data", (d) => console.log(`[preview:${id}] ${d}`));
    proc.on("close", () => running.delete(id));

    running.set(id, { port, proc, startedAt: Date.now() });
    return { type: "node", url: `http://${hostOf()}:${port}`, port };
  }

  throw new Error(
    "Este projeto ainda não tem nada para abrir — falta um index.html ou um script de arranque."
  );
}

function stop(id) {
  const r = running.get(id);
  if (!r) return false;
  try { r.proc.kill("SIGTERM"); } catch {}
  running.delete(id);
  return true;
}

function status() {
  return [...running.entries()].map(([id, r]) => ({
    id, port: r.port, startedAt: r.startedAt,
  }));
}

// O host é preenchido pelo pedido; guardamos o último conhecido para
// construir URLs de projetos Node.
let lastHost = "localhost";
function setHost(h) { if (h) lastHost = String(h).split(":")[0]; }
function hostOf() { return lastHost; }

/** Raiz de ficheiros a servir para um projeto estático. */
function staticRoot(id) {
  const dir = projectPath(id);
  const entry = detectEntry(dir);
  if (entry.type !== "static") return null;
  return entry.root ? path.join(dir, entry.root) : dir;
}

module.exports = { launch, stop, status, setHost, staticRoot, PORT_MIN, PORT_MAX };
