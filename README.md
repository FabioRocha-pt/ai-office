# AI Office

Uma consultoria de software com cinco agentes de IA que constrói plataformas
sozinha, alojada num VPS e controlada a partir do ecrã exterior de um
Galaxy Z Flip — por voz.

Ditas *"quero uma app de lista de tarefas"*, e cinco agentes distribuídos por
três CLIs diferentes planeiam, escolhem a stack, desenham, implementam e
testam. O resultado fica num vault, pronto a abrir no browser.

---

## A equipa

| Agente | CLI (por omissão) | O que faz |
|---|---|---|
| **CEO** | Codex | Decompõe o pedido, distribui tarefas, mantém `PLANO.md` |
| **CTO** | Claude Code | Escolhe a stack e a arquitetura, escreve `ARQUITETURA.md` |
| **Designer** | Antigravity | Produz paleta, tipografia, CSS e SVG em `design/` |
| **Developer** | Claude Code | Implementa seguindo o CTO e o Designer |
| **QA Tester** | Codex | Testa, procura casos-limite, escreve `QA.md` |

Correm em cadeia, um de cada vez, e **partilham a mesma pasta de projeto** —
é isso que permite ao Developer usar o design do Designer e ao QA testar o
que o Developer construiu. Cada etapa deixa um commit.

A atribuição de CLI é trocável em tempo real, sem reiniciar nada: quando os
créditos de uma acabam, passas esse agente para outra.

---

## Interfaces

| Página | Para quê |
|---|---|
| `/office.html` | Escritório 3D em ecrã grande, com painel de estado e consola |
| `/vault.html` | Plataformas construídas: abrir, corrigir, apagar |
| `/graphs.html` | Ritmo de produção, commits por agente, tempo por etapa |
| `/flip.html` | Ecrã exterior do Z Flip: escritório em miniatura + voz |
| `/` | Quadro de pessoal (a primeira versão, mantida) |

Há também uma **app Android** (`android/`) que embrulha o `/flip.html` e
acrescenta reconhecimento de voz nativo — necessário porque a Web Speech API
não existe dentro de um WebView.

---

## Requisitos

- Ubuntu 22.04 ou 24.04 (testado num Contabo Cloud VPS 4)
- Node.js 20+
- Contas com subscrição em pelo menos uma de: Claude, ChatGPT, Google

**Não são precisas API keys.** As três CLIs autenticam com login de
subscrição, não com billing por token.

---

## Instalação

```bash
git clone https://github.com/FabioRocha-pt/ai-office.git
cd ai-office

# Node, pm2, nginx, ufw e as três CLIs
sudo ./deploy/setup-vps.sh

# Three.js servido localmente (660 KB, não versionado)
./deploy/fetch-vendor.sh
```

Autentica cada CLI uma vez, interativamente:

```bash
claude    # conta Claude
codex     # conta ChatGPT — precisa de túnel SSH, ver Notas
agy       # conta Google
```

Confirma que respondem em modo não-interativo:

```bash
claude -p "diz olá"
agy -p "diz olá"
codex exec --skip-git-repo-check "diz olá"
```

Arranca:

```bash
cd orchestrator
npm install
pm2 start server.js --name ai-office
pm2 save
```

Abre `http://O_TEU_IP:3000`.

### App Android (opcional)

```bash
./deploy/build-apk.sh
```

Descarrega o SDK Android e o Gradle (~3 GB à primeira vez, ~10 min) e
publica o APK em `/download/consultoria.apk`, para instalares pelo browser
do telemóvel. Em alternativa, o workflow em `.github/workflows/build-apk.yml`
compila-o no GitHub Actions.

---

## Como funciona

```
Briefing
   │
   ▼
┌─────────────────────────────────────────┐
│  orchestrator (Node + Express + ws)     │
│                                         │
│  pipeline.js ── escolhe CLI e modelo    │
│       │         em função da            │
│       │         complexidade            │
│       ▼                                 │
│  runner.js ──── spawn da CLI numa       │
│                 pasta isolada           │
└─────────────────────────────────────────┘
   │                          │
   ▼                          ▼
vault/<projeto>/         WebSocket
  .git/                  (estado ao vivo
  .aioffice.json          para as interfaces)
  ...ficheiros
```

**Complexidade e modelos.** Cada projeto é classificado (`simples`, `medio`,
`complexo`) e cada agente recebe um escalão de modelo em função disso e do
peso da sua função. Usar o modelo mais caro para mudar a cor de um botão
gasta a quota de quem constrói. Os nomes dos modelos vivem em `models.json`,
editável, porque mudam depressa e dependem do plano.

**Portão de entrega.** Se o Developer termina e a pasta continua sem ponto de
entrada, é mandado de volta uma vez, com instrução específica e um modelo mais
forte. Sem isto, projetos onde ninguém rebentou mas nada foi entregue apareciam
como "concluídos".

**Permissões.** Os agentes escrevem ficheiros mas só correm comandos de uma
lista (`.claude/settings.json`, gerado automaticamente): ler, procurar, `git`,
`node`, `npm`, `python3`. O `curl` e o `wget` ficam de fora de propósito —
permitiriam enviar ficheiros para fora ou descarregar e correr scripts.

---

## ⚠️ Segurança

**O orchestrator não tem autenticação nenhuma.** Quem souber o endereço pode
mandar construir, ler o código produzido, apagar o vault e queimar a quota
das tuas subscrições.

Se o expuseres à internet, põe autenticação à frente. O mínimo aceitável é
Nginx com HTTP Basic e HTTPS via Let's Encrypt. Enquanto isso não existir,
restringe por firewall:

```bash
ufw allow from O_TEU_IP to any port 3000
```

Os agentes correm como `root` na configuração atual. Vale a pena passá-los
para um utilizador sem privilégios.

---

## Notas

**Login do Codex numa máquina sem browser.** O `codex login` abre um servidor
local à espera do callback OAuth. Como abres o link noutro computador, o
`localhost` não bate certo. Túnel SSH resolve:

```bash
ssh -L 1455:localhost:1455 root@O_TEU_IP
```

**Gemini CLI.** A Google descontinuou o Gemini Code Assist para contas
individuais e redirecionou para o Antigravity. O binário passou a ser `agy`,
e instala em `~/.local/bin` — que o pm2 não vê por omissão. O `runner.js`
injeta esse caminho no PATH do processo filho.

**Limites conhecidos.** Timeout de 10 minutos por agente. O QA corre sem
browser, por isso testa lógica e não aparência. A configuração está afinada
para projetos estáticos — backend a sério exige mais trabalho. E o conteúdo
real (textos, imagens, o logótipo do cliente) continua a ser trabalho humano.

---

## Estrutura

```
orchestrator/
  server.js              API REST + WebSocket
  agents/
    roles.js             personas dos cinco agentes
    assignments.js       que CLI corre cada agente
    models.js            escalões de modelo por complexidade
    pipeline.js          a cadeia, de raiz ou em revisão
    runner.js            spawn das CLIs, permissões, timeouts
    vault.js             projetos, metadados, estatísticas
    preview.js           servir plataformas construídas
  public/                as cinco interfaces
android/                 app Android (WebView + voz nativa)
deploy/
  setup-vps.sh           instalação de raiz
  fetch-vendor.sh        Three.js local
  build-apk.sh           compilar o APK na VPS
```

---

## Continuidade

O [HANDOFF.md](HANDOFF.md) tem o contexto completo do projeto: decisões de
arquitetura e o porquê delas, as armadilhas que custaram tempo a descobrir
(flags de CLIs, comportamento do WebView, limites do ecrã exterior), e o
plano detalhado da próxima funcionalidade. Vale a pena lê-lo antes de mexer
no `pipeline.js` ou no `runner.js`.

## Licença

MIT — ver [LICENSE](LICENSE).
