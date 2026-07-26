/* Mede a cena 3D SEM tocar na página: patcha o contexto WebGL antes de o
   documento carregar e conta desenhos reais, draw calls e triângulos.
   Corre a partir de orchestrator/ (precisa do `ws` de node_modules).

     node tools/medir-cena.js <url> [segundos] [saida.png] [js-antes-da-captura]

   Precisa de um Chrome headless à escuta em 9333. O modo que interessa é
   o pior caso — WebGL por software, que é o que uma máquina sem
   aceleração gráfica faz:

     chrome --headless=new --disable-gpu --enable-unsafe-swiftshader \
            --remote-debugging-port=9333 --window-size=1600,1000 \
            --user-data-dir=/tmp/cprof about:blank &

   `fps_oferecidos` são chamadas de requestAnimationFrame (o ritmo que o
   browser dá) e `fps_desenhados` são renders mesmo feitos — a cena tem
   teto de 30 fps, por isso os dois números não coincidem, e é o segundo
   que conta. As médias dividem por desenhos, não por frames. */
const WebSocket = require('ws');
const fs = require('fs');

const URL    = process.argv[2] || 'http://127.0.0.1:3111/office.html';
const ESPERA = (+process.argv[3] || 22) * 1000;
const PNG    = process.argv[4] || null;
const ANTES  = process.argv[5] || null;

const erros = [];
let id = 0; const pend = new Map();

/* O gl.clear() é o marcador de um render: o three.js chama-o uma vez por
   `renderer.render()`, antes de desenhar seja o que for. */
const SONDA = `
(() => {
  const w = window; w.__m = { calls:0, tris:0, frames:0, desenhos:0, t0:0, progs:0, texs:0 };
  for (const proto of [WebGLRenderingContext.prototype,
                       self.WebGL2RenderingContext?.prototype].filter(Boolean)) {
    const de = proto.drawElements, da = proto.drawArrays,
          lp = proto.linkProgram, ti = proto.texImage2D, cl = proto.clear;
    proto.drawElements = function(m,c,...r){ w.__m.calls++; w.__m.tris += c/3; return de.call(this,m,c,...r); };
    proto.drawArrays   = function(m,f,c,...r){ w.__m.calls++; w.__m.tris += c/3; return da.call(this,m,f,c,...r); };
    proto.linkProgram  = function(...a){ w.__m.progs++; return lp.apply(this,a); };
    proto.texImage2D   = function(...a){ w.__m.texs++;  return ti.apply(this,a); };
    proto.clear        = function(...a){ w.__m.desenhos++; return cl.apply(this,a); };
  }
  const laco = () => { w.__m.frames++; requestAnimationFrame(laco); };
  requestAnimationFrame(laco);
  // zera aos 6 s para não contar o arranque na média de regime
  setTimeout(() => { const m = w.__m;
    m.t0 = performance.now(); m.calls = m.tris = m.frames = m.desenhos = 0; }, 6000);
})();`;

(async () => {
  const alvos = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const pag = alvos.find(t => t.type === 'page');
  const ws = new WebSocket(pag.webSocketDebuggerUrl, { perMessageDeflate: false });
  const cmd = (method, params = {}) => new Promise(res => {
    const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.on('message', buf => {
    const m = JSON.parse(buf);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      erros.push('EXCEPÇÃO: ' + (d.exception?.description || d.text));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error')
      erros.push('ERRO: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
      erros.push(m.params.type.toUpperCase() + ': ' +
        m.params.args.map(a => a.description || a.value).join(' ').slice(0, 200));
  });
  await new Promise(r => ws.on('open', r));
  await cmd('Runtime.enable'); await cmd('Log.enable'); await cmd('Page.enable');
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: SONDA });
  await cmd('Page.navigate', { url: URL });
  await new Promise(r => setTimeout(r, ESPERA));

  /* 6 s de folga: pôr um agente 'working' manda-o atravessar a sala, e a
     travessia do lounge até ao posto demora perto de 3 s. Com menos
     espera a captura apanha-o a meio caminho. */
  if (ANTES) {
    await cmd('Runtime.evaluate', { expression: ANTES, awaitPromise: true });
    await new Promise(r => setTimeout(r, 6000));
  }

  const r = await cmd('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const m = window.__m, dur = (performance.now() - m.t0) / 1000;
    return JSON.stringify({
      fps_desenhados: +(m.desenhos / dur).toFixed(1),
      fps_oferecidos: +(m.frames / dur).toFixed(1),
      drawCalls_por_desenho:  Math.round(m.calls / m.desenhos),
      triangulos_por_desenho: Math.round(m.tris / m.desenhos),
      programas: m.progs, texturas: m.texs,
      transferido_MB: +(performance.getEntriesByType('resource')
        .reduce((a, e) => a + (e.transferSize || 0), 0) / 1048576).toFixed(2),
    });
  })()` });
  console.log(URL);
  console.log(r.result.value);
  const unicos = [...new Set(erros)];
  console.log('erros (' + unicos.length + '):');
  unicos.slice(0, 25).forEach(e => console.log('  •', e.slice(0, 220)));
  /* AMPLIA="x,y,largura,altura,escala" recorta e amplia um pedaço. É a
     única forma de julgar coisas de um ou dois píxeis — os contornos de
     desenho animado, por exemplo, que sem antialias saem tracejados se
     ficarem abaixo de um píxel de largura. */
  if (PNG) {
    const amp = process.env.AMPLIA;
    const params = { format: 'png' };
    if (amp) {
      const [x, y, width, height, scale] = amp.split(',').map(Number);
      params.clip = { x, y, width, height, scale: scale || 3 };
      params.captureBeyondViewport = true;
    }
    const s = await cmd('Page.captureScreenshot', params);
    fs.writeFileSync(PNG, Buffer.from(s.data, 'base64'));
  }
  ws.close(); process.exit(0);
})();
