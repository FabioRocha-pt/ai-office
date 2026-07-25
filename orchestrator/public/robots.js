/* ---------------------------------------------------------------------
   Cinco robôs 2D para a Flex Window do Z Flip 6.

   Substitui o escritório 3D nesta página. Num ecrã de ~340px, uma cena
   WebGL com cinco bonecos dava silhuetas de 40px indecifráveis; cartões
   com SVG animado leem-se de relance e custam uma fração da bateria —
   sem contexto WebGL, sem 660 KB de Three.js, sem loop de render.

   Estados:
     dormir    olhos em fenda, respiração lenta, zzz a subir
     trabalhar olhos acesos, viseira a varrer, tremor de teclado
     pronto    olhos em arco contente, saltinho
     falhou    olhos em cruz, viseira apagada
   --------------------------------------------------------------------- */

const AGENTS = [
  { id:'ceo',       name:'CEO',       color:'#F59E0B' },
  { id:'cto',       name:'CTO',       color:'#3B82F6' },
  { id:'designer',  name:'Designer',  color:'#10B981' },
  { id:'developer', name:'Developer', color:'#8B5CF6' },
  { id:'qa',        name:'QA',        color:'#EF4444' },  // curto de propósito: 'QA Tester' não cabe a 13px
];

const STATE_PT = { idle:'a dormir', working:'a trabalhar', done:'pronto', error:'falhou' };

const CREAM = '#EFEDE0';
const CREAM_D = '#D8D6C8';
const NAVY = '#1B2A4A';
const NAVY_L = '#2A3B62';

/** O robô, em SVG. A cor do agente entra nas orelhas e nos olhos. */
function robotSVG(color){
  return `
<svg class="bot" viewBox="0 0 100 104" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g class="float">
    <!-- braços -->
    <g class="arm arm-l">
      <rect x="10" y="62" width="17" height="26" rx="8.5" fill="${CREAM}"/>
      <rect x="12" y="84" width="4" height="9" rx="2" fill="${NAVY}"/>
      <rect x="18" y="85" width="4" height="8" rx="2" fill="${NAVY}"/>
    </g>
    <g class="arm arm-r">
      <rect x="73" y="62" width="17" height="26" rx="8.5" fill="${CREAM}"/>
      <rect x="78" y="85" width="4" height="8" rx="2" fill="${NAVY}"/>
      <rect x="84" y="84" width="4" height="9" rx="2" fill="${NAVY}"/>
    </g>

    <!-- tronco -->
    <path d="M30 60 h40 a11 11 0 0 1 11 11 v13 a31 31 0 0 1 -62 0 v-13 a11 11 0 0 1 11 -11 z" fill="${CREAM}"/>
    <path d="M22 80 a31 31 0 0 0 56 0 z" fill="${NAVY}" opacity=".9"/>
    <path d="M30 60 h40 a11 11 0 0 1 11 11 h-8 a20 20 0 0 0 -46 0 h-8 a11 11 0 0 1 11 -11 z" fill="${NAVY_L}" opacity=".55"/>

    <!-- orelhas -->
    <rect x="4"  y="20" width="17" height="30" rx="8.5" fill="${color}"/>
    <rect x="79" y="20" width="17" height="30" rx="8.5" fill="${color}"/>

    <!-- cabeça -->
    <rect x="13" y="6" width="74" height="56" rx="17" fill="${CREAM}"/>
    <rect x="13" y="6" width="74" height="14" rx="7" fill="#FFFFFF" opacity=".5"/>

    <!-- viseira -->
    <rect class="visor" x="21" y="15" width="58" height="35" rx="11" fill="${NAVY}"/>
    <rect class="visor-scan" x="21" y="15" width="14" height="35" rx="7" fill="${color}" opacity="0"/>
    <path d="M25 20 h50 a7 7 0 0 1 -3 8 h-44 a7 7 0 0 1 -3 -8 z" fill="#FFFFFF" opacity=".07"/>

    <!-- olhos: acordado -->
    <g class="eyes-open">
      <rect x="35" y="24" width="9" height="17" rx="4.5" fill="${color}"/>
      <rect x="56" y="24" width="9" height="17" rx="4.5" fill="${color}"/>
    </g>
    <!-- olhos: contente -->
    <g class="eyes-happy" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round">
      <path d="M35 36 q4.5 -8 9 0"/>
      <path d="M56 36 q4.5 -8 9 0"/>
    </g>
    <!-- olhos: falhou -->
    <g class="eyes-x" stroke="#94A3B8" stroke-width="3.4" stroke-linecap="round">
      <path d="M36 28 l7 8 M43 28 l-7 8"/>
      <path d="M57 28 l7 8 M64 28 l-7 8"/>
    </g>
  </g>

  <!-- zzz do sono -->
  <g class="zzz" fill="${color}" font-family="system-ui, sans-serif" font-weight="700">
    <text class="z1" x="74" y="16" font-size="13">z</text>
    <text class="z2" x="84" y="9"  font-size="10">z</text>
  </g>
</svg>`;
}

let host = null;
let statuses = {};

export function mount(el){
  host = el;

  el.innerHTML = `<div class="bots">${AGENTS.map(a => `
    <button class="bcard" data-agent="${a.id}" data-s="idle" style="--c:${a.color}">
      ${robotSVG(a.color)}
      <span class="blabel">
        <span class="bname">${a.name}</span>
        <span class="bstate">a dormir</span>
      </span>
    </button>`).join('')}</div>`;

  // Toque num cartão: diz o que aquele agente anda a fazer
  el.addEventListener('click', e => {
    const c = e.target.closest('.bcard'); if(!c) return;
    const id = c.dataset.agent;
    const a = AGENTS.find(x => x.id === id);
    window.dispatchEvent(new CustomEvent('bot-tap', {
      detail: { id, name: a?.name || id, state: statuses[id] || 'idle' }
    }));
  });

  return { sync };
}

export function sync(map){
  statuses = map || {};
  if(!host) return;

  for(const a of AGENTS){
    const card = host.querySelector(`[data-agent="${a.id}"]`);
    if(!card) continue;
    const s = statuses[a.id] || 'idle';
    if(card.dataset.s !== s){
      card.dataset.s = s;
      card.querySelector('.bstate').textContent = STATE_PT[s] || s;
    }
  }
}

export default { mount, sync };
