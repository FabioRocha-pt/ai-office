// O Vault: cada plataforma que o escritório constrói vive na sua própria
// pasta, com metadados e histórico git próprios.
//
//   vault/
//     lista-de-tarefas/
//       .aioffice.json      <- metadados (nome, briefing, datas, etapas)
//       .claude/settings.json
//       .git/
//       ...ficheiros do projeto

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const VAULT_DIR = process.env.VAULT_DIR
  || path.join(__dirname, "..", "..", "vault");

const META_FILE = ".aioffice.json";

function ensureVault() {
  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
}

/** Transforma um briefing num nome de pasta seguro e legível. */
function slugify(text) {
  const base = text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // tira acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "projeto";

  ensureVault();
  let slug = base, n = 2;
  while (fs.existsSync(path.join(VAULT_DIR, slug))) slug = `${base}-${n++}`;
  return slug;
}

function projectPath(id) {
  return path.join(VAULT_DIR, id);
}

function readMeta(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectPath(id), META_FILE), "utf8"));
  } catch {
    return null;
  }
}

function writeMeta(id, meta) {
  try {
    fs.writeFileSync(
      path.join(projectPath(id), META_FILE),
      JSON.stringify(meta, null, 2)
    );
  } catch (err) {
    console.warn(`[vault] não consegui gravar metadados de ${id}: ${err.message}`);
  }
}

/** Cria uma pasta de projeto nova a partir de um briefing. */
function createProject(brief, name) {
  ensureVault();
  const id = slugify(name || brief);
  const dir = projectPath(id);
  fs.mkdirSync(dir, { recursive: true });

  const meta = {
    id,
    name: name || brief.slice(0, 70),
    brief,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    status: "building",       // building | done | failed
    stages: [],               // [{ agent, label, startedAt, finishedAt, ok }]
  };
  writeMeta(id, meta);
  return meta;
}

/** Conta ficheiros e tamanho, ignorando .git e node_modules. */
function scanFiles(dir, acc = { files: 0, bytes: 0, byExt: {} }, depth = 0) {
  if (depth > 6) return acc;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }

  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === ".claude") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      scanFiles(full, acc, depth + 1);
    } else if (e.isFile()) {
      if (e.name === META_FILE) continue;
      acc.files++;
      try { acc.bytes += fs.statSync(full).size; } catch {}
      const ext = (path.extname(e.name) || "sem extensão").replace(".", "") || "outro";
      acc.byExt[ext] = (acc.byExt[ext] || 0) + 1;
    }
  }
  return acc;
}

/** Commits por agente, lidos do histórico git. */
function gitStats(dir) {
  try {
    const raw = execSync('git log --format="%s|%at"', {
      cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    const commits = raw.trim().split("\n").filter(Boolean).map((line) => {
      const [subject, ts] = line.split("|");
      const agent = (subject.split(":")[0] || "?").trim();
      return { agent, at: Number(ts) * 1000 };
    });
    const byAgent = {};
    for (const c of commits) byAgent[c.agent] = (byAgent[c.agent] || 0) + 1;
    return { total: commits.length, byAgent, commits };
  } catch {
    return { total: 0, byAgent: {}, commits: [] };
  }
}

/** Descobre como o projeto se pode abrir. */
function detectEntry(dir) {
  // 'out/' primeiro: num projeto Next.js exportado é essa a entrega
  // real, e existe muitas vezes ao lado de um public/ com ícones que
  // não é a aplicação.
  const candidates = [
    "out/index.html", "build/index.html", "dist/index.html",
    "public/index.html", "index.html", "src/index.html",
  ];
  for (const rel of candidates) {
    if (fs.existsSync(path.join(dir, rel))) {
      return { type: "static", root: path.dirname(rel) === "." ? "" : path.dirname(rel) };
    }
  }
  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg.scripts?.start) return { type: "node", script: "start" };
      // Há package.json e um build por correr: não é entrega, mas
      // também não é "nada" — distingue-se para o painel poder dizer
      // que falta compilar em vez de "sem entrega".
      if (pkg.scripts?.build) return { type: "porconstruir", script: "build" };
    } catch {}
  }
  return { type: "none" };
}

function listProjects() {
  ensureVault();
  return fs.readdirSync(VAULT_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const id = e.name;
      const dir = projectPath(id);
      const meta = readMeta(id) || {
        id, name: id, brief: "", createdAt: null, status: "unknown", stages: [],
      };
      return {
        ...meta,
        files: scanFiles(dir),
        git: gitStats(dir),
        entry: detectEntry(dir),
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * No arranque, nada pode estar a correr — o processo acabou de subir.
 * Qualquer projeto ainda em 'building' ficou preso porque o servidor
 * morreu a meio (um pm2 restart durante um pipeline, por exemplo), e
 * sem isto ficava eternamente "a construir" no painel.
 */
function reconcileOnBoot() {
  ensureVault();
  let arrumados = 0;

  for (const e of fs.readdirSync(VAULT_DIR, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const meta = readMeta(e.name);
    if (!meta || meta.status !== "building") continue;

    const entry = detectEntry(projectPath(e.name));
    meta.deliverable = entry.type;
    // Interrompido a meio, mas se chegou a deixar algo abrível não faz
    // sentido esconder-to: fica utilizável, apenas marcado como tal.
    meta.status = "interrupted";
    meta.finishedAt = meta.finishedAt || new Date().toISOString();
    writeMeta(e.name, meta);
    arrumados++;
  }

  if (arrumados) {
    console.log(`[vault] ${arrumados} projeto(s) preso(s) em 'building' marcados como interrompidos`);
  }
}

function deleteProject(id) {
  const dir = projectPath(id);
  if (!dir.startsWith(VAULT_DIR)) throw new Error("Caminho inválido");
  if (!fs.existsSync(dir)) throw new Error("Projeto não existe");
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Traz para o vault o projeto antigo que vivia em ai-office/project,
 * para não se perder o trabalho já feito.
 */
function migrateLegacy() {
  const legacy = path.join(__dirname, "..", "..", "project");
  if (!fs.existsSync(legacy)) return;

  ensureVault();
  const id = slugify("lista-de-tarefas");
  const dest = projectPath(id);
  try {
    fs.renameSync(legacy, dest);
    if (!fs.existsSync(path.join(dest, META_FILE))) {
      writeMeta(id, {
        id,
        name: "Lista de Tarefas",
        brief: "Primeiro projeto do escritório (migrado da pasta antiga).",
        createdAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status: "done",
        stages: [],
      });
    }
    console.log(`[vault] projeto antigo migrado para vault/${id}`);
  } catch (err) {
    console.warn(`[vault] falhou migrar projeto antigo: ${err.message}`);
  }
}

module.exports = {
  VAULT_DIR, createProject, listProjects, readMeta, writeMeta,
  projectPath, deleteProject, detectEntry, scanFiles, gitStats, migrateLegacy,
  reconcileOnBoot,
};
