// Carrega segredos de um .env na raiz do projeto, fora do git.
//
// Existe para que chaves (Stripe, Sanity) cheguem à VPS por scp ou por um
// editor, e nunca por uma conversa, um commit ou um zip. O ficheiro está
// no .gitignore desde sempre; só faltava alguém lê-lo.
//
// Sem dependências de propósito: são vinte linhas e evita acrescentar um
// pacote ao caminho crítico do arranque.

const fs = require("fs");
const path = require("path");

const FICHEIRO = process.env.ENV_FILE || path.join(__dirname, "..", "..", ".env");

function carregar(caminho = FICHEIRO) {
  let bruto;
  try {
    bruto = fs.readFileSync(caminho, "utf8");
  } catch {
    return { carregadas: 0, ficheiro: caminho, existe: false };
  }

  let carregadas = 0;
  for (const linha of bruto.split("\n")) {
    const l = linha.trim();
    if (!l || l.startsWith("#")) continue;

    const igual = l.indexOf("=");
    if (igual === -1) continue;

    const chave = l.slice(0, igual).trim();
    let valor = l.slice(igual + 1).trim();

    // aspas à volta do valor são delimitadores, não conteúdo
    if ((valor.startsWith('"') && valor.endsWith('"')) ||
        (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }

    // O ambiente real ganha sempre. Quem exportou uma variável à mão para
    // testar alguma coisa não quer que um ficheiro a substitua em silêncio.
    if (chave && process.env[chave] === undefined) {
      process.env[chave] = valor;
      carregadas++;
    }
  }
  return { carregadas, ficheiro: caminho, existe: true };
}

/**
 * Que segredos existem — sem NUNCA revelar valores.
 * Serve para o painel poder dizer "falta a chave do Stripe" sem a mostrar.
 */
function estado(nomes) {
  return Object.fromEntries(nomes.map((n) => [n, !!process.env[n]]));
}

module.exports = { carregar, estado, FICHEIRO };
