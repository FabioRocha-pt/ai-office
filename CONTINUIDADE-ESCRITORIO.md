# Continuidade — escritório high-tech com módulos do Meshy

Documento para o próximo Claude. Escrito a 2026-07-26 por uma sessão que
ficou sem contexto a meio da integração. Lê isto antes de tocar no código.

O `HANDOFF.md` da raiz continua válido para o resto do projeto. Isto cobre
só o trabalho do escritório 3D.

---

## Estado: modelos prontos, integração a meio

O utilizador pediu: *"o escritório, um ambiente isolado e hightech para os
robots trabalharem lá dentro, e usar o mesmo mecanismo, terem um sitio para
brincar, e quando vão trabalhar, deslocam se para o seu gabinete de
escritório, com a sua cor destacada"*.

### O que já está feito e verificado

**`orchestrator/public/modelos/`** — três GLB, 6.8 MB no total:

| Ficheiro | Triângulos | L×A×P nativo | Peso |
|---|---|---|---|
| `robo.glb` | 7554 | 1.90 × 1.89 × 0.98 | 1.95 MB |
| `gabinete.glb` | 6808 | 1.899 × 1.561 × 1.061 | 2.52 MB |
| `lounge.glb` | 6670 | 1.898 × 1.427 × 1.718 | 2.37 MB |

O `robo.glb` **está integrado, publicado na VPS e em git** (commit
`8f6773c`). O `gabinete.glb` e o `lounge.glb` estão gerados e por integrar.

### Decisões de âmbito já tomadas com o utilizador

1. **O Meshy gera só os módulos que repetem; a sala é procedural.** Um
   interior inteiro do Meshy não serve: vem como uma malha única em escala
   arbitrária, não tem onde encaixar o arco de 5 postos em ângulos exatos,
   e a câmara orbita 360° e ficaria com parede à frente.
2. **Fecho da sala: parede cilíndrica com desvanecimento.** Sala completa
   de raio ~12, com os segmentos entre a câmara e o centro a ficarem
   transparentes conforme ela orbita. Escolhido pelo utilizador em
   alternativa a "parede só atrás" e a "plataforma no vazio".
3. **O gabinete dá só a mobília.** Ficam procedurais o ecrã (tem textura de
   código a correr e emissivo por estado), a lâmpada (cor e luz por
   estado), o vapor do café e as folhas da planta — o código controla-os e
   o Meshy não exporta nada disso.

---

## O que falta fazer, por ordem

1. ~~Generalizar o carregador~~ **FEITO.** Helpers partilhados no
   `office.html`: `amostrador()`, `AMOSTRAS`, `classeCor()`,
   `recortarTris()`, `carregarMalha()`.
2. ~~Cinco gabinetes no arco~~ **FEITO, com defeitos conhecidos** — ver
   secção abaixo. `carregarGabinete()` + o bloco "o gabinete" na
   `buildDesk()`.
3. **Sala procedural** — parede cilíndrica com desvanecimento, teto,
   calhas no teto por gabinete, halo no chão. **É AQUI QUE PEGAS.**
4. **Cápsula de descanso** a substituir o sofá do `buildLounge()`,
   mantendo os `slot` onde os robôs brincam. O `lounge.glb` está gerado e
   por integrar; usa o mesmo `carregarMalha()` + `classeCor()`.

### Etapa 2: o que ficou a funcionar

Verificado em Chrome headless, sem exceções, 5 agentes montados:

- Os cinco gabinetes entram no arco na orientação certa. A cápsula abre
  para o centro da sala. **Não precisa de rotação própria**: o grupo do
  posto já vem rodado de `angle + π`, e o modelo tem a abertura em +z.
- A bancada do módulo aterra exactamente nos 0.78 da secretária antiga,
  por isso teclado, rato, caneca, planta, papéis e candeeiro não
  precisaram de mudar de altura. Foi de propósito: medi que a bancada
  está a 40% da altura do modelo e escolhi a escala a partir disso
  (`GAB_BANCADA / GAB_FRACAO`).
- **As calhas acendem na cor do agente** e leem-se sob o friso escuro.
- O ecrã procedural assenta no painel que o carregador mede na malha
  (`ecra.x/y/z/largura/altura`), não numa posição adivinhada.
- O robô a trabalhar passou a parar a `R - 0.80` em vez de `R - 1.12`:
  com a profundidade esticada a boca da cápsula fica em z 0.93, e ao raio
  antigo ele pairava à porta do gabinete em vez de dentro dele.

### Etapa 2: defeitos que ficaram, por ordem de gravidade

1. **A calha sai serrilhada.** Dentes de serra em vez de linha limpa,
   bem visível a 3× de ampliação no rebordo. É intrínseco a classificar
   triângulos inteiros numa feature de um triângulo de largura. Opções:
   (a) desenhar a calha proceduralmente — um `TorusGeometry` ou tubo ao
   longo do rebordo, medido na malha, em vez de a herdar da textura;
   (b) subdividir os triângulos da fronteira; (c) aceitar, porque à
   distância da câmara por omissão a linha é fina e o serrilhado quase
   não se nota. **Recomendo (a)**: é o que dá uma linha limpa e permite
   controlar a espessura e o brilho da cor do agente.
2. **De trás, a cápsula é uma tina creme.** Todo o carácter high-tech —
   ecrã, calhas interiores — está do lado da abertura, e da câmara por
   omissão vêem-se as traseiras das cápsulas centrais. Já acontecia com
   as divisórias antigas, mas agora a massa é maior. A sala procedural
   (etapa 3) pode compensar com as calhas do teto sobre cada gabinete.
3. **A cadeira foi removida** — era uma cadeira de escritório com rodas
   que destoava do gabinete e dos robôs sem pernas, e espetava-se acima
   do rebordo a tapar o ecrã. `anim.cadeira` **já não existe**, e a linha
   que a rodava saiu do `tick()`. Se quiseres um assento, gera-o no Meshy
   junto com o resto.
4. **Os objetos foram puxados para dentro** porque atravessavam a parede
   curva: caneca `-1.02 → -0.80`, planta `1.15 → 0.88`, rato `0.72 → 0.55`,
   papéis `0.95 → 0.62`, e o z de cada um encurtado. Se mexeres na escala
   do módulo, estes valores têm de acompanhar.
5. `NOTE_CORES` e os post-its saíram (o cubículo já não tem parede plana
   onde os colar).

### Constantes da etapa 2

```js
GAB_BANCADA = 0.78   // altura da bancada, herdada da secretária antiga
GAB_FRACAO  = 0.40   // a que fração da altura do modelo ela está (MEDIDO)
GAB_FUNDO   = 1.40   // esticão só na profundidade
                     // → escala 1.2492, cápsula 2.37 L × 1.95 A × 1.86 P
```

A profundidade leva esticão à parte porque à escala uniforme a cápsula
ficava rasa (1.33) e o robô pairava fora dela.

---

## O que descobri e não é óbvio no código

### As calhas de luz são uma TERCEIRA cor

O robô tem duas cores e a classificação é a duas (luminância < 64 → friso
escuro, resto → casca). Os módulos novos têm três, e o ciano das calhas
tem luminância ~140: com a regra do robô **caía no lado do creme e as
calhas desapareciam** — e são elas que carregam a cor do agente.

Medido na textura do gabinete (2048×2048):

| Classe | Área | Cor média | Como se apanha |
|---|---|---|---|
| friso escuro | 16.5% | `#151e2e` | luminância 29, abaixo de 64 |
| calha de luz | 1.0% | `#25bbd2` | saturação 0.82, acima de 0.30 |
| casca creme | 82.5% | `#f3efe1` | saturação 0.07 |

### Mediana para o escuro, MÁXIMO para a calha

Testei a classificação ao nível do triângulo antes de escrever integração,
e foi bem feito: com a mediana das 7 amostras só **161 triângulos (2.4%)**
saíam como calha, porque são linhas finas que não dominam nenhum triângulo.
Usando o **máximo de saturação (> 0.45)** sobem para **425 (6.2%)**.

Não é incoerência usar critérios diferentes: o friso escuro é área grande
e a mediana acerta-lhe; as calhas são linhas finas e à distância da câmara
uma calha de um triângulo de largura fica sub-pixel. Vale enviesar a favor
de a mostrar.

Regra final a implementar:

```js
const LIMIAR    = 64;     // luminância: abaixo disto é friso escuro
const SAT_CALHA = 0.45;   // saturação máxima: acima disto é calha de luz

// mediana de 7 para a luminância, máximo de 7 para a saturação
if (medianaLum < LIMIAR)   return 'escuro';
if (maxSaturacao > SAT_CALHA) return 'calha';
return 'casca';
```

O robô passa por este classificador sem mudar de aspeto: o azul-marinho
dele tem saturação 0.94 **mas** luminância 29, e o teste do escuro vem
primeiro. O creme dele tem saturação 0.145, abaixo de 0.45. Ou seja o robô
fica com `escuro` + `casca` e `calha` vazia. **Confirma isto se mexeres nos
limiares.**

### Peças cortadas de uma malha abrem frestas ao rodar

Já resolvido no robô, mas vale para qualquer peça que venhas a partir e
animar: ao rodar a cabeça, a fronteira serrilhada do corte no pescoço abre
e via-se o fundo. A correção foi `side: THREE.DoubleSide` nos materiais
(a fresta passa a mostrar o interior da casca) **mais** reduzir a amplitude
do giro de 0.28 para 0.13 rad.

### O detetor de recortes das folhas de referência

O `crop` que fiz assumia fundo branco e falhou na folha da zona de brincar,
que veio com fundo cinzento **mais escuro** que o creme dos módulos — a
imagem inteira passou por conteúdo. A versão que funciona decide por
**cromaticidade (max−min dos canais) > 6 OU desvio de luminância face ao
fundo amostrado nos quatro cantos > 12**. Só um dos dois critérios não
basta: num fundo cinzento o creme quase não difere em luminância mas tem
cromaticidade; num fundo branco um painel cinzento não tem cromaticidade
mas difere muito em luminância.

Também: o gerador escreve rótulos "FRONT/SIDE/BACK" na imagem apesar de se
pedir sem texto. O recorte tem de agrupar as linhas contíguas de conteúdo e
ficar só com a maior, senão as letras entram no recorte e o Meshy modela-as.

### A cena tem dois temas

`pintarCena(tema)` no fim do `office.html` repinta fundo, nevoeiro, chão e
tapete. **A sala nova tem de entrar lá**, senão fica clara no tema escuro.
O Chrome headless pede tema escuro por omissão, o que explica capturas
escuras.

---

## Medidas da cena que a integração tem de respeitar

```
R = 7.4                 raio do arco de secretárias
spread = π · 0.86       abertura 154.8°, 5 postos
espaçamento = 5.00      entre centros de postos, ao longo do arco
ângulos = -77.4, -38.7, 0, 38.7, 77.4 graus

posto i:  g.position = (sin θ · 7.4, 0, cos θ · 7.4)
          g.rotation.y = θ + π          → a frente do posto olha o centro
robô a trabalhar: raio 7.4 − 1.12 = 6.28, mesmo ângulo
lounge: z = −7.2 (lado oposto do arco)

chão: círculo raio 24     tapete central: raio 5.2     grelha 48×48
câmara: perspetiva 42°, em (−2, 13, 19.5), alvo (0, 1.3, −0.6)
OrbitControls: azimute LIVRE (360°), maxPolarAngle π/2.2, distância 7 a 34
```

A parede cilíndrica tem de ter raio > 7.4 + profundidade do gabinete. Com o
gabinete a ~1.8 de profundidade, raio 12 dá folga.

### Constantes do robô, já em produção

```js
Y_PESCOCO = 0.19   X_OMBRO = 0.42    // planos de corte, espaço do modelo
ALTURA = 1.30      FLUTUA = 0.55     // altura final e altura a que paira
SATURA = 1.15      CLARO_MIN = 0.46  CLARO_MAX = 0.60   // corCasca()
CREME = 0xF2E8CF   VISEIRA = 0x041D49
```

`corCasca(hex)` põe o tom do agente em HSL, satura e limita a claridade à
banda. **Não achates a claridade num valor único** — já tentei, e o
esmeralda do Designer saía menta e deixava de combinar com o ponto da cor
dele no painel.

---

## O que o código já existente controla e NÃO se pode perder

O `buildDesk()` devolve um objeto cujos campos são lidos pela animação e
pelo `setStatus()`. Se substituíres mobília, mantém estas referências:

| Referência | Quem a usa | Para quê |
|---|---|---|
| `d.screen` | `setStatus` | `material.emissive` + `emissiveIntensity` por estado |
| `anim.screenTex` | `tick` | `offset.y` desce → código a correr no ecrã |
| `d.lamp`, `d.lampLight` | `setStatus` | cor, emissivo e intensidade por estado |
| `anim.cadeira` | `tick` | `rotation.y` oscila |
| `anim.steam` | `tick` | 3 esferas que sobem e desvanecem |
| `anim.folhas` | `tick` | 5 folhas que balançam |
| `anim.cabeca`, `anim.bracos`, `anim.olhos` | `tick` | pose do robô |
| `anim.bolbo` | `setStatus` | aponta para um OLHO, não para a orelha |
| `anim.anel` | `tick` | opacidade do anel de flutuação |
| `anim.ancora` | `posicionarPins` | âncora da etiqueta HTML, y = 2.05 |
| `d.lugar`, `d.slot` | `tick` | destino a trabalhar / a brincar |

**`anim.bolbo` aponta para um olho.** Estava nas orelhas, mas quando a
casca passou a ter a cor do agente a cheio os discos das orelhas
desapareciam nela — e o `setStatus()` apaga-os para cinzento quando livre,
logo só se veriam com o agente PARADO. As orelhas passaram a marfim fixo e
o sinal de estado ficou nos olhos, sobre a viseira escura, onde tanto a cor
acesa como o cinzento se leem.

---

## Como verificar sem browser à mão

Foi assim que apanhei todos os defeitos. Vale a pena repetir.

**Servidor local sem autenticação** (só no processo de teste; o carregador
de `.env` só define variáveis ainda indefinidas, por isso uma vazia ganha):

```bash
cd orchestrator
OFFICE_PASSWORD= PORT=3111 node server.js &
```

**Chrome headless com WebGL por software**, e CDP por `ws` (que está em
`orchestrator/node_modules`, por isso o script tem de correr dessa pasta):

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --disable-gpu --enable-unsafe-swiftshader \
  --remote-debugging-port=9333 --window-size=1600,1000 \
  --user-data-dir=/tmp/cprof about:blank &
```

Depois um script em `orchestrator/` que liga a `127.0.0.1:9333/json/list`,
faz `Page.navigate`, espera ~13 s pelo carregamento dos GLB, e usa
`Page.captureScreenshot` com `clip:{x,y,width,height,scale}` para ampliar.
`Runtime.exceptionThrown` e `Log.entryAdded` apanham erros.

**Gancho de depuração temporário** — mete antes do `init()`, e APAGA-O
antes de entregar (verifica com `grep -c __dbg office.html`):

```js
window.__dbg = { THREE, camera, controls, scene, desks, setStatus,
                 get PECAS(){ return PECAS; } };
```

Para fixar a câmara num robô: põe `controls.enableDamping = false` **antes**
de mexer na posição. Com o damping ligado o `controls.update()` do loop
volta a puxar a câmara e a captura sai no sítio errado — perdi uma captura
a descobrir isto.

**Renderizador offline sem browser.** Para ver um GLB antes de o integrar
escrevi um rasterizador em Node (projeção ortográfica, z-buffer, sombreado
plano por normal, PNG escrito à mão com zlib). Foi o que revelou que o
primeiro robô tinha pernas. Se precisares, reescreve-o: são ~60 linhas e
poupa muito tempo de adivinhação.

---

## Créditos Meshy

Saldo a 2026-07-26: **1239**.

Gasto até agora: 74 no robô (35 dos quais desperdiçados num modelo com
pernas, por eu ter saltado a rota imagem) + 87 nos módulos do escritório.

**Usa sempre a rota imagem**: `meshy_text_to_image` (9 cr, nano-banana-pro)
→ o utilizador aprova o desenho → `meshy_multi_image_to_3d` (30 cr) com as
três vistas recortadas. Foi por saltar este passo que se perderam 35 cr.

Parâmetros que funcionaram: `ai_model: "meshy-6"`, `topology: "triangle"`,
`target_polycount: 7300` (pede 7300 para aterrar abaixo de 8000 — pedir
8000 deu 8301), `should_remesh: true`, `remove_lighting: true`, e um
`texture_prompt` a insistir em cores lisas mate sem riscos.

Os URLs de download do Meshy **expiram**. É por isso que os GLB vão
versionados em git, ao contrário do three.js em `vendor/`.

---

## Publicar

A VPS não se atualiza por `git push`. É `scp` dos ficheiros e pronto —
**não precisa de `pm2 restart`** porque são estáticos e o `express.static`
lê do disco a cada pedido. A nota do `HANDOFF.md` sobre o restart vale para
código do servidor, não para isto.

```bash
ssh root@169.58.37.101 "mkdir -p /root/ai-office/orchestrator/public/modelos"
scp orchestrator/public/office.html root@169.58.37.101:/root/ai-office/orchestrator/public/
scp orchestrator/public/modelos/*.glb root@169.58.37.101:/root/ai-office/orchestrator/public/modelos/
```

Ligação por chave `id_ed25519`, sem password. Verifica sempre com `md5sum`
nos dois lados e com um `curl` autenticado de dentro da VPS (as credenciais
leem-se do `.env` para variáveis, **sem as imprimir**).

Cópias de reversão que já estão lá:
`office.html.antes-robo-glb` (robô procedural) e `office.html.pastel`
(GLB com as cores pastel, antes das vivas).

---

## Correção pendente ao HANDOFF.md

O `HANDOFF.md` diz que o `office3d.js` é a *"cena 3D (só usada pelo
office.html)"*. **É falso e induziu-me em erro.** Nada importa o
`office3d.js` — é código morto, e a cena do `office.html` é inline com
importmap para o unpkg. Falta também listar a pasta `modelos/`.
O utilizador foi avisado e ainda não respondeu se quer a correção feita.
