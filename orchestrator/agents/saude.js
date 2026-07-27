// Verificação de saúde dos domínios.
//
// O que estraga um alojamento raramente é dramático: é um certificado que
// expira num sábado, um domínio que deixa de resolver depois de mexerem
// no DNS, ou um site que passa a devolver 500 e ninguém repara até o
// cliente telefonar. São todos detetáveis sozinhos.
//
// Sem dependências: dns, tls e https do Node chegam.
//
// Decisão que molda tudo o resto: a ligação TLS usa
// `rejectUnauthorized: false`. Parece errado num verificador de
// segurança, mas é o contrário — se rejeitássemos certificados inválidos,
// a ligação caía antes de podermos LER o certificado, e o diagnóstico
// mais útil ("expirou há 3 dias") ficava impossível. Nós não confiamos no
// certificado: inspecionamo-lo e relatamos.

const tls = require("tls");
const https = require("https");
const http = require("http");
const dns = require("dns").promises;

const TIMEOUT = Number(process.env.HEALTH_TIMEOUT_MS) || 12000;

// Abaixo disto, o certificado passa a ser um problema a tratar. 14 dias
// dá margem para renovar sem pressa mesmo que apanhe um fim de semana.
const AVISO_DIAS = Number(process.env.SSL_AVISO_DIAS) || 14;
const URGENTE_DIAS = Number(process.env.SSL_URGENTE_DIAS) || 3;

/* ─────────────────────────────────────────────────────────────
   DNS
   ───────────────────────────────────────────────────────────── */

async function verificarDns(dominio) {
  try {
    const [a, aaaa] = await Promise.all([
      dns.resolve4(dominio).catch(() => []),
      dns.resolve6(dominio).catch(() => []),
    ]);
    if (!a.length && !aaaa.length) {
      return { ok: false, erro: "O domínio não resolve para nenhum IP." };
    }
    return { ok: true, ipv4: a, ipv6: aaaa };
  } catch (e) {
    return { ok: false, erro: e.code === "ENOTFOUND" ? "Domínio inexistente ou sem registos." : e.message };
  }
}

/** Servidores de email: útil para saber se o cliente perdeu o correio. */
async function verificarMx(dominio) {
  try {
    const mx = await dns.resolveMx(dominio);
    return { ok: mx.length > 0, servidores: mx.map((m) => m.exchange) };
  } catch {
    return { ok: false, servidores: [] };
  }
}

/* ─────────────────────────────────────────────────────────────
   Certificado
   ───────────────────────────────────────────────────────────── */

function verificarCertificado(dominio) {
  return new Promise((resolve) => {
    let respondido = false;
    const acabar = (r) => { if (!respondido) { respondido = true; resolve(r); } };

    const socket = tls.connect({
      host: dominio,
      port: 443,
      servername: dominio,          // SNI: sem isto vem o certificado errado
      // Ver acima: precisamos de LER certificados inválidos para os poder
      // diagnosticar. A validação é feita por nós, a seguir.
      rejectUnauthorized: false,
      timeout: TIMEOUT,
    }, () => {
      const cert = socket.getPeerCertificate();
      const autorizado = socket.authorized;
      const motivo = socket.authorizationError;
      socket.end();

      if (!cert || !cert.valid_to) {
        return acabar({ ok: false, erro: "O servidor não apresentou certificado." });
      }

      const expira = new Date(cert.valid_to);
      const dias = Math.floor((expira - Date.now()) / 86400000);

      // Nomes cobertos: o SAN é o que conta hoje, o CN é herança.
      const nomes = (cert.subjectaltname || "")
        .split(",").map((s) => s.trim().replace(/^DNS:/, "")).filter(Boolean);

      acabar({
        ok: autorizado && dias > 0,
        valido: autorizado,
        motivoInvalido: autorizado ? null : String(motivo || ""),
        emissor: cert.issuer?.O || cert.issuer?.CN || "desconhecido",
        expiraEm: expira.toISOString().slice(0, 10),
        diasParaExpirar: dias,
        nomes,
        // O certificado pode ser válido e não cobrir este domínio — caso
        // clássico de quem aponta um domínio novo para um site existente.
        cobreDominio: nomes.some((n) =>
          n === dominio || (n.startsWith("*.") && dominio.endsWith(n.slice(1)))),
        estado: dias <= 0 ? "expirado"
          : dias <= URGENTE_DIAS ? "urgente"
          : dias <= AVISO_DIAS ? "a-expirar"
          : autorizado ? "bom" : "invalido",
      });
    });

    socket.on("timeout", () => { socket.destroy(); acabar({ ok: false, erro: "Sem resposta na porta 443." }); });
    socket.on("error", (e) => {
      acabar({
        ok: false,
        erro: e.code === "ECONNREFUSED" ? "A porta 443 está fechada (sem HTTPS)."
          : e.code === "ENOTFOUND" ? "O domínio não resolve."
          : e.message,
      });
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   HTTP
   ───────────────────────────────────────────────────────────── */

function pedirHttp(url, seguirRedirecionamentos = 3) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    let alvo;
    try { alvo = new URL(url); } catch { return resolve({ ok: false, erro: "URL inválido." }); }

    const mod = alvo.protocol === "https:" ? https : http;
    const req = mod.request({
      hostname: alvo.hostname,
      port: alvo.port || (alvo.protocol === "https:" ? 443 : 80),
      path: alvo.pathname + alvo.search,
      method: "GET",
      timeout: TIMEOUT,
      rejectUnauthorized: false,     // o certificado é avaliado à parte
      headers: {
        // Identificar-se: um user-agent vazio é bloqueado por muitas
        // firewalls e daria falsos alarmes.
        "User-Agent": "DAISY-HealthCheck/1.0 (monitorizacao propria)",
        "Accept": "text/html,*/*",
      },
    }, (res) => {
      const ms = Date.now() - inicio;
      const codigo = res.statusCode;
      const destino = res.headers.location;

      // Não precisamos do corpo, só dos cabeçalhos. Descartar poupa tempo
      // e memória em sites grandes.
      res.resume();

      if (codigo >= 300 && codigo < 400 && destino && seguirRedirecionamentos > 0) {
        const proximo = new URL(destino, url).toString();
        return resolve(pedirHttp(proximo, seguirRedirecionamentos - 1)
          .then((r) => ({ ...r, redirecionadoDe: url, redirecionadoPara: proximo })));
      }

      resolve({
        ok: codigo >= 200 && codigo < 400,
        codigo, ms,
        servidor: res.headers.server || null,
        // Cabeçalho de segurança básico: sinaliza quem já pensou nisto.
        hsts: !!res.headers["strict-transport-security"],
        urlFinal: url,
      });
    });

    req.on("timeout", () => { req.destroy(); resolve({ ok: false, erro: `Sem resposta em ${TIMEOUT / 1000}s.` }); });
    req.on("error", (e) => resolve({
      ok: false,
      erro: e.code === "ECONNREFUSED" ? "Ligação recusada."
        : e.code === "ENOTFOUND" ? "O domínio não resolve."
        : e.code === "ECONNRESET" ? "A ligação foi cortada pelo servidor."
        : e.message,
    }));
    req.end();
  });
}

/* ─────────────────────────────────────────────────────────────
   Verificação completa
   ───────────────────────────────────────────────────────────── */

/**
 * Estado global de um domínio.
 * Regra: o pior componente decide. Um site que responde 200 com o
 * certificado expirado não está "bom" — o visitante vê um aviso a
 * vermelho antes de chegar ao site.
 */
function classificar({ dns: d, https: h, cert }) {
  if (!d.ok) return { nivel: "critico", resumo: "Não resolve" };
  if (cert?.estado === "expirado") return { nivel: "critico", resumo: "Certificado expirado" };
  if (!h?.ok && h?.erro) return { nivel: "critico", resumo: h.erro };
  if (h?.codigo >= 500) return { nivel: "critico", resumo: `Erro ${h.codigo} no servidor` };

  if (cert?.estado === "urgente") return { nivel: "aviso", resumo: `Certificado expira em ${cert.diasParaExpirar} dias` };
  if (cert?.estado === "a-expirar") return { nivel: "aviso", resumo: `Certificado expira em ${cert.diasParaExpirar} dias` };
  if (cert && !cert.cobreDominio && cert.ok) return { nivel: "aviso", resumo: "O certificado não cobre este domínio" };
  if (cert?.estado === "invalido") return { nivel: "aviso", resumo: "Certificado inválido" };
  if (h?.codigo >= 400) return { nivel: "aviso", resumo: `Devolve ${h.codigo}` };
  if (h?.ms > 3000) return { nivel: "aviso", resumo: `Lento (${(h.ms / 1000).toFixed(1)}s)` };

  return { nivel: "bom", resumo: "Tudo em ordem" };
}

async function verificar(dominio) {
  const nome = String(dominio).trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!nome) return { dominio, erro: "Domínio vazio." };

  const inicio = Date.now();
  const d = await verificarDns(nome);

  // Sem DNS, o resto é impossível — não vale a pena esperar por timeouts
  // que já sabemos que vão falhar.
  if (!d.ok) {
    return {
      dominio: nome, dns: d, https: null, http: null, cert: null, mx: null,
      estado: { nivel: "critico", resumo: d.erro },
      verificadoEm: new Date().toISOString(), duracaoMs: Date.now() - inicio,
    };
  }

  // Em paralelo: são pedidos independentes e a espera domina o tempo.
  const [cert, sHttps, sHttp, mx] = await Promise.all([
    verificarCertificado(nome),
    pedirHttp(`https://${nome}/`),
    pedirHttp(`http://${nome}/`, 0),   // sem seguir: queremos ver se redireciona
    verificarMx(nome),
  ]);

  const estado = classificar({ dns: d, https: sHttps, cert });

  return {
    dominio: nome,
    dns: d,
    cert,
    https: sHttps,
    http: {
      ...sHttp,
      // Boa prática: HTTP deve mandar o visitante para HTTPS.
      redirecionaParaHttps: sHttp.codigo >= 300 && sHttp.codigo < 400
        && String(sHttp.redirecionadoPara || "").startsWith("https://"),
    },
    mx,
    estado,
    verificadoEm: new Date().toISOString(),
    duracaoMs: Date.now() - inicio,
  };
}

/**
 * Verifica vários domínios com concorrência limitada.
 * Sem limite, 40 domínios abrem 160 ligações de uma vez e a própria VPS
 * torna-se o estrangulamento — os tempos medidos deixariam de significar
 * nada.
 */
async function verificarVarios(dominios, concorrencia = 5) {
  const fila = [...dominios];
  const resultados = [];

  const trabalhador = async () => {
    while (fila.length) {
      const d = fila.shift();
      try { resultados.push(await verificar(d)); }
      catch (e) {
        resultados.push({
          dominio: d, erro: e.message,
          estado: { nivel: "critico", resumo: e.message },
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concorrencia, dominios.length) }, trabalhador));

  const ordem = { critico: 0, aviso: 1, bom: 2 };
  resultados.sort((a, b) =>
    (ordem[a.estado?.nivel] ?? 3) - (ordem[b.estado?.nivel] ?? 3)
    || a.dominio.localeCompare(b.dominio));

  return {
    resultados,
    resumo: {
      total: resultados.length,
      criticos: resultados.filter((r) => r.estado?.nivel === "critico").length,
      avisos: resultados.filter((r) => r.estado?.nivel === "aviso").length,
      bons: resultados.filter((r) => r.estado?.nivel === "bom").length,
      certificadosAExpirar: resultados.filter((r) =>
        r.cert?.diasParaExpirar != null && r.cert.diasParaExpirar <= AVISO_DIAS).length,
    },
  };
}

module.exports = { verificar, verificarVarios, AVISO_DIAS, URGENTE_DIAS };
