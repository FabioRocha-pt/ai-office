/* ---------------------------------------------------------------------
   Escritório em miniatura para a Flex Window do Z Flip 6.

   Decisões que o ecrã de ~360x200 impôs:

   - ARCO VIRADO PARA A FRENTE, não um círculo. Num círculo, dois ou três
     bonecos ficam sempre de costas ou escondidos; aqui vêem-se os cinco
     ao mesmo tempo, que é o que interessa num relance.
   - CÂMARA ORTOGRÁFICA com balanço suave em vez de rotação completa.
     A perspetiva a este tamanho fazia os da frente parecerem gigantes.
   - BONECOS GRANDES, mobília simples. A esta escala o que se lê é a
     silhueta e o movimento, não o detalhe da secretária.
   - SOMBRAS FALSAS (elipses escuras). Indistinguíveis das reais aqui,
     e poupam o shadow map inteiro.
   - 30 fps a trabalhar, 15 em repouso, 0 com o ecrã apagado.

   Quem trabalha curva-se e teclota. Quem está livre brinca: espreguiça-se,
   gira na cadeira, mexe no telemóvel, atira uma bola ao ar.
   --------------------------------------------------------------------- */

import * as THREE from '/vendor/three.module.min.js';

const ACCENT = { ceo:0xF59E0B, cto:0x3B82F6, designer:0x10B981, developer:0x8B5CF6, qa:0xEF4444 };
const HEX    = { ceo:'#F59E0B', cto:'#3B82F6', designer:'#10B981', developer:'#8B5CF6', qa:'#EF4444' };
const NAME   = { ceo:'CEO', cto:'CTO', designer:'Designer', developer:'Developer', qa:'QA Tester' };
const SHORT  = { ceo:'CEO', cto:'CTO', designer:'DES', developer:'DEV', qa:'QA' };
const STATE_PT = { idle:'à espera', working:'a trabalhar', done:'pronto', error:'falhou' };

// Da esquerda para a direita, na ordem do fluxo de trabalho
const SEATS = ['cto','designer','ceo','developer','qa'];

// O que fazem quando não têm nada para fazer
const PLAY = ['lean', 'spin', 'phone', 'ball', 'stretch'];

let renderer, scene, camera, raf = null;
let desks = {}, statuses = {}, host, pickEl;
let busy = false, lastFrame = 0, sway = 0;

export function mount(el){
  host = el;
  pickEl = el.querySelector('.pick');

  const w = el.clientWidth || 340;
  const h = el.clientHeight || 200;

  scene = new THREE.Scene();

  // Enquadramento pela largura: fixamos quantas unidades do mundo cabem
  // na horizontal e deixamos a altura seguir o aspeto. Se guiássemos pela
  // altura, um palco mais alto encolhia os bonecos — exatamente o
  // contrário do que se quer.
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  frameCamera(w, h);
  camera.position.set(0, 3.4, 9);
  camera.lookAt(0, 1.0, 0);

  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(w, h, false);
  el.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xCCDCF5, 0x0A0C10, 1.5));
  const key = new THREE.DirectionalLight(0xFFFFFF, .95);
  key.position.set(3, 9, 7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6FA0E0, .35);
  rim.position.set(-5, 3, -6);
  scene.add(rim);

  // plataforma
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(6.4, 6.4, .3, 44),
    new THREE.MeshStandardMaterial({ color:0x171B22, roughness:.95 })
  );
  base.position.set(0, -.15, -.4);
  base.scale.z = .62;
  scene.add(base);

  SEATS.forEach((id, i) => {
    const t = SEATS.length > 1 ? i / (SEATS.length - 1) : .5;
    desks[id] = buildStation(id, t);
  });

  bindInput(el);
  loop();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; }
    else if (!raf) { lastFrame = 0; loop(); }
  });

  // O palco cresce e encolhe (é flex): reagimos ao elemento, não à janela
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      const W = el.clientWidth, H = el.clientHeight;
      if (!W || !H) return;
      frameCamera(W, H);
      renderer.setSize(W, H, false);
    }).observe(el);
  } else {
    addEventListener('resize', () => {
      const W = el.clientWidth, H = el.clientHeight;
      if (!W || !H) return;
      frameCamera(W, H);
      renderer.setSize(W, H, false);
    });
  }

  return { sync };
}

/** Largura do mundo visível, em unidades. Baixar = bonecos maiores. */
const WORLD_WIDTH = 7.2;

function frameCamera(w, h){
  const halfW = WORLD_WIDTH / 2;
  const halfH = halfW * (h / w);
  camera.left = -halfW; camera.right = halfW;
  camera.top = halfH;   camera.bottom = -halfH;
  camera.updateProjectionMatrix();
}

function fakeShadow(rx, rz, opacity = .3){
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(1, 18),
    new THREE.MeshBasicMaterial({ color:0x000000, transparent:true, opacity })
  );
  m.rotation.x = -Math.PI/2;
  m.scale.set(rx, rz, 1);
  m.position.y = .015;
  return m;
}

/** Etiqueta com o nome curto, sempre virada para a câmara. */
function makeTag(text, hex){
  const dpr = 2, fs = 44, padX = 20, padY = 12;
  const cv = document.createElement('canvas');
  let c = cv.getContext('2d');
  c.font = `800 ${fs}px Inter, system-ui, sans-serif`;
  const tw = c.measureText(text).width;

  cv.width = (tw + padX*2) * dpr;
  cv.height = (fs + padY*2) * dpr;

  c = cv.getContext('2d');
  c.scale(dpr, dpr);
  const w = cv.width/dpr, h = cv.height/dpr;

  c.fillStyle = 'rgba(8,10,14,.86)';
  c.beginPath(); c.roundRect(0, 0, w, h, h/2); c.fill();
  c.strokeStyle = hex; c.lineWidth = 2.5;
  c.beginPath(); c.roundRect(1.3, 1.3, w-2.6, h-2.6, h/2); c.stroke();

  c.fillStyle = hex;
  c.font = `800 ${fs}px Inter, system-ui, sans-serif`;
  c.textBaseline = 'middle'; c.textAlign = 'center';
  c.fillText(text, w/2, h/2 + 1);

  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map:tex, transparent:true, depthTest:false }));
  sp.scale.set((w/h) * .5, .5, 1);
  sp.renderOrder = 999;
  return sp;
}

function buildStation(id, t){
  const g = new THREE.Group();
  const c = ACCENT[id];

  // ---- secretária, simples de propósito ----
  const desk = new THREE.Group();
  desk.add(fakeShadow(.75, .38, .34));

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, .09, .62),
    new THREE.MeshStandardMaterial({ color:0xDDE4EF, roughness:.6 })
  );
  top.position.y = .58;
  desk.add(top);

  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(1.32, .035, .64),
    new THREE.MeshStandardMaterial({ color:c, roughness:.4 })
  );
  trim.position.y = .535;
  desk.add(trim);

  const legMat = new THREE.MeshStandardMaterial({ color:0x39414F, roughness:.85 });
  [-.55, .55].forEach(x => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(.07, .58, .5), legMat);
    l.position.set(x, .29, 0);
    desk.add(l);
  });

  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(.66, .42, .04),
    new THREE.MeshStandardMaterial({ color:0x0E1219, emissive:c, emissiveIntensity:.14, roughness:.3 })
  );
  screen.position.set(0, .85, -.2);
  desk.add(screen);

  desk.position.z = -.55;
  g.add(desk);

  // ---- boneco ----
  const av = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color:c, roughness:.55 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.26, .38, 5, 14), skin);
  body.position.y = .78;
  av.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(.225, 20, 18), skin);
  head.position.y = 1.32;
  av.add(head);

  // braços em pivôs, para poderem rodar a partir do ombro
  const armL = new THREE.Group(), armR = new THREE.Group();
  [[armL, -.27], [armR, .27]].forEach(([pivot, x]) => {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.072, .32, 4, 10), skin);
    arm.position.y = -.21;
    pivot.add(arm);
    pivot.position.set(x, 1.02, 0);
    av.add(pivot);
  });

  // adereços de brincadeira, escondidos por omissão
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(.095, 12, 10),
    new THREE.MeshStandardMaterial({ color:0xF8FAFC, roughness:.5 })
  );
  ball.visible = false;
  av.add(ball);

  const phone = new THREE.Mesh(
    new THREE.BoxGeometry(.14, .24, .018),
    new THREE.MeshStandardMaterial({ color:0x0B0E13, emissive:0x9FD0FF, emissiveIntensity:.9 })
  );
  phone.visible = false;
  av.add(phone);

  av.add(fakeShadow(.36, .21, .26));
  av.position.set(0, 0, .34);
  g.add(av);

  const tag = makeTag(SHORT[id] || id, HEX[id]);
  tag.position.set(0, 1.95, .2);
  g.add(tag);

  const light = new THREE.PointLight(c, 0, 2.6);
  light.position.set(0, 1.25, .1);
  g.add(light);

  // arco virado para a frente: os das pontas rodam ligeiramente para dentro
  const spread = 5.5;
  const x = (t - .5) * spread;
  const z = Math.abs(t - .5) * 1.5;      // pontas ligeiramente atrás
  g.position.set(x, 0, -z);
  g.rotation.y = -(t - .5) * .55;

  g.traverse(o => { o.userData.agentId = id; });
  scene.add(g);

  return {
    group:g, desk, screen, avatar:av, body, head, armL, armR, ball, phone, tag, light,
    accent:c, status:'idle',
    play: PLAY[Math.floor(Math.random()*PLAY.length)],
    playUntil: 0,
    seed: Math.random() * 10,
  };
}

/* ---------------- interação ---------------- */
function bindInput(el){
  let downX = 0, downY = 0;

  el.addEventListener('pointerdown', e => { downX = e.clientX; downY = e.clientY; });

  el.addEventListener('pointerup', e => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) return;

    const r = el.getBoundingClientRect();
    const p = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(p, camera);
    const hit = ray.intersectObjects(scene.children, true).find(h => h.object.userData.agentId);
    showPick(hit?.object.userData.agentId);
  });
}

const PLAY_PT = {
  lean:'recostado', spin:'a girar na cadeira', phone:'no telemóvel',
  ball:'a atirar a bola', stretch:'a espreguiçar-se',
};

function showPick(id){
  if (!id) { pickEl.classList.remove('on'); return; }
  const s = statuses[id] || 'idle';
  const d = desks[id];
  const extra = (s === 'idle' && d) ? ' · ' + (PLAY_PT[d.play] || '') : '';

  pickEl.querySelector('i').style.background = HEX[id];
  pickEl.querySelector('b').textContent = NAME[id] || id;
  pickEl.querySelector('span').textContent = (STATE_PT[s] || s) + extra;
  pickEl.classList.add('on');
  clearTimeout(pickEl._h);
  pickEl._h = setTimeout(() => pickEl.classList.remove('on'), 3600);
}

/* ---------------- estado ---------------- */
export function sync(map){
  statuses = map || {};
  busy = Object.values(statuses).some(s => s === 'working');

  for (const [id, d] of Object.entries(desks)) {
    const s = statuses[id] || 'idle';
    if (s !== d.status) {
      d.status = s;
      d.playUntil = 0;            // volta a sortear a brincadeira
      if (s === 'done') d.cheerUntil = performance.now() + 1800;
    }

    const col = s === 'error' ? 0xEF4444 : s === 'done' ? 0x10B981 : d.accent;
    d.light.color.setHex(col);
    d.light.intensity = s === 'working' ? 1.3 : s === 'idle' ? 0 : .5;
    d.screen.material.emissive.setHex(col);
    d.screen.material.emissiveIntensity = s === 'working' ? .8 : s === 'idle' ? .12 : .38;
    d.tag.material.opacity = s === 'idle' ? .72 : 1;
  }

  if (!raf) { lastFrame = 0; loop(); }
}

/* ---------------- animação ---------------- */
const clock = new THREE.Clock();

function resetPose(d){
  d.avatar.position.y = 0;
  d.avatar.rotation.set(0, 0, 0);
  d.body.rotation.x = 0;
  d.head.rotation.set(0, 0, 0);
  d.head.position.set(0, 1.32, 0);
  d.armL.rotation.set(0, 0, 0);
  d.armR.rotation.set(0, 0, 0);
  d.ball.visible = false;
  d.phone.visible = false;
}

function poseWorking(d, t){
  // curvado para o ecrã, a teclar depressa
  d.body.rotation.x = .3;
  d.head.position.set(0, 1.24, .12);
  d.head.rotation.x = .32;

  const k = Math.sin(t * 17 + d.seed);
  d.armL.rotation.x = -1.05 + k * .13;
  d.armR.rotation.x = -1.05 - k * .13;
  d.avatar.position.y = Math.abs(Math.sin(t * 8.5 + d.seed)) * .012;
  d.light.intensity = 1.05 + Math.sin(t * 5 + d.seed) * .4;
}

function posePlaying(d, t, now){
  // escolhe uma brincadeira nova de vez em quando
  if (now > d.playUntil) {
    let next = PLAY[Math.floor(Math.random() * PLAY.length)];
    if (next === d.play) next = PLAY[(PLAY.indexOf(next) + 1) % PLAY.length];
    d.play = next;
    d.playUntil = now + 4500 + Math.random() * 4500;
  }

  const b = Math.sin(t * 1.5 + d.seed) * .02;   // respiração
  d.avatar.position.y = b;

  switch (d.play) {
    case 'lean':      // recostado, mãos atrás da cabeça
      d.body.rotation.x = -.22;
      d.head.rotation.x = -.2;
      d.armL.rotation.set(-2.5, 0, -.5);
      d.armR.rotation.set(-2.5, 0, .5);
      break;

    case 'spin':      // a girar na cadeira
      d.avatar.rotation.y = t * 1.15 + d.seed;
      d.armL.rotation.z = -.75;
      d.armR.rotation.z = .75;
      break;

    case 'phone':     // de cabeça baixa no telemóvel
      d.head.rotation.x = .42;
      d.armL.rotation.set(-1.3, 0, -.22);
      d.armR.rotation.set(-1.3, 0, .22);
      d.phone.visible = true;
      d.phone.position.set(0, 1.08, .34);
      d.phone.rotation.x = -.55;
      break;

    case 'ball': {    // a atirar uma bola ao ar
      const cycle = (t * 1.5 + d.seed) % 1;
      const hop = Math.sin(cycle * Math.PI);
      d.ball.visible = true;
      d.ball.position.set(.12, 1.24 + hop * .62, .18);
      d.armR.rotation.x = -1.5 + hop * .5;
      d.armL.rotation.z = .3;
      d.head.rotation.x = -hop * .3;
      break;
    }

    case 'stretch': { // espreguiçar-se de vez em quando
      const s = Math.max(0, Math.sin(t * .8 + d.seed));
      d.armL.rotation.set(-2.9 * s, 0, -.3 * s);
      d.armR.rotation.set(-2.9 * s, 0, .3 * s);
      d.body.rotation.x = -.16 * s;
      d.head.rotation.x = -.24 * s;
      d.avatar.position.y = b + s * .035;
      break;
    }
  }
}

function poseDone(d, t, now){
  // pequeno salto de contentamento, depois volta a brincar
  if (d.cheerUntil && now < d.cheerUntil) {
    const p = (d.cheerUntil - now) / 1800;
    d.avatar.position.y = Math.abs(Math.sin(t * 11)) * .13 * p;
    d.armL.rotation.x = -2.4;
    d.armR.rotation.x = -2.4;
    d.head.rotation.x = -.15;
  } else {
    posePlaying(d, t, now);
  }
}

function loop(){
  raf = requestAnimationFrame(loop);

  const now = performance.now();
  const step = busy ? 33 : 66;          // 30 fps a trabalhar, 15 parado
  if (now - lastFrame < step) return;
  lastFrame = now;

  const t = clock.getElapsedTime();

  // balanço suave da câmara — dá vida sem esconder ninguém
  sway = Math.sin(t * .22) * .5;
  camera.position.set(sway, 4.4 + Math.sin(t * .17) * .12, 9);
  camera.lookAt(0, 1.05, 0);

  for (const d of Object.values(desks)) {
    resetPose(d);
    if (d.status === 'working') poseWorking(d, t);
    else if (d.status === 'done') poseDone(d, t, now);
    else if (d.status === 'error') {
      d.head.rotation.x = .3;
      d.body.rotation.x = .18;
      d.avatar.position.y = Math.sin(t * 1.2 + d.seed) * .008;
    } else posePlaying(d, t, now);
  }

  renderer.render(scene, camera);
}

export default { mount, sync };
