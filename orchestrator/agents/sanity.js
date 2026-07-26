// Provisiona um projeto Sanity por cada plataforma construída.
//
// O problema de arranque: criar um projeto Sanity exige uma identidade
// autenticada, e isso não se automatiza. Mas só é preciso UMA vez — a
// partir daí, cada plataforma nova recebe projeto, dataset e token
// próprios sem ninguém tocar em nada.
//
// Configuração única na VPS:
//   SANITY_AUTH_TOKEN=<token pessoal com papel Administrator ou Developer>
//
// Endpoints confirmados na referência da API de projetos (v2021-06-07):
//   POST   /projects                              criar projeto
//   PUT    /projects/{id}/datasets/{nome}         criar dataset
//   POST   /projects/{id}/tokens                  criar token do projeto
//   POST   /projects/{id}/cors                    registar origem CORS

const API = "https://api.sanity.io/v2021-06-07";

// O token pessoal SÓ é usado para provisionar. Nunca entra no scaffold,
// nunca é passado a um agente e nunca chega ao repositório do projeto:
// dá acesso completo à conta, ao contrário do token por projeto.
const tokenPessoal = () => process.env.SANITY_AUTH_TOKEN || "";

// Origens que o Studio precisa de ter autorizadas para falar com a API.
// Sem isto o Studio abre e fica preso no login, sem erro visível.
function origens() {
  const lista = (process.env.SANITY_CORS_ORIGINS || "")
    .split(",").map((o) => o.trim()).filter(Boolean);
  if (process.env.PUBLIC_ORIGIN) lista.push(process.env.PUBLIC_ORIGIN);
  lista.push("http://localhost:3000");
  return [...new Set(lista)];
}

function disponivel() {
  return !!tokenPessoal();
}

async function chamar(metodo, caminho, corpo) {
  const r = await fetch(API + caminho, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${tokenPessoal()}`,
      "Content-Type": "application/json",
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

  const texto = await r.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { /* resposta não-JSON */ }

  if (!r.ok) {
    // 401 é o caso mais provável e o mais confuso de diagnosticar: desde
    // junho de 2026 os tokens do Sanity podem ter validade, e um token
    // expirado é rejeitado sem hipótese de reativação. Vale a pena dizê-lo
    // aqui em vez de deixar "401" sozinho no ecrã.
    const detalhe = dados?.message || texto.slice(0, 200) || r.statusText;
    if (r.status === 401 || r.status === 403) {
      throw new Error(
        `Sanity recusou o pedido (${r.status}): ${detalhe}\n` +
        `O SANITY_AUTH_TOKEN pode ter expirado, ou não tem papel de ` +
        `Administrator/Developer. Gera outro e reinicia com --update-env.`
      );
    }
    throw new Error(`Sanity ${metodo} ${caminho} → ${r.status}: ${detalhe}`);
  }
  return dados;
}

/**
 * Cria projeto + dataset + token de leitura + origens CORS.
 * @param {string} nome  nome legível da plataforma
 * @returns {Promise<{projectId:string, dataset:string, readToken:string, avisos:string[]}>}
 */
async function provisionar(nome, log = () => {}) {
  if (!disponivel()) {
    throw new Error(
      "SANITY_AUTH_TOKEN não está definido. Sem ele não é possível criar " +
      "projetos Sanity automaticamente."
    );
  }

  const avisos = [];
  const dataset = process.env.SANITY_DATASET || "production";

  log(`[sanity] a criar projeto "${nome}"\n`);
  const projeto = await chamar("POST", "/projects", { displayName: nome.slice(0, 80) });
  const projectId = projeto?.id;
  if (!projectId) throw new Error("O Sanity criou o projeto mas não devolveu id.");
  log(`[sanity] projeto ${projectId}\n`);

  // Dataset público: o front-end lê conteúdo publicado sem token nenhum,
  // o que evita ter de expor segredos no browser. Rascunhos continuam
  // protegidos — para esses é preciso token.
  log(`[sanity] a criar dataset "${dataset}" (público)\n`);
  await chamar("PUT", `/projects/${projectId}/datasets/${dataset}`, { aclMode: "public" });

  // Token do PROJETO, com papel de leitura apenas. Num plano gratuito os
  // papéis possíveis são viewer, editor e deploy-studio; viewer chega para
  // ler rascunhos em pré-visualização e não permite estragar conteúdo.
  let readToken = "";
  try {
    const t = await chamar("POST", `/projects/${projectId}/tokens`, {
      label: `ai-office ${new Date().toISOString().slice(0, 10)}`,
      roleName: "viewer",
    });
    readToken = t?.key || "";
    log(`[sanity] token de leitura criado\n`);
  } catch (e) {
    // Não é fatal: com dataset público a plataforma lê na mesma.
    avisos.push(`Não consegui criar token de leitura: ${e.message}`);
  }

  for (const origem of origens()) {
    try {
      // allowCredentials é obrigatório para o Studio conseguir autenticar
      await chamar("POST", `/projects/${projectId}/cors`, { origin: origem, allowCredentials: true });
      log(`[sanity] CORS: ${origem}\n`);
    } catch (e) {
      avisos.push(`CORS ${origem}: ${e.message}`);
    }
  }

  return { projectId, dataset, readToken, avisos };
}

/** Regista uma origem depois do provisionamento (ex.: porta do preview). */
async function autorizarOrigem(projectId, origem) {
  return chamar("POST", `/projects/${projectId}/cors`, { origin: origem, allowCredentials: true });
}

module.exports = { disponivel, provisionar, autorizarOrigem, origens, API };
