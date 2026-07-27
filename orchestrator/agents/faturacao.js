// Gestor de mensalidades.
//
// Isto é contabilidade real, por isso três decisões antes de mais nada:
//
//   1. VALORES EM CÊNTIMOS, sempre inteiros. 49,90 € é 4990. Vírgula
//      flutuante em dinheiro dá diferenças que só aparecem no fecho do
//      ano — foi a armadilha do divisor de contas, e aqui custava a
//      sério.
//   2. Os dados são NOSSOS. O Plesk sabe que domínios existem; não sabe
//      quanto cobras nem se já pagaram. Se a ligação ao Plesk falhar,
//      continuas a saber quem te deve dinheiro.
//   3. Um pagamento registado NUNCA é apagado, só anulado. Um histórico
//      que se pode reescrever não serve de prova de nada.
//
// Menos de 10 clientes: um ficheiro JSON chega, é fácil de copiar para
// segurança e lê-se com os olhos quando alguma coisa correr mal.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FICHEIRO = process.env.FATURACAO_FILE
  || path.join(__dirname, "..", "..", "faturacao.json");

/* ─────────────────────────────────────────────────────────────
   Persistência
   ───────────────────────────────────────────────────────────── */

function ler() {
  try {
    return JSON.parse(fs.readFileSync(FICHEIRO, "utf8"));
  } catch {
    return { clientes: [], pagamentos: [] };
  }
}

function gravar(dados) {
  // Cópia do ficheiro anterior antes de escrever. São dados de
  // faturação: uma escrita má sem rede de segurança é perder o
  // histórico todo.
  try {
    if (fs.existsSync(FICHEIRO)) fs.copyFileSync(FICHEIRO, FICHEIRO + ".bak");
  } catch { /* sem cópia, seguimos: melhor gravar do que perder o novo */ }

  const temp = FICHEIRO + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(dados, null, 2));
  fs.renameSync(temp, FICHEIRO);
}

const id = () => crypto.randomBytes(6).toString("base64url");

/* ─────────────────────────────────────────────────────────────
   Datas
   ───────────────────────────────────────────────────────────── */

const hoje = () => new Date().toISOString().slice(0, 10);

/** "2026-07" a partir de uma data ISO. É a unidade de cobrança. */
const mesDe = (iso) => String(iso).slice(0, 7);

/**
 * Avança N meses a partir de um mês, devolvendo "AAAA-MM".
 * Feito com aritmética de inteiros e não com Date: somar meses a um
 * objeto Date faz 31 de janeiro + 1 mês = 3 de março, porque 31 de
 * fevereiro não existe e o JavaScript transborda em silêncio.
 */
function somarMeses(mes, n) {
  const [a, m] = String(mes).split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Diferença em meses. Positiva se b for posterior a a. */
function mesesEntre(a, b) {
  const [aa, am] = String(a).split("-").map(Number);
  const [ba, bm] = String(b).split("-").map(Number);
  return (ba * 12 + bm) - (aa * 12 + am);
}

/**
 * Data de vencimento de um mês, respeitando o dia acordado.
 * Se o cliente paga a 31 e o mês tem 30 dias, vence no último dia — não
 * transborda para o mês seguinte.
 */
function vencimento(mes, diaAcordado) {
  const [a, m] = String(mes).split("-").map(Number);
  const ultimoDia = new Date(a, m, 0).getDate();
  const dia = Math.min(Math.max(1, diaAcordado || 1), ultimoDia);
  return `${mes}-${String(dia).padStart(2, "0")}`;
}

/* ─────────────────────────────────────────────────────────────
   Clientes
   ───────────────────────────────────────────────────────────── */

const PERIODOS = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };

function validarCliente(c) {
  if (!c.nome || !String(c.nome).trim()) throw new Error("O nome é obrigatório.");

  const valor = Number(c.valorCentimos);
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new Error("O valor tem de ser um número inteiro de cêntimos maior que zero (49,90 € = 4990).");
  }
  if (!PERIODOS[c.periodicidade || "mensal"]) {
    throw new Error(`Periodicidade inválida. Opções: ${Object.keys(PERIODOS).join(", ")}`);
  }
  const inicio = c.mesInicio || mesDe(hoje());
  if (!/^\d{4}-\d{2}$/.test(inicio)) throw new Error("mesInicio tem de ser AAAA-MM.");
}

function adicionarCliente(c) {
  validarCliente(c);
  const dados = ler();

  const cliente = {
    id: id(),
    nome: String(c.nome).trim(),
    email: (c.email || "").trim(),
    nif: (c.nif || "").trim(),
    valorCentimos: Number(c.valorCentimos),
    periodicidade: c.periodicidade || "mensal",
    diaVencimento: Number(c.diaVencimento) || 1,
    mesInicio: c.mesInicio || mesDe(hoje()),
    // Domínios que este cliente tem contigo. Serve para cruzar com o
    // Plesk: o Plesk não sabe quem paga, nós é que ligamos as duas coisas.
    dominios: Array.isArray(c.dominios) ? c.dominios : [],
    notas: (c.notas || "").trim(),
    ativo: true,
    criado: new Date().toISOString(),
  };

  dados.clientes.push(cliente);
  gravar(dados);
  return cliente;
}

function editarCliente(idCliente, alteracoes) {
  const dados = ler();
  const c = dados.clientes.find((x) => x.id === idCliente);
  if (!c) throw new Error("Cliente não encontrado.");

  const proposto = { ...c, ...alteracoes, id: c.id };
  validarCliente(proposto);

  Object.assign(c, proposto);
  c.atualizado = new Date().toISOString();
  gravar(dados);
  return c;
}

/**
 * Desativar, não apagar. Um cliente que sai leva consigo o histórico de
 * pagamentos; apagá-lo faria desaparecer receita já recebida das contas.
 */
function desativarCliente(idCliente) {
  const dados = ler();
  const c = dados.clientes.find((x) => x.id === idCliente);
  if (!c) throw new Error("Cliente não encontrado.");
  c.ativo = false;
  c.desativado = new Date().toISOString();
  gravar(dados);
  return c;
}

/* ─────────────────────────────────────────────────────────────
   Pagamentos
   ───────────────────────────────────────────────────────────── */

function registarPagamento(p) {
  const dados = ler();
  const cliente = dados.clientes.find((x) => x.id === p.clienteId);
  if (!cliente) throw new Error("Cliente não encontrado.");

  const mes = p.mes || mesDe(hoje());
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error("O mês tem de ser AAAA-MM.");

  const valor = Number(p.valorCentimos ?? cliente.valorCentimos);
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new Error("O valor tem de ser um inteiro de cêntimos maior que zero.");
  }

  // Avisar em vez de recusar: pode haver um pagamento em duas partes, ou
  // um acerto. Quem decide és tu; o sistema limita-se a assinalar.
  const jaExiste = dados.pagamentos.some(
    (x) => x.clienteId === p.clienteId && x.mes === mes && !x.anulado
  );

  const pagamento = {
    id: id(),
    clienteId: p.clienteId,
    mes,
    valorCentimos: valor,
    data: p.data || hoje(),
    metodo: p.metodo || "transferencia",
    referencia: (p.referencia || "").trim(),
    notas: (p.notas || "").trim(),
    anulado: false,
    registado: new Date().toISOString(),
  };

  dados.pagamentos.push(pagamento);
  gravar(dados);
  return { pagamento, avisoDuplicado: jaExiste };
}

/** Anular, nunca apagar: o histórico tem de continuar auditável. */
function anularPagamento(idPagamento, motivo) {
  const dados = ler();
  const p = dados.pagamentos.find((x) => x.id === idPagamento);
  if (!p) throw new Error("Pagamento não encontrado.");
  p.anulado = true;
  p.motivoAnulacao = (motivo || "").trim();
  p.anuladoEm = new Date().toISOString();
  gravar(dados);
  return p;
}

/* ─────────────────────────────────────────────────────────────
   O que interessa: quem está a dever
   ───────────────────────────────────────────────────────────── */

/**
 * Meses que um cliente já devia ter pago, do início até ao mês atual.
 * Respeita a periodicidade: um cliente trimestral só deve de 3 em 3.
 */
function mesesDevidos(cliente, ate = mesDe(hoje())) {
  const passo = PERIODOS[cliente.periodicidade] || 1;
  const total = mesesEntre(cliente.mesInicio, ate);
  if (total < 0) return [];

  const meses = [];
  for (let i = 0; i <= total; i += passo) meses.push(somarMeses(cliente.mesInicio, i));
  return meses;
}

/**
 * Estado de cada cliente: o que devia ter pago, o que pagou, o que falta.
 * É esta função que responde à pergunta "quem me deve dinheiro?".
 */
function estado(ate = mesDe(hoje())) {
  const dados = ler();
  const agora = hoje();

  const linhas = dados.clientes
    .filter((c) => c.ativo)
    .map((c) => {
      const devidos = mesesDevidos(c, ate);

      const pagosPorMes = new Map();
      for (const p of dados.pagamentos) {
        if (p.clienteId !== c.id || p.anulado) continue;
        pagosPorMes.set(p.mes, (pagosPorMes.get(p.mes) || 0) + p.valorCentimos);
      }

      const emFalta = devidos
        .map((mes) => {
          const pago = pagosPorMes.get(mes) || 0;
          const falta = c.valorCentimos - pago;
          if (falta <= 0) return null;
          const vence = vencimento(mes, c.diaVencimento);
          return {
            mes, vence,
            faltaCentimos: falta,
            pagoCentimos: pago,
            // Só está em atraso depois de a data de vencimento passar.
            // O mês corrente antes do dia acordado não é dívida.
            atrasado: vence < agora,
            diasAtraso: vence < agora
              ? Math.floor((new Date(agora) - new Date(vence)) / 86400000)
              : 0,
          };
        })
        .filter(Boolean);

      const totalEmFalta = emFalta.reduce((s, m) => s + m.faltaCentimos, 0);
      const totalAtrasado = emFalta.filter((m) => m.atrasado)
        .reduce((s, m) => s + m.faltaCentimos, 0);

      return {
        cliente: {
          id: c.id, nome: c.nome, email: c.email,
          valorCentimos: c.valorCentimos, periodicidade: c.periodicidade,
          diaVencimento: c.diaVencimento, dominios: c.dominios,
        },
        emFalta,
        totalEmFaltaCentimos: totalEmFalta,
        totalAtrasadoCentimos: totalAtrasado,
        emDia: totalEmFalta === 0,
        proximoVencimento: vencimento(somarMeses(ate, 1), c.diaVencimento),
      };
    });

  // Quem está em atraso há mais tempo aparece primeiro: é a ordem por
  // que se trata do assunto.
  linhas.sort((a, b) => b.totalAtrasadoCentimos - a.totalAtrasadoCentimos
    || b.totalEmFaltaCentimos - a.totalEmFaltaCentimos);

  const recebidoNoMes = dados.pagamentos
    .filter((p) => !p.anulado && mesDe(p.data) === mesDe(agora))
    .reduce((s, p) => s + p.valorCentimos, 0);

  return {
    mes: ate,
    linhas,
    resumo: {
      clientesAtivos: linhas.length,
      emDia: linhas.filter((l) => l.emDia).length,
      comAtraso: linhas.filter((l) => l.totalAtrasadoCentimos > 0).length,
      totalEmFaltaCentimos: linhas.reduce((s, l) => s + l.totalEmFaltaCentimos, 0),
      totalAtrasadoCentimos: linhas.reduce((s, l) => s + l.totalAtrasadoCentimos, 0),
      recebidoEsteMesCentimos: recebidoNoMes,
      // Receita esperada por mês, normalizada: um cliente anual conta
      // 1/12 do valor, senão a previsão salta de mês para mês.
      previstoMensalCentimos: linhas.reduce((s, l) =>
        s + Math.round(l.cliente.valorCentimos / (PERIODOS[l.cliente.periodicidade] || 1)), 0),
    },
  };
}

/** Histórico de um cliente, do mais recente para trás. */
function historico(idCliente) {
  const dados = ler();
  const c = dados.clientes.find((x) => x.id === idCliente);
  if (!c) throw new Error("Cliente não encontrado.");
  return {
    cliente: c,
    pagamentos: dados.pagamentos
      .filter((p) => p.clienteId === idCliente)
      .sort((a, b) => b.mes.localeCompare(a.mes)),
  };
}

const euros = (centimos) =>
  (centimos / 100).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });

module.exports = {
  ler, listarClientes: () => ler().clientes,
  adicionarCliente, editarCliente, desativarCliente,
  registarPagamento, anularPagamento,
  estado, historico, mesesDevidos,
  somarMeses, mesesEntre, vencimento, euros,
  PERIODOS, FICHEIRO,
};
