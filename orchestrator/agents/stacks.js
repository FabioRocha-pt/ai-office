// Que tipo de plataforma a equipa vai construir.
//
// Até aqui o CTO inventava a arquitetura de cada vez. Com HTML puro isso
// resultava; com frameworks dá projetos incoerentes — cada corrida
// escolhia outra estrutura, outra versão, outro sítio para as coisas.
//
// Agora há um catálogo fechado. O CTO ESCOLHE em vez de inventar, o
// scaffold é copiado antes de o Designer começar, e toda a gente trabalha
// dentro de uma estrutura que já existe.
//
// Para acrescentar uma stack nova não é preciso mexer no pipeline: basta
// uma entrada aqui com os seus ficheiros, comandos e forma de entrega.

const fs = require("fs");
const path = require("path");

/* ─────────────────────────────────────────────────────────────
   Ficheiros comuns aos scaffolds Next.js
   ───────────────────────────────────────────────────────────── */

const TAILWIND_CFG = `/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: { extend: {} },
  plugins: [],
};
`;

const POSTCSS_CFG = `export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
`;

const GLOBALS_CSS = `@tailwind base;
@tailwind components;
@tailwind utilities;
`;

const LAYOUT = `import "./globals.css";

export const metadata = {
  title: "Plataforma",
  description: "Construída pela equipa.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-PT">
      <body>{children}</body>
    </html>
  );
}
`;

const GITIGNORE = `node_modules/
.next/
out/
.env
.env.local
`;

// Versões fixadas de propósito. Um scaffold com "latest" muda debaixo dos
// pés e um dia deixa de compilar sem ninguém ter tocado em nada.
// Tailwind fica no 3.x porque o 4 mudou a configuração por completo e
// deixaria de bater certo com o tailwind.config abaixo.
const deps = (extra = {}) => ({
  next: "^14.2.0",
  react: "^18.3.0",
  "react-dom": "^18.3.0",
  ...extra,
});

const devDeps = {
  tailwindcss: "^3.4.0",
  postcss: "^8.4.0",
  autoprefixer: "^10.4.0",
};

const pkg = (nome, { scripts, dependencies }) => JSON.stringify({
  name: nome,
  private: true,
  type: "module",
  scripts,
  dependencies,
  devDependencies: devDeps,
}, null, 2) + "\n";

/* ─────────────────────────────────────────────────────────────
   Catálogo
   ───────────────────────────────────────────────────────────── */

const STACKS = {
  /* ── o que sempre existiu ─────────────────────────────────── */
  estatico: {
    id: "estatico",
    label: "HTML/CSS/JS",
    resumo: "Sem build, sem dependências. Abre direto no browser.",
    quando: "Ferramentas, calculadoras, protótipos, qualquer coisa que caiba numa página. É a escolha por omissão: só sai daqui quem tiver razão para isso.",
    entrada: "index.html na raiz",
    build: null,              // nada a compilar
    ficheiros: {},            // nada a copiar: o Developer escreve de raiz
  },

  /* ── Next.js exportado para estático ──────────────────────── */
  "nextjs-export": {
    id: "nextjs-export",
    label: "Next.js (exportado)",
    resumo: "React + Tailwind, exportado para HTML estático em out/.",
    quando: "Sites de marketing, portefólios, landing pages, documentação — tudo o que tenha várias páginas e aspeto cuidado mas não precise de servidor.",
    entrada: "out/index.html, gerado pelo build",
    build: { comandos: ["npm install --no-audit --no-fund", "npm run build"], saida: "out" },
    limparNodeModules: true,
    prefixoDePreview: true,   // servido em /preview/<id>/, precisa de assetPrefix  // depois do export, o out/ basta-se a si próprio
    ficheiros: {
      "package.json": pkg("plataforma", {
        scripts: { dev: "next dev", build: "next build" },
        dependencies: deps(),
      }),
      // 'export' escreve HTML puro em out/, que o preview já sabe servir:
      // sem processo por projeto, sem porta, sem memória ocupada.
      "next.config.mjs": `/** @type {import('next').NextConfig} */
export default {
  output: "export",
  images: { unoptimized: true },   // o otimizador precisa de servidor

  // O Next escreve os caminhos dos recursos a partir da RAIZ do domínio
  // (href="/_next/..."). Mas o preview serve a plataforma em
  // /preview/<id>/, e nessa altura o browser vai pedir o CSS e o JS à
  // raiz do orchestrator, onde não existe nada: 404 em tudo, página sem
  // estilos e o JavaScript nunca corre.
  //
  // A etapa de build define esta variável com o caminho certo. NÃO
  // remover esta linha.
  assetPrefix: process.env.PREVIEW_ASSET_PREFIX || undefined,
};
`,
      "tailwind.config.js": TAILWIND_CFG,
      "postcss.config.js": POSTCSS_CFG,
      "app/globals.css": GLOBALS_CSS,
      "app/layout.jsx": LAYOUT,
      "app/page.jsx": `export default function Home() {
  return (
    <main className="min-h-screen grid place-items-center p-8">
      <p className="text-slate-400">Scaffold pronto. Substitui este conteúdo.</p>
    </main>
  );
}
`,
      ".gitignore": GITIGNORE,
    },
  },

  /* ── Next.js com servidor ─────────────────────────────────── */
  "nextjs-server": {
    id: "nextjs-server",
    label: "Next.js (com servidor)",
    resumo: "React + Tailwind + rotas de API. Corre numa porta própria.",
    quando: "Só quando houver mesmo trabalho do lado do servidor: guardar dados, chamar APIs com segredos, autenticação. Custa uma porta e memória permanente — não usar por hábito.",
    entrada: "npm start numa porta atribuída",
    build: { comandos: ["npm install --no-audit --no-fund", "npm run build"], saida: ".next" },
    limparNodeModules: false, // o servidor precisa deles para correr
    ficheiros: {
      "package.json": pkg("plataforma", {
        scripts: { dev: "next dev", build: "next build", start: "next start" },
        dependencies: deps(),
      }),
      "next.config.mjs": "export default {};\n",
      "tailwind.config.js": TAILWIND_CFG,
      "postcss.config.js": POSTCSS_CFG,
      "app/globals.css": GLOBALS_CSS,
      "app/layout.jsx": LAYOUT,
      "app/page.jsx": `export default function Home() {
  return (
    <main className="min-h-screen grid place-items-center p-8">
      <p className="text-slate-400">Scaffold pronto. Substitui este conteúdo.</p>
    </main>
  );
}
`,
      "app/api/saude/route.js": `export async function GET() {
  return Response.json({ ok: true });
}
`,
      ".gitignore": GITIGNORE,
    },
  },

  /* ── checkout com Stripe ──────────────────────────────────── */
  "nextjs-pagamentos": {
    id: "nextjs-pagamentos",
    label: "Next.js + pagamentos (Stripe)",
    resumo: "Checkout do Stripe com produtos configuráveis. Só chaves de teste.",
    quando: "Páginas de venda, donativos, checkout rápido. Os produtos vivem num único ficheiro de configuração para dar para trocar sem mexer em código.",
    entrada: "npm start numa porta atribuída",
    build: { comandos: ["npm install --no-audit --no-fund", "npm run build"], saida: ".next" },
    limparNodeModules: false,
    // As chaves NUNCA entram no repositório do projeto. O build lê-as do
    // ambiente do orchestrator; se não existirem, a plataforma constrói na
    // mesma e o checkout responde com um erro claro em vez de rebentar.
    segredos: ["STRIPE_SECRET_KEY", "STRIPE_PUBLIC_KEY"],
    ficheiros: {
      "package.json": pkg("loja", {
        scripts: { dev: "next dev", build: "next build", start: "next start" },
        dependencies: deps({ stripe: "^16.0.0" }),
      }),
      "next.config.mjs": "export default {};\n",
      "tailwind.config.js": TAILWIND_CFG,
      "postcss.config.js": POSTCSS_CFG,
      "app/globals.css": GLOBALS_CSS,
      "app/layout.jsx": LAYOUT,
      // Um só ficheiro para o catálogo: é o que torna o terminal
      // "rapidamente customizável" sem obrigar a tocar na lógica.
      "config/produtos.js": `// Catálogo. Preços em CÊNTIMOS — o Stripe trabalha na unidade mínima
// da moeda, e usar euros com vírgula flutuante aqui dá erros de
// arredondamento reais em faturação.
export const MOEDA = "eur";

export const PRODUTOS = [
  { id: "basico",  nome: "Plano Básico",  descricao: "Para começar.",   preco:  990 },
  { id: "pro",     nome: "Plano Pro",     descricao: "Para trabalhar.", preco: 2490 },
];
`,
      "app/api/checkout/route.js": `import Stripe from "stripe";
import { PRODUTOS, MOEDA } from "../../../config/produtos";

// A chave vem do ambiente, nunca do repositório. Sem ela, respondemos
// com uma mensagem clara em vez de estoirar com um erro do Stripe.
const chave = process.env.STRIPE_SECRET_KEY;

export async function POST(req) {
  if (!chave) {
    return Response.json(
      { erro: "STRIPE_SECRET_KEY não está definida no servidor." },
      { status: 503 }
    );
  }

  const { produtoId, quantidade = 1 } = await req.json();
  const produto = PRODUTOS.find((p) => p.id === produtoId);
  if (!produto) return Response.json({ erro: "Produto desconhecido." }, { status: 400 });

  // A quantidade vem do cliente e não é de confiar: limitamo-la, senão
  // um pedido forjado consegue criar sessões absurdas.
  const qtd = Math.max(1, Math.min(Number(quantidade) || 1, 20));

  const stripe = new Stripe(chave);
  const origem = req.headers.get("origin") || "";

  const sessao = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{
      quantity: qtd,
      price_data: {
        currency: MOEDA,
        unit_amount: produto.preco,          // já em cêntimos
        product_data: { name: produto.nome, description: produto.descricao },
      },
    }],
    success_url: origem + "/obrigado",
    cancel_url: origem + "/",
  });

  return Response.json({ url: sessao.url });
}
`,
      "app/page.jsx": `"use client";
import { useState } from "react";
import { PRODUTOS } from "../config/produtos";

const euros = (c) => (c / 100).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });

export default function Loja() {
  const [aCarregar, setACarregar] = useState(null);
  const [erro, setErro] = useState(null);

  async function comprar(id) {
    setACarregar(id); setErro(null);
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produtoId: id }),
      });
      const dados = await r.json();
      if (!r.ok) throw new Error(dados.erro || "Falhou.");
      window.location.href = dados.url;
    } catch (e) {
      setErro(e.message); setACarregar(null);
    }
  }

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Escolhe um plano</h1>
      {erro && <p className="mb-4 text-red-600 text-sm">{erro}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {PRODUTOS.map((p) => (
          <div key={p.id} className="border rounded-xl p-5">
            <h2 className="font-medium">{p.nome}</h2>
            <p className="text-slate-500 text-sm mt-1">{p.descricao}</p>
            <p className="text-xl mt-3">{euros(p.preco)}</p>
            <button
              onClick={() => comprar(p.id)}
              disabled={aCarregar === p.id}
              className="mt-4 w-full rounded-lg bg-slate-900 text-white py-2 disabled:opacity-50"
            >
              {aCarregar === p.id ? "A abrir…" : "Comprar"}
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
`,
      "app/obrigado/page.jsx": `export default function Obrigado() {
  return (
    <main className="min-h-screen grid place-items-center p-8 text-center">
      <div>
        <h1 className="text-2xl font-semibold">Pagamento recebido</h1>
        <p className="text-slate-500 mt-2">Obrigado pela compra.</p>
      </div>
    </main>
  );
}
`,
      ".gitignore": GITIGNORE,
    },
  },
};

const DEFEITO = "estatico";

function listar() {
  return Object.values(STACKS).map(({ id, label, resumo, quando, entrada, segredos }) => ({
    id, label, resumo, quando, entrada,
    segredos: segredos || [],
    // diz ao painel se as chaves necessárias estão mesmo presentes
    prontaParaUsar: (segredos || []).every((s) => !!process.env[s]),
  }));
}

function obter(id) {
  return STACKS[id] || STACKS[DEFEITO];
}

/**
 * Escreve o scaffold na pasta do projeto.
 * Nunca sobrescreve: se o ficheiro já lá está, foi um agente que o
 * escreveu e o trabalho dele vale mais do que o molde.
 */
function aplicar(id, dir) {
  const stack = obter(id);
  const escritos = [];

  for (const [rel, conteudo] of Object.entries(stack.ficheiros || {})) {
    const destino = path.join(dir, rel);
    if (fs.existsSync(destino)) continue;
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, conteudo);
    escritos.push(rel);
  }
  return escritos;
}

/** Texto para as personas: o catálogo, em palavras. */
function catalogoParaPrompt() {
  return Object.values(STACKS).map((s) =>
    `  ${s.id}\n    ${s.resumo}\n    Quando: ${s.quando}\n    Entrega: ${s.entrada}`
  ).join("\n\n");
}

module.exports = { STACKS, DEFEITO, listar, obter, aplicar, catalogoParaPrompt };
