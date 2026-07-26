// Publicar uma plataforma do vault no GitHub.
//
// Cada projeto já é um repositório git com histórico por agente — falta
// só o remoto. Isto cria o repositório na conta do dono e empurra.
//
// Precisa de um Personal Access Token com permissão de escrita em
// Contents e Administration (para criar repositórios). Vive no .env,
// que está no .gitignore.

const { execFileSync } = require("child_process");
const { carregar } = require("./env");
const { projectPath, readMeta, writeMeta } = require("./vault");

const API = "https://api.github.com";

function token() {
  carregar();
  const t = process.env.GITHUB_TOKEN;
  if (!t) {
    throw new Error(
      "Falta o GITHUB_TOKEN no .env. Cria um token em " +
      "github.com/settings/personal-access-tokens/new com Contents e " +
      "Administration a 'Read and write'."
    );
  }
  return t;
}

async function api(caminho, opcoes = {}) {
  const r = await fetch(`${API}${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(opcoes.headers || {}),
    },
  });
  const texto = await r.text();
  let corpo = null;
  try { corpo = texto ? JSON.parse(texto) : null; } catch {}
  return { ok: r.ok, estado: r.status, corpo };
}

/** Quem somos, para saber onde criar o repositório. */
async function utilizador() {
  const { ok, corpo } = await api("/user");
  if (!ok) throw new Error("O token do GitHub não é válido ou expirou.");
  return corpo.login;
}

/** Nome de repositório seguro a partir do id do projeto. */
function nomeRepo(id) {
  return id.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90)
    || "plataforma";
}

/**
 * Cria o repositório e empurra o que está no vault.
 * @param {string} id       projeto do vault
 * @param {boolean} privado por omissão sim: são plataformas geradas por IA
 */
async function publicar(id, privado = true) {
  const meta = readMeta(id);
  if (!meta) throw new Error(`O projeto '${id}' não existe no vault.`);

  const dir = projectPath(id);
  const dono = await utilizador();
  const repo = nomeRepo(id);

  // Já publicado? Então é só empurrar o que há de novo.
  const jaExiste = await api(`/repos/${dono}/${repo}`);
  if (!jaExiste.ok) {
    const criado = await api("/user/repos", {
      method: "POST",
      body: JSON.stringify({
        name: repo,
        description: (meta.brief || meta.name || "").slice(0, 350),
        private: privado,
        auto_init: false,
      }),
    });
    if (!criado.ok) {
      const msg = criado.corpo?.message || `erro ${criado.estado}`;
      throw new Error(`Não consegui criar o repositório: ${msg}`);
    }
  }

  // O token vai no URL do remoto, não em ficheiro nenhum, e o remoto é
  // reescrito a cada publicação — assim não fica gravado no .git/config
  // de forma permanente... mas fica na mesma no config enquanto existir.
  // Por isso limpamos no fim.
  const comAuth = `https://${token()}@github.com/${dono}/${repo}.git`;
  const limpo = `https://github.com/${dono}/${repo}.git`;

  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  try {
    // garante que há pelo menos um commit para empurrar
    try { git("rev-parse", "HEAD"); }
    catch {
      git("add", "-A");
      git("-c", "user.email=office@ai.local", "-c", "user.name=AI Office",
          "commit", "--allow-empty", "-m", "Estado inicial");
    }

    try { git("remote", "remove", "origin"); } catch {}
    git("remote", "add", "origin", comAuth);

    // o nome do ramo varia consoante a versão do git
    let ramo = "master";
    try { ramo = git("rev-parse", "--abbrev-ref", "HEAD").trim() || "master"; } catch {}

    git("push", "-u", "origin", `${ramo}:main`, "--force");
  } finally {
    // Nunca deixar o token gravado no .git/config do projeto: se algum
    // dia o vault for partilhado ou arquivado, ia junto.
    try { git("remote", "set-url", "origin", limpo); } catch {}
  }

  meta.github = { url: `https://github.com/${dono}/${repo}`, privado, em: new Date().toISOString() };
  writeMeta(id, meta);

  return meta.github;
}

module.exports = { publicar, nomeRepo };
