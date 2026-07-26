// Autenticação e travões de abuso.
//
// Até aqui o orchestrator estava aberto: quem soubesse o IP podia mandar
// construir plataformas, ler o código do vault e apagar projetos. Com
// chaves de pagamento no ambiente, isso passa de mau a inaceitável.
//
// Escolhas e porquês:
//
//   - Basic auth em vez de página de login. Uma linha de configuração,
//     funciona no curl e no browser, e não precisa de base de dados de
//     utilizadores para um sistema de uma pessoa.
//   - Cookie assinado a seguir, porque os browsers NÃO enviam o cabeçalho
//     Authorization no handshake de WebSocket. Sem o cookie, o painel
//     autenticava e a ligação em tempo real ficava de fora.
//   - Comparação em tempo constante. Comparar strings com === deixa
//     escapar o comprimento e a posição do primeiro carácter errado.
//   - Sem dependências: são umas dezenas de linhas e não vale acrescentar
//     pacotes ao caminho da autenticação, que é onde menos convém ter
//     código que não se leu.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const UTILIZADOR = () => process.env.OFFICE_USER || "fabio";
const PALAVRA_PASSE = () => process.env.OFFICE_PASSWORD || "";

// Segredo das assinaturas. Se não for dado, gera-se um por arranque: os
// cookies deixam de valer a cada reinício, o que é aceitável para uma
// pessoa e melhor do que um segredo previsível no código.
const SEGREDO = process.env.OFFICE_SECRET || crypto.randomBytes(32).toString("hex");

const VALIDADE_MS = 12 * 60 * 60 * 1000;   // 12 horas
const COOKIE = "office_sess";

const configurado = () => PALAVRA_PASSE().length > 0;

/* ─────────────────────────────────────────────────────────────
   Comparação segura
   ───────────────────────────────────────────────────────────── */

function iguais(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  // timingSafeEqual exige comprimentos iguais; passamos os dois por um
  // hash para não revelar o comprimento da palavra-passe.
  const ha = crypto.createHash("sha256").update(ba).digest();
  const hb = crypto.createHash("sha256").update(bb).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* ─────────────────────────────────────────────────────────────
   Cookie de sessão
   ───────────────────────────────────────────────────────────── */

function assinar(valor) {
  return crypto.createHmac("sha256", SEGREDO).update(valor).digest("base64url");
}

function criarSessao() {
  const expira = String(Date.now() + VALIDADE_MS);
  return `${expira}.${assinar(expira)}`;
}

function sessaoValida(bruto) {
  if (!bruto) return false;
  const [expira, assinatura] = String(bruto).split(".");
  if (!expira || !assinatura) return false;
  // A assinatura é verificada ANTES da data: sem isso, um atacante podia
  // aprender coisas pela diferença entre "expirou" e "assinatura errada".
  let ok;
  try { ok = iguais(assinatura, assinar(expira)); } catch { return false; }
  if (!ok) return false;
  return Number(expira) > Date.now();
}

function lerCookie(req, nome) {
  const bruto = req.headers.cookie || "";
  for (const parte of bruto.split(";")) {
    const [k, ...resto] = parte.trim().split("=");
    if (k === nome) return decodeURIComponent(resto.join("="));
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────
   Tokens de dispositivo
   ─────────────────────────────────────────────────────────────
   Escreves as credenciais uma vez no telemóvel; ele troca-as por um
   token de longa duração e guarda-o no Keystore, atrás da impressão
   digital.

   A biometria NÃO autentica no servidor. A impressão digital nunca sai
   do telemóvel: desbloqueia a chave que decifra este token. Para o
   servidor, o telemóvel é só um cliente com um token válido — e é por
   isso que a revogação abaixo não é um extra, é o que te salva no dia
   em que perderes o Flip.
   ───────────────────────────────────────────────────────────── */

const FICHEIRO_DISPOSITIVOS = process.env.DEVICES_FILE
  || path.join(__dirname, "..", "..", "dispositivos.json");

const VALIDADE_DISPOSITIVO_MS = 180 * 24 * 60 * 60 * 1000;   // 180 dias

function lerDispositivos() {
  try { return JSON.parse(fs.readFileSync(FICHEIRO_DISPOSITIVOS, "utf8")); }
  catch { return {}; }
}

function gravarDispositivos(d) {
  const temp = FICHEIRO_DISPOSITIVOS + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(d, null, 2));
  fs.renameSync(temp, FICHEIRO_DISPOSITIVOS);
}

/** Cria um token. Devolve-o UMA vez; o servidor não o guarda. */
function criarTokenDispositivo(etiqueta) {
  const id = crypto.randomBytes(9).toString("base64url");
  const expira = Date.now() + VALIDADE_DISPOSITIVO_MS;
  const corpo = `d.${id}.${expira}`;

  const dispositivos = lerDispositivos();
  // Só metadados. Se alguém ler este ficheiro, não consegue entrar
  // com o que lá está — a assinatura é que faz o token, e ela não
  // fica gravada.
  dispositivos[id] = {
    etiqueta: String(etiqueta || "dispositivo").slice(0, 60),
    criado: new Date().toISOString(),
    expira: new Date(expira).toISOString(),
    ultimoUso: null,
    revogado: false,
  };
  gravarDispositivos(dispositivos);

  return { token: `${corpo}.${assinar(corpo)}`, id, expira };
}

function tokenDispositivoValido(bruto) {
  if (!bruto || !String(bruto).startsWith("d.")) return false;

  const partes = String(bruto).split(".");
  if (partes.length !== 4) return false;

  const [, id, expira, assinatura] = partes;
  const corpo = `d.${id}.${expira}`;

  let ok;
  try { ok = iguais(assinatura, assinar(corpo)); } catch { return false; }
  if (!ok) return false;
  if (Number(expira) <= Date.now()) return false;

  const registo = lerDispositivos()[id];
  if (!registo || registo.revogado) return false;

  // Registar o uso sem escrever em disco a cada pedido: só quando o
  // dia muda. Escrever sempre daria um ficheiro reescrito por cada
  // imagem que o painel carrega.
  const hoje = new Date().toISOString().slice(0, 10);
  if ((registo.ultimoUso || "").slice(0, 10) !== hoje) {
    const todos = lerDispositivos();
    if (todos[id]) {
      todos[id].ultimoUso = new Date().toISOString();
      gravarDispositivos(todos);
    }
  }
  return true;
}

function listarDispositivos() {
  return Object.entries(lerDispositivos()).map(([id, v]) => ({ id, ...v }));
}

function revogarDispositivo(id) {
  const d = lerDispositivos();
  if (!d[id]) return false;
  d[id].revogado = true;
  d[id].revogadoEm = new Date().toISOString();
  gravarDispositivos(d);
  return true;
}

/* ─────────────────────────────────────────────────────────────
   Credenciais do pedido
   ───────────────────────────────────────────────────────────── */

function credenciaisValidas(req) {
  const cabecalho = req.headers.authorization || "";
  if (!cabecalho.startsWith("Basic ")) return false;

  let decodificado;
  try {
    decodificado = Buffer.from(cabecalho.slice(6), "base64").toString("utf8");
  } catch { return false; }

  const sep = decodificado.indexOf(":");
  if (sep === -1) return false;

  const utilizador = decodificado.slice(0, sep);
  const passe = decodificado.slice(sep + 1);

  try {
    return iguais(utilizador, UTILIZADOR()) && iguais(passe, PALAVRA_PASSE());
  } catch { return false; }
}

/** Token de dispositivo, por cabeçalho Bearer ou pelo mesmo cookie. */
function tokenDoPedido(req) {
  const cab = req.headers.authorization || "";
  if (cab.startsWith("Bearer ")) return cab.slice(7).trim();
  // O WebView do Android não deixa pôr cabeçalhos em todos os pedidos,
  // mas deixa pôr um cookie. Aceitar o token pelas duas vias evita ter
  // de interceptar cada pedido do lado da app.
  const c = lerCookie(req, COOKIE);
  if (c && String(c).startsWith("d.")) return c;
  return null;
}

/** Autorizado por sessão, por token de dispositivo, ou por Basic auth. */
function autorizado(req) {
  if (!configurado()) return true;
  if (sessaoValida(lerCookie(req, COOKIE))) return true;
  const t = tokenDoPedido(req);
  if (t && tokenDispositivoValido(t)) return true;
  return credenciaisValidas(req);
}

/* ─────────────────────────────────────────────────────────────
   Middleware
   ───────────────────────────────────────────────────────────── */

function middleware(req, res, next) {
  if (!configurado()) return next();

  if (sessaoValida(lerCookie(req, COOKIE))) return next();

  const token = tokenDoPedido(req);
  if (token && tokenDispositivoValido(token)) return next();

  if (credenciaisValidas(req)) {
    // HttpOnly: fora do alcance de JavaScript, incluindo de qualquer
    // coisa que um agente escreva numa plataforma do vault.
    // SameSite=Lax: impede que outro site use este cookie em pedidos
    // cruzados.
    res.setHeader("Set-Cookie",
      `${COOKIE}=${encodeURIComponent(criarSessao())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${VALIDADE_MS / 1000}`);
    return next();
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="AI Office", charset="UTF-8"');
  return res.status(401).send("Autenticação necessária.");
}

/* ─────────────────────────────────────────────────────────────
   Limitação de pedidos
   ───────────────────────────────────────────────────────────── */

const janelas = new Map();   // ip -> number[]  (timestamps)

/**
 * Janela deslizante por IP, em memória.
 *
 * Não substitui o fail2ban — um atacante com muitos IPs passa por aqui.
 * Serve para o caso realista: um script a martelar o mesmo endpoint.
 */
function limitar({ max, janelaMs, mensagem }) {
  return (req, res, next) => {
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
      || req.socket.remoteAddress || "desconhecido";
    const agora = Date.now();

    const marcas = (janelas.get(ip) || []).filter((t) => agora - t < janelaMs);

    if (marcas.length >= max) {
      const esperar = Math.ceil((janelaMs - (agora - marcas[0])) / 1000);
      res.setHeader("Retry-After", String(esperar));
      return res.status(429).json({ error: mensagem, retryAfter: esperar });
    }

    marcas.push(agora);
    janelas.set(ip, marcas);
    next();
  };
}

// A limpeza evita que o mapa cresça sem fim com IPs que passaram uma vez.
setInterval(() => {
  const agora = Date.now();
  for (const [ip, marcas] of janelas) {
    const vivas = marcas.filter((t) => agora - t < 60 * 60 * 1000);
    if (vivas.length) janelas.set(ip, vivas); else janelas.delete(ip);
  }
}, 10 * 60 * 1000).unref();

module.exports = {
  middleware, autorizado, configurado, limitar, UTILIZADOR,
  credenciaisValidas,
  criarTokenDispositivo, listarDispositivos, revogarDispositivo,
  FICHEIRO_DISPOSITIVOS,
};
