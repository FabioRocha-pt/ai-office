#!/usr/bin/env node
// Dá olhos ao QA.
//
// O QA corre numa VPS sem ecrã: até agora testava lógica mas nunca via a
// página. Não sabia se o menu se parte no telemóvel, se o contraste falha,
// ou se um elemento transborda. Isto abre a página num Chromium headless
// e devolve o que só se vê olhando.
//
//   node tools/ver-pagina.js http://localhost:3000/preview/o-projeto/
//
// Guarda os screenshots na pasta do projeto (qa-screenshots/) e imprime
// um relatório em texto, para o agente o poder ler directamente.

const path = require("path");
const fs = require("fs");

const VIEWPORTS = [
  { nome: "telemovel", width: 390, height: 844, dpr: 3 },
  { nome: "secretaria", width: 1440, height: 900, dpr: 1 },
];

async function main() {
  const url = process.argv[2];
  const destino = process.argv[3] || process.cwd();

  if (!url) {
    console.error("Uso: node ver-pagina.js <url> [pasta-destino]");
    process.exit(1);
  }

  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    console.error(
      "O Playwright não está instalado. Corre na VPS:\n" +
      "  cd /root/ai-office/orchestrator && npm i -D playwright && npx playwright install --with-deps chromium"
    );
    process.exit(1);
  }

  const pastaShots = path.join(destino, "qa-screenshots");
  fs.mkdirSync(pastaShots, { recursive: true });

  const browser = await chromium.launch();
  const relatorio = [];

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.dpr,
    });
    const page = await ctx.newPage();

    const erros = [];
    page.on("console", (m) => {
      if (m.type() === "error") erros.push(m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => erros.push("JS: " + String(e.message).slice(0, 200)));

    let estado = "ok";
    try {
      const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
      if (resp && !resp.ok()) estado = `HTTP ${resp.status()}`;
    } catch (e) {
      estado = "não carregou: " + e.message.slice(0, 120);
    }

    const ficheiro = path.join(pastaShots, `${vp.nome}.png`);
    try {
      await page.screenshot({ path: ficheiro, fullPage: true });
    } catch {}

    // Elementos que saem do ecrã na horizontal. É a falha mais comum em
    // telemóvel e a mais fácil de não notar num monitor grande.
    const transbordo = await page.evaluate((largura) => {
      const maus = [];
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (r.right > largura + 2 || r.left < -2) {
          const id = el.id ? "#" + el.id
            : el.className && typeof el.className === "string"
              ? "." + el.className.trim().split(/\s+/)[0] : "";
          maus.push(`${el.tagName.toLowerCase()}${id} (${Math.round(r.left)}→${Math.round(r.right)}px)`);
        }
      });
      return [...new Set(maus)].slice(0, 12);
    }, vp.width);

    // Contraste do texto contra o fundo, pela fórmula WCAG.
    const contraste = await page.evaluate(() => {
      const lum = (c) => {
        const [r, g, b] = c.map((v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const rgb = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);

      const fundoDe = (el) => {
        let n = el;
        while (n && n !== document.documentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg && !bg.includes("rgba(0, 0, 0, 0)") && bg !== "transparent") return rgb(bg);
          n = n.parentElement;
        }
        return [255, 255, 255];
      };

      const maus = [];
      const vistos = new Set();
      document.querySelectorAll("p,span,a,li,h1,h2,h3,h4,button,label,td,th").forEach((el) => {
        const txt = (el.textContent || "").trim();
        if (!txt || txt.length > 120) return;
        const st = getComputedStyle(el);
        if (st.visibility === "hidden" || st.display === "none") return;

        const fg = rgb(st.color);
        const bg = fundoDe(el);
        if (fg.length < 3 || bg.length < 3) return;

        const l1 = lum(fg), l2 = lum(bg);
        const razao = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const tamanho = parseFloat(st.fontSize);
        const grande = tamanho >= 24 || (tamanho >= 18.66 && parseInt(st.fontWeight) >= 700);
        const minimo = grande ? 3 : 4.5;

        if (razao < minimo) {
          const chave = st.color + st.fontSize;
          if (vistos.has(chave)) return;
          vistos.add(chave);
          maus.push(`"${txt.slice(0, 40)}" — ${razao.toFixed(1)}:1 (mínimo ${minimo}:1)`);
        }
      });
      return maus.slice(0, 10);
    });

    const titulo = await page.title().catch(() => "");
    relatorio.push({ vp: vp.nome, estado, titulo, erros, transbordo, contraste, ficheiro });
    await ctx.close();
  }

  await browser.close();

  // --- saída em texto, para o agente ler ---
  console.log("=== O QUE SE VÊ NA PÁGINA ===");
  console.log(`URL: ${url}\n`);

  for (const r of relatorio) {
    console.log(`--- ${r.vp} ---`);
    console.log(`estado: ${r.estado}`);
    if (r.titulo) console.log(`título: ${r.titulo}`);
    console.log(`screenshot: ${r.ficheiro}`);

    if (r.erros.length) {
      console.log(`erros de consola (${r.erros.length}):`);
      r.erros.slice(0, 6).forEach((e) => console.log(`  ! ${e}`));
    } else console.log("erros de consola: nenhum");

    if (r.transbordo.length) {
      console.log(`ELEMENTOS A TRANSBORDAR (${r.transbordo.length}):`);
      r.transbordo.forEach((t) => console.log(`  > ${t}`));
    } else console.log("transbordo horizontal: nenhum");

    if (r.contraste.length) {
      console.log(`CONTRASTE ABAIXO DO WCAG AA (${r.contraste.length}):`);
      r.contraste.forEach((c) => console.log(`  > ${c}`));
    } else console.log("contraste: passa em tudo o que vi");

    console.log("");
  }

  const problemas = relatorio.reduce(
    (n, r) => n + r.erros.length + r.transbordo.length + r.contraste.length, 0
  );
  console.log(problemas === 0
    ? "Sem problemas visuais detetados."
    : `TOTAL: ${problemas} problemas visuais a reportar no QA.md.`);
}

main().catch((e) => {
  console.error("Falhou: " + e.message);
  process.exit(1);
});
