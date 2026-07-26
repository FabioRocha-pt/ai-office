# Continuidade — o escritório 3D

Documento para o próximo Claude. Reescrito a 2026-07-26. O `HANDOFF.md`
da raiz continua válido para o resto do projeto; isto cobre só o
escritório 3D do `office.html`.

---

## Estado: o escritório cartoon do commit `9eb9b72`, acelerado 5×

A cena é a mesma que se via no commit `9eb9b72` — cubículos com cantos
arredondados, toon shading, contornos de desenho animado, cadeiras de
rodas, robôs lustrosos em cápsula, gato e sofá. **O aspeto é o ponto e
não se mexe nele.** O que mudou foi o custo.

Houve pelo meio uma passagem por modelos GLB do Meshy (commits `8f6773c`
e `a3c1892`) e uma reescrita low-poly. As duas foram abandonadas: a
primeira era lenta e feia de trás, a segunda era rápida mas angular.
O utilizador escolheu explicitamente este aspeto, e a tarefa passou a
ser mantê-lo a correr depressa.

### O orçamento

A regra é: **30 fps com WebGL por software**, numa máquina sem
aceleração gráfica.

| | `9eb9b72` como estava | agora |
|---|---|---|
| fps (SwiftShader) | **5.7** | **30** (com teto) |
| draw calls por desenho | 636 (duas passagens) | 224 |
| triângulos por desenho | ~125 000 | 57 504 |
| luzes | 8 | 3 |
| erros na consola | 1 | 0 |

Com o teto de 30 desligado a cena oferece ~45 fps por software, ou seja
sobra margem. Numa máquina com GPU o teto é que manda.

### Como medir — faz isto antes de entregar

```bash
# 1. servidor local sem autenticação (o carregador do .env só define
#    variáveis ainda indefinidas, por isso uma vazia ganha)
cd orchestrator && OFFICE_PASSWORD= PORT=3111 node server.js &

# 2. Chrome headless com WebGL por software — o pior caso real
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --disable-gpu --enable-unsafe-swiftshader \
  --remote-debugging-port=9333 --window-size=1600,1000 \
  --user-data-dir=/tmp/cprof about:blank &

# 3. medir (corre de orchestrator/, precisa do `ws`)
cd orchestrator && node tools/medir-cena.js http://127.0.0.1:3111/office.html 22 /tmp/cena.png
```

O `medir-cena.js` não toca na página: patcha `drawElements`,
`drawArrays`, `linkProgram` e `clear` no protótipo do contexto WebGL
**antes** de o documento carregar. Mede a cena tal como é entregue.

Devolve dois ritmos e só um conta. `fps_oferecidos` são chamadas de
`requestAnimationFrame`, o ritmo que o browser dá; `fps_desenhados` são
renders mesmo feitos, contados pelo `gl.clear`, que o three chama uma
vez por `render()`. **É o segundo que conta**, e as médias de draw calls
dividem por ele. Cuidado ao comparar com a versão antiga: com o mapa de
sombras ligado havia DUAS passagens, logo dois `clear` por frame, e os
`fps_desenhados` dela valiam metade.

O quinto argumento é JS a correr antes da captura — é como se põem
agentes em estados diferentes ou se muda o tema. Precisa de um gancho
`window.__dbg`, que **não** está no ficheiro de propósito. Mete-o
temporariamente antes do `init()` e apaga-o antes de entregar
(confirma com `grep -c __dbg office.html`):

```js
window.__dbg = { THREE, scene, camera, controls, desks, setStatus, renderer };
```

A variável de ambiente `AMPLIA="x,y,largura,altura,escala"` recorta e
amplia um pedaço da captura. **Usa-a sempre que mexeres nos contornos**:
uma linha de um píxel só se julga a 3×.

Duas armadilhas ao capturar:

- Põe `controls.enableDamping = false` **antes** de mexer na câmara. Com
  o damping ligado, o `controls.update()` do laço volta a puxá-la e a
  captura sai no sítio errado.
- Pôr um agente a `working` manda-o **atravessar a sala**, o que demora
  perto de 3 s. O `medir-cena.js` já espera 6 s depois do script.

---

## O que saiu, por ordem de peso

Nada disto se vê. Foi tudo escolhido por medição, não por palpite.

### 1. O mapa de sombras (2048², PCFSoft)

Um mapa de sombras **desenha a cena inteira outra vez**. Era metade do
trabalho por frame, sozinho.

No lugar dele há manchas suaves: um degradê radial de 64×64 num plano
(`SOMBRA_TEX`, `sombra()`), partilhado por toda a cena. A esta distância
de câmara dão o mesmo assentamento.

**O que se perdeu**, e é a única diferença que se nota comparando as
capturas a 3×: as sombras já não têm direcção. Antes caíam para o lado
oposto à luz principal e tinham a forma da peça; agora são elipses
centradas por baixo dela. Se algum dia quiseres a direcção de volta, a
mancha da secretária é filha de um grupo rodado de `angle + π`, por isso
o desvio tem de ser rodado ao contrário antes de aplicado.

### 2. Cinco PointLight de candeeiro

Cada luz é avaliada em **todos** os fragmentos da cena, não só nos que
estão perto dela. Eram cinco só para dizer "este agente está a
trabalhar", e o bolbo emissivo do candeeiro já dava esse sinal sozinho.
Saiu também o PointLight azul do holograma, cujo núcleo já é emissivo.
De oito luzes para três.

### 3. O antialias

**Custa 27.6 → 15.4 fps**, medido. Em software é dos itens mais caros
que há. Ficou desligado — mas isso partiu os contornos, ver abaixo.

### 4. Uma malha por objecto

Havia 520. As funções `fundir()` e `contornos()` juntam peças estáticas
que partilham material numa geometria só: 33 teclas passam a uma malha,
as cinco folhas da planta a outra, as cinco pernas e as cinco rodas da
cadeira a mais duas, e **todos os contornos de um posto** a uma última.
Os post-its levam a cor num atributo `color` e o material lê-a com
`vertexColors` — é o que permite juntar três cores numa malha só.

Só serve para o que não se mexe. O que roda ou se anima — cabeça,
braços, cadeira, vapor, cauda do gato — fica solto.

### 5. `MeshPhysicalMaterial` nos robôs

O Physical com `clearcoat` é o shader mais caro do three: dois lóbulos
especulares por luz e por fragmento. O `MeshPhongMaterial` dá o mesmo
brilho lustroso de brinquedo por uma fracção do preço.

**Atenção ao `specular`.** À primeira tentativa pus `0x8FA0B8` com
`shininess: 70` e o robô ficou com um brilho queimado que lhe apagava os
olhos. Os valores que passam no confronto com o original são
`shininess: 45, specular: 0x39424F` na casca e `80 / 0x4A5566` no
escuro.

### 6. Coisas pequenas

`roundedBox` memoizado (os cinco postos pedem as MESMAS doze caixas, e o
ExtrudeGeometry é caro de construir: 60 chamadas passam a 12); `seg` de
2 para 1 nos cantos; segmentos das esferas e cilindros a metade; chão e
tapete de `MeshStandardMaterial` para `MeshLambertMaterial`, que num
plano liso dá exactamente o mesmo e é o material iluminado mais barato.

---

## Sem antialias, os contornos tracejam — e como se resolve

É a armadilha desta cena. O contorno é uma casca invertida: a mesma
geometria à escala `k`, com `side: BackSide`. A banda visível tem
`tamanho × (k−1) / 2` unidades de largura.

À distância da câmara por omissão, 1 unidade do mundo dá cerca de 59
píxeis. A parede do cubículo tem 3.4 e estava a `k = 1.012` → banda de
0.020 unidades → **1.2 px**. Com antialias isso lê-se como uma linha
fina e elegante. Sem antialias, qualquer coisa abaixo de um píxel sai
**tracejada**, e foi exactamente o que aconteceu.

Os valores actuais põem as peças planas grandes acima dos dois píxeis:

| peça | antes | agora |
|---|---|---|
| parede | 1.012 | 1.018 |
| lateral | 1.012 | 1.026 |
| tampo | 1.015 | 1.023 |
| moldura do monitor | 1.03 | 1.045 |
| assento e costas da cadeira | 1.03 | 1.042 |
| sofá (assento, encosto) | 1.02 | 1.028 |
| sofá (braços) | 1.03 | 1.042 |

As peças pequenas e redondas — caneca, vaso, robô, gato, bola — **ficam
como estavam**. Nelas a linha também é fina, mas numa curva pequena o
tracejado não se lê, e engrossá-las proporcionalmente dava contornos
gordos e feios. Cheguei a duplicar tudo (`k−1` × 2) e ao perto o
escritório parecia desenhado a marcador; 1.5× é o ponto certo.

**Se mexeres nas medidas de uma peça com contorno, refaz esta conta.**

---

## O teto de fps e o modo leve

Desenha-se a 30 fps e não aos 60 que o browser oferece: os bonecos
baloiçam devagar e ninguém vê a diferença, mas o custo é metade. Com o
separador escondido não se desenha nada.

**O limiar é 29 ms, não 33.3 (=1000/30).** O `requestAnimationFrame`
chega de 16.7 em 16.7 ms com jitter, e ao pedir exactamente 33.3 há
pares de frames que dão 33.2 e são recusados — o desenho seguinte só vem
ao terceiro e o ritmo real mede **18.7 fps**. A folga tem de caber num
frame inteiro; qualquer valor entre 17 e 33 dá 30 certos.

Duas animações contavam frames e não segundos, e tiveram de duplicar de
passo para andarem à mesma velocidade a 30 fps: o `screenTex.offset.y` do
código no ecrã, e o limite do `dt` (de .05 para .12, senão o robô
andaria devagar no modo leve, que corre a 20).

Se os primeiros 4 s não chegarem a 24 fps, a cena cai para **modo
leve**: resolução a 70%, 20 fps, grelha e vapor fora. Testa-o
estrangulando a CPU pelo CDP (`Emulation.setCPUThrottlingRate`,
`rate: 20`) e confirmando que `canvas.width / canvas.clientWidth` dá
0.70.

A bandeira `vigiaFeito` não é acessória: sem ela, uma máquina rápida
passava no teste, o relógio continuava a andar, a condição do tempo
voltava a dar verdadeira no frame seguinte com o contador zerado, e
despromovia justamente quem não precisava.

Não se usa `WEBGL_debug_renderer_info` para detectar software: o Chrome
esconde-a em muitas configurações. O vigia mede o que interessa.

---

## O que o código controla e não se pode perder

O `buildDesk()` devolve um objeto cujos campos são lidos pelo `tick()` e
pelo `setStatus()`. Se mexeres na mobília, mantém estas referências:

| Referência | Quem a usa | Para quê |
|---|---|---|
| `d.screen` | `setStatus` | `material.emissive` + `emissiveIntensity` |
| `d.lamp` | `setStatus` | cor e emissivo do bolbo por estado |
| `anim.screenTex` | `tick` | `offset.y` desce → código a correr |
| `anim.cadeira` | `tick` | `rotation.y` oscila |
| `anim.cabeca`, `anim.bracos` | `tick` | pose do robô |
| `anim.olhos` | `tick` | `scale.y` → piscar |
| `anim.bolbo` | `setStatus` | aponta para a ANTENA do robô |
| `anim.anel` | `tick` | opacidade do anel de flutuação |
| `anim.sombra` | `tick` | desconta o salto para ficar no chão |
| `anim.steam`, `anim.folhas` | `tick` | vapor do café, planta a baloiçar |
| `anim.ancora` | `posicionarPins` | âncora da etiqueta HTML, y = 2.05 |
| `d.lugar`, `d.slot` | `tick` | destino a trabalhar / a brincar |
| `userData.agentId` | raycast | clicar num posto abre a ficha |

**`anim.folhas` mudou de significado.** Era um array de cinco folhas que
baloiçavam cada uma por si; agora é uma malha só com a planta inteira, e
baloiça toda ao mesmo tempo. Para o baloiço rodar no sítio certo, as
folhas nascem à volta da ORIGEM e é a malha que vai para cima do vaso —
fundidas nas coordenadas antigas, rodavam à volta do centro do posto e a
planta varria a secretária.

---

## Medidas da cena

```
R = 7.4                 raio do arco de secretárias
spread = π · 0.86       abertura 154.8°, 5 postos
ângulos = -77.4, -38.7, 0, 38.7, 77.4 graus

posto i:  g.position = (sin θ · 7.4, 0, cos θ · 7.4)
          g.rotation.y = θ + π       → o local +z olha o centro da sala
robô a trabalhar: raio 7.4 − 1.12 = 6.28, mesmo ângulo
lounge: z = −7.2 (lado oposto do arco)

chão: círculo raio 24   tapete central: raio 5.2   grelha 48 × 48
nevoeiro: 34 a 70
câmara: perspetiva 42°, em (−2, 13, 19.5), alvo (0, 1.3, −0.6)
OrbitControls: azimute LIVRE (360°), maxPolarAngle π/2.2, distância 7 a 34
```

O robô vive na **cena** e não no grupo do posto: tem de atravessar a
sala até ao lounge, e um filho de um grupo rodado não anda em linha
recta pelo mundo. O posto limita-se a dizer-lhe qual é o seu lugar.

---

## Coisas que já custaram tempo

### `pintarCena` não sabe do CSS

`pintarCena(tema)` no fim do ficheiro repinta fundo, nevoeiro, chão e
tapete — são do WebGL, não do CSS. **Se acrescentares um objecto grande,
tem de entrar lá.** O Chrome headless pede tema escuro por omissão, o
que explica capturas escuras sem se ter pedido nada.

Nota: a grelha fica clara no tema escuro. É assim desde sempre e lê-se
bem, por isso ficou. Se alguma vez a quiseres pintar, atenção: o
`GridHelper` cozinha as cores no atributo `color` da geometria e liga
`vertexColors`, por isso `material.color` não pinta — **multiplica**.
Com as linhas claras que ele tem, pôr-lhe uma cor escura faz a grelha
desaparecer.

### O `mergeGeometries` recusa misturar indexação

O `roundedBox()` sai do ExtrudeGeometry, que vem **sem** índice; as
esferas e cilindros vêm **com** ele. Misturados, o merge devolvia `null`
e a peça desaparecia da cena sem erro nenhum. O `juntarGeos()` normaliza
antes de juntar — não lhe tires isso.

### Ao fundir contornos, a escala tem de ser achatada primeiro

O contorno é a geometria à escala `k`. Ao fundir vários, a escala tem de
entrar na geometria de cada um **antes** da junção, senão perde-se e os
contornos colapsam para dentro das peças. É o que o `contornos()` faz.

### Os clones de textura partilham a imagem na GPU

Os cinco ecrãs recebem um `SCREEN_TEX.clone()` para deslizarem a ritmos
diferentes, mas o three indexa os envios pela `texture.source` e o
`offset` é um uniforme. Sai barato — não tentes partilhar a textura
para "optimizar", não ganhas nada e perdes o ritmo por agente.

---

## Os GLB do Meshy, que já não são usados

`orchestrator/public/modelos/` tem 6.8 MB em três ficheiros —
`robo.glb`, `gabinete.glb`, `lounge.glb` — que **nada carrega**. Ficam
versionados porque os URLs de download do Meshy expiram e regerá-los
custa créditos.

Saldo Meshy a 2026-07-26: **1239**. Gasto: 74 no robô (35 dos quais
desperdiçados num modelo com pernas, por se ter saltado a rota imagem)
+ 87 nos módulos do escritório.

Se algum dia voltares a gerar modelos:

- **Usa sempre a rota imagem**: `meshy_text_to_image` (9 cr,
  nano-banana-pro) → o utilizador aprova o desenho →
  `meshy_multi_image_to_3d` (30 cr) com as três vistas recortadas. Foi
  por saltar este passo que se perderam 35 cr.
- Parâmetros que funcionaram: `ai_model: "meshy-6"`, `topology:
  "triangle"`, `target_polycount: 7300` (pede 7300 para aterrar abaixo
  de 8000 — pedir 8000 deu 8301), `should_remesh: true`,
  `remove_lighting: true`, e um `texture_prompt` a insistir em cores
  lisas mate sem riscos.
- O gerador escreve rótulos "FRONT/SIDE/BACK" na imagem apesar de se
  pedir sem texto. O recorte tem de agrupar as linhas contíguas de
  conteúdo e ficar só com a maior, senão as letras entram no recorte.

E o aviso que interessa mais: **7 300 triângulos por módulo, vezes dez
módulos, não cabem numa cena que tem de correr sem GPU** — e mesmo
que coubessem, o utilizador achou o resultado pior do que o cartoon
procedural que já cá estava. Um modelo do Meshy serve para uma peça em
destaque, não para mobília repetida cinco vezes.

---

## Publicar

A VPS não se atualiza por `git push`. É `scp` do ficheiro e pronto —
**não precisa de `pm2 restart`** porque é estático e o `express.static`
lê do disco a cada pedido. A nota do `HANDOFF.md` sobre o restart vale
para código do servidor, não para isto.

```bash
scp orchestrator/public/office.html root@169.58.37.101:/root/ai-office/orchestrator/public/
```

Ligação por chave `id_ed25519`, sem password. Verifica sempre com
`md5sum` nos dois lados e com um `curl` autenticado de dentro da VPS (as
credenciais leem-se do `.env` para variáveis, **sem as imprimir**).

Cópias de reversão que já estão na VPS:

| ficheiro | o que é |
|---|---|
| `office.html.glb-meshy` | cápsulas e robôs em GLB do Meshy |
| `office.html.antes-gabinetes` | robô em GLB, secretárias procedurais |
| `office.html.pastel` | GLB com as cores pastel |
| `office.html.antes-robo-glb` | o cartoon do `9eb9b72`, antes de acelerado |
