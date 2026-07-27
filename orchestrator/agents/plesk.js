// Ligação ao Plesk da Hetzner.
//
// DELIBERADAMENTE OPCIONAL. O Plesk sabe que domínios existem e onde
// estão alojados; não sabe quanto cobras nem se te pagaram. Se ligássemos
// a faturação à disponibilidade desta API, uma atualização do Plesk ou
// uma migração de site levariam consigo o teu histórico de cobranças.
//
// Aqui ele serve só para enriquecer: "este cliente tem estes domínios".
// Falha a ligação, a faturação continua a funcionar na mesma.
//
// Configuração no .env da D.A.I.S.Y.:
//   PLESK_URL=https://o-teu-servidor.hetzner:8443
//   PLESK_API_KEY=<chave>
//
// COMO GERAR A CHAVE — e o pormenor que faz perder uma tarde: a chave
// fica vinculada ao IP de onde foi pedida. Gera-a A PARTIR DA CONTABO,
// por SSH, não do teu PC, senão dá 401 sempre:
//
//   curl -k -X POST -u admin:PASSWORD -H "Content-Type: application/json" \
//     -d '{}' https://SERVIDOR:8443/api/v2/auth/keys

const https = require("https");
const { URL } = require("url");

const BASE = () => (process.env.PLESK_URL || "").replace(/\/+$/, "");
const CHAVE = () => process.env.PLESK_API_KEY || "";

// Muitas instalações Plesk usam certificado auto-assinado. Node recusa-o
// por omissão, e bem. Só se ignora com decisão explícita — e o aviso
// aparece no arranque para não passar despercebido.
const IGNORAR_CERT = process.env.PLESK_IGNORAR_CERT === "1";

const configurado = () => !!(BASE() && CHAVE());

const CACHE_MS = Number(process.env.PLESK_CACHE_MS) || 10 * 60 * 1000;
let cache = { em: 0, dominios: null };

function pedir(caminho) {
  return new Promise((resolve, reject) => {
    if (!configurado()) return reject(new Error("Plesk não configurado (PLESK_URL / PLESK_API_KEY)."));

    let url;
    try { url = new URL(BASE() + caminho); }
    catch { return reject(new Error(`PLESK_URL inválido: ${BASE()}`)); }

    const req = https.request({
      hostname: url.hostname,
      port: url.port || 8443,
      path: url.pathname + url.search,
      method: "GET",
      timeout: 15000,
      rejectUnauthorized: !IGNORAR_CERT,
      headers: {
        "X-API-Key": CHAVE(),
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
    }, (res) => {
      let corpo = "";
      res.on("data", (c) => { corpo += c; });
      res.on("end", () => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          return reject(new Error(
            `O Plesk recusou a chave (${res.statusCode}). A causa mais comum é a ` +
            `chave estar vinculada a outro IP: gera-a a partir DESTA máquina, ` +
            `não do teu PC.`
          ));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Plesk ${caminho} → ${res.statusCode}: ${corpo.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(corpo)); }
        catch { reject(new Error("O Plesk devolveu uma resposta que não é JSON.")); }
      });
    });

    req.on("timeout", () => { req.destroy(); reject(new Error("O Plesk não respondeu em 15 segundos.")); });
    req.on("error", (e) => {
      if (e.code === "DEPTH_ZERO_SELF_SIGNED_CERT" || e.code === "SELF_SIGNED_CERT_IN_CHAIN") {
        return reject(new Error(
          "O Plesk usa um certificado auto-assinado. Instala um certificado " +
          "válido (Let's Encrypt no próprio Plesk) ou, se aceitares o risco " +
          "numa rede em que confies, põe PLESK_IGNORAR_CERT=1 no .env."
        ));
      }
      reject(new Error(`Não consegui contactar o Plesk: ${e.message}`));
    });
    req.end();
  });
}

/** Domínios alojados. Em cache: não vale a pena martelar o painel. */
async function dominios({ forcar = false } = {}) {
  if (!forcar && cache.dominios && Date.now() - cache.em < CACHE_MS) {
    return { dominios: cache.dominios, deCache: true };
  }
  const lista = await pedir("/api/v2/domains");
  cache = { em: Date.now(), dominios: lista };
  return { dominios: lista, deCache: false };
}

async function clientes() {
  return pedir("/api/v2/clients");
}

/**
 * Cruza os teus clientes com os domínios do Plesk.
 *
 * A correspondência é pelos domínios que TU associaste ao cliente na
 * faturação — não por nomes parecidos. Adivinhar ligações entre nomes de
 * cliente e nomes de domínio daria falsos positivos, e em faturação um
 * falso positivo é cobrar a pessoa errada.
 */
async function cruzar(clientesFaturacao) {
  const { dominios: lista, deCache } = await dominios();

  const porNome = new Map();
  for (const d of lista) porNome.set(String(d.name || "").toLowerCase(), d);

  const usados = new Set();
  const resultado = clientesFaturacao.map((c) => {
    const encontrados = (c.dominios || []).map((nome) => {
      const chave = String(nome).toLowerCase().trim();
      const d = porNome.get(chave);
      if (d) usados.add(chave);
      return d
        ? { nome: d.name, id: d.id, criado: d.created, tipo: d.hosting_type, noPlesk: true }
        : { nome, noPlesk: false };
    });
    return { clienteId: c.id, dominios: encontrados };
  });

  // Domínios alojados que não estão atribuídos a cliente nenhum. É a
  // pergunta útil: estarás a alojar sites que não estás a cobrar?
  const orfaos = lista
    .filter((d) => !usados.has(String(d.name || "").toLowerCase()))
    .map((d) => ({ nome: d.name, id: d.id, criado: d.created, tipo: d.hosting_type }));

  return { porCliente: resultado, orfaos, totalNoPlesk: lista.length, deCache };
}

async function testar() {
  if (!configurado()) {
    return { ok: false, erro: "PLESK_URL e PLESK_API_KEY não estão definidos no .env." };
  }
  try {
    const lista = await pedir("/api/v2/domains");
    return { ok: true, dominios: lista.length, url: BASE() };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

module.exports = { configurado, dominios, clientes, cruzar, testar, IGNORAR_CERT };
