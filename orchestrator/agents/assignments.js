// Que CLI corre cada agente.
//
// O roles.js define a atribuição de fábrica. Este módulo guarda a tua
// escolha por cima disso, para poderes trocar um agente de CLI quando os
// créditos de uma acabam — sem editar código nem reiniciar o servidor.
//
// Fica em assignments.json ao lado do vault, por isso sobrevive a
// reinstalações do zip.

const fs = require("fs");
const path = require("path");
const { ROLES } = require("./roles");
const { SUPPORTED_CLIS } = require("./runner");

const FILE = process.env.ASSIGNMENTS_FILE
  || path.join(__dirname, "..", "..", "assignments.json");

/** Atribuição de fábrica, lida do roles.js. */
function defaults() {
  const out = {};
  for (const [id, role] of Object.entries(ROLES)) out[id] = role.cli;
  return out;
}

function read() {
  const base = defaults();
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
    for (const [id, cli] of Object.entries(saved)) {
      // Ignora agentes que já não existem e CLIs que não sabemos correr,
      // para um ficheiro antigo não deitar o escritório abaixo.
      if (base[id] && SUPPORTED_CLIS.includes(cli)) base[id] = cli;
    }
  } catch {
    // sem ficheiro ainda, ou ilegível — ficamos pelos defaults
  }
  return base;
}

function write(map) {
  const current = read();
  const next = { ...current };

  for (const [id, cli] of Object.entries(map || {})) {
    if (!ROLES[id]) throw new Error(`Agente '${id}' não existe`);
    if (!SUPPORTED_CLIS.includes(cli)) {
      throw new Error(`CLI '${cli}' não é suportada. Disponíveis: ${SUPPORTED_CLIS.join(", ")}`);
    }
    next[id] = cli;
  }

  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}

function reset() {
  try { fs.unlinkSync(FILE); } catch {}
  return defaults();
}

/**
 * Devolve o papel com a CLI atualmente atribuída.
 * É isto que o runner deve receber, nunca o ROLES[id] cru.
 */
function effectiveRole(id, map = read()) {
  const role = ROLES[id];
  if (!role) return null;
  return { ...role, cli: map[id] || role.cli };
}

module.exports = { read, write, reset, defaults, effectiveRole, SUPPORTED_CLIS, FILE };
