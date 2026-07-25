# Continuidade — para a próxima sessão

Documento para quem continuar este projeto. Escrito no fim de uma sessão
longa, com o que custou a descobrir e o que vem a seguir.

**Estado:** a funcionar em produção numa VPS Contabo, publicado em
`github.com/FabioRocha-pt/ai-office`. O utilizador é o Fábio, fala
português de Portugal, e o código e comentários estão todos em português.

**Próxima tarefa:** suporte a Next.js. Plano concreto no fim deste ficheiro.

---

## O que isto é

Cinco agentes de IA (CEO, CTO, Designer, Developer, QA) que constroem
plataformas de software sozinhos. Cada um corre uma CLI diferente
(Claude Code, Codex, Antigravity), em cadeia, partilhando uma pasta de
projeto. Controlado por um escritório 3D no browser e por uma app Android
no ecrã exterior de um Galaxy Z Flip 6, por voz.

Funciona mesmo: já produziu uma lista de tarefas e um gestor de tarefas
estilo Jira, ambos utilizáveis.

---

## Regras de trabalho com este utilizador

- **Responde em português de Portugal.** Não brasileiro.
- **Comenta o código em português**, e explica o *porquê*, não o *quê*.
- **Verifica antes de afirmar.** Várias suposições minhas sobre flags de
  CLIs estavam erradas e custaram tempo. Corre o comando, lê o `--help`,
  confirma.
- **Empacota sempre em zip** e apresenta com `present_files`. O fluxo dele
  é `scp` → `unzip -o` → `pm2 restart`.
- **Distingue o que precisa de recompilar o APK.** Mudanças em
  `orchestrator/public/` são web e chegam com um restart. Só código Kotlin
  em `android/` exige rebuild.
- Ele testa tudo de imediato e manda fotos do telemóvel. Espera correções
  rápidas em vez de grandes entregas.

---

## Arquitetura, em resumo

```
orchestrator/
  server.js          API REST + WebSocket. Sem autenticação (ver Riscos).
  agents/
    roles.js         personas dos cinco agentes
    assignments.js   que CLI corre cada agente (persistente, editável na UI)
    models.js        escalões de modelo por complexidade
    pipeline.js      a cadeia; runAgents() serve projetos novos e revisões
    runner.js        spawn das CLIs, permissões, timeouts, limpeza de output
    vault.js         projetos, metadados, estatísticas, deteção de entrada
    preview.js       servir plataformas construídas
  public/
    office.html      escritório 3D (Three.js) — ecrã grande
    flip.html        app do Z Flip: robôs 2D + voz + vault + config
    robots.js        os cinco robôs em SVG animado
    office3d.js      cena 3D (só usada pelo office.html)
    vault.html       plataformas: abrir, corrigir, apagar
    graphs.html      estatísticas em SVG feito à mão
    index.html       primeira interface, mantida
android/             app Android: WebView + reconhecimento de voz nativo
deploy/              setup-vps.sh, build-apk.sh, fetch-vendor.sh
```

Fora do repositório (gerados, no `.gitignore`): `vault/`,
`assignments.json`, `models.json`, `node_modules/`, `public/vendor/`.

---

## O que custou a descobrir

Cada um destes gastou tempo real. Não os desfaças sem perceber porquê.

### CLIs

**O Gemini CLI morreu.** A Google descontinuou o Gemini Code Assist para
contas individuais e redirecionou para o Antigravity. O binário é `agy`,
instala-se com `curl -fsSL https://antigravity.google/cli/install.sh | bash`,
e tem `-p` como o Claude Code.

**O `agy` instala em `~/.local/bin`**, que o pm2 não tem no PATH. O
`runner.js` injeta esse caminho no ambiente do processo filho. Se tirares
isso, o Designer deixa de funcionar sem erro claro.

**O Codex recusa correr fora de um repo git.** Daí o `git init` automático
em cada workspace e o `--skip-git-repo-check` como rede de segurança.

**O Codex corre em `read-only` por omissão.** Sem `-s workspace-write` não
escreve nada e ninguém percebe porquê.

**O Codex ecoa o prompt inteiro** (incluindo a persona) antes de responder.
O `cleanOutput` e o filtro de streaming cortam isso. Sem eles, o painel
enche-se com as próprias instruções.

**O stdin tem de ser fechado** (`stdio: ["ignore","pipe","pipe"]`). Com o
stdin aberto, as CLIs esperam 3 segundos por input que nunca vem — e o
Codex bloqueia indefinidamente.

**O Claude Code precisa de `--permission-mode acceptEdits` E de uma lista
de comandos permitidos** em `.claude/settings.json` (gerada
automaticamente pelo `runner.js`). Sem a lista, em modo headless qualquer
comando é auto-recusado com uma mensagem sobre "jetski" que não ajuda nada.
O `curl` e o `wget` ficam de fora de propósito.

**Login do Codex numa máquina sem browser** exige túnel SSH:
`ssh -L 1455:localhost:1455 root@IP`.

### App Android

**`webkitSpeechRecognition` não existe dentro de um WebView.** É a razão de
ser do APK: usa o `SpeechRecognizer` nativo ligado ao JS por
`addJavascriptInterface`. Se alguém "simplificar" isto para um WebView
puro, a voz morre.

**`useWideViewPort` e `loadWithOverviewMode` a `true` partem o layout.** A
página já traz `meta viewport`; com estes ligados o WebView reescala tudo.
Foi provavelmente a causa do primeiro ecrã preto.

**Falhas têm de ser visíveis.** Há uma sobreposição nativa que mostra o erro
e um botão para mudar o endereço. Sem isso, qualquer problema dá ecrã preto
sem explicação.

**Não consigo compilar APKs no sandbox** — `dl.google.com`,
`repo1.maven.org` e `services.gradle.org` estão bloqueados. O
`deploy/build-apk.sh` compila na VPS, que não tem essas restrições.

### Ecrã exterior do Z Flip 6

~360×374 px CSS. AMOLED (preto puro poupa bateria). **As lentes das câmaras
ficam no canto inferior esquerdo** — não pôr lá nada crítico. Há uma barra
de navegação do sistema em baixo.

Os robôs são SVG animado com CSS, não WebGL: 4,9 KB contra 660 KB, e as
animações correm no compositor sem tocar no JavaScript.

### Um erro meu que vale a pena conhecer

A meio da sessão refatorizei o `pipeline.js` para suportar revisões e
**destruí sem querer** funcionalidade que já existia: as atribuições de CLI
deixaram de ser respeitadas, os modelos por complexidade desapareceram, e
perdeu-se o portão de entrega. Só dei por isso porque fui verificar os
endpoints.

Se refatorizares o pipeline, compara com a versão anterior antes de
substituir. As peças que têm de sobreviver:

- `assignments.effectiveRole(id, cliMap)` — CLI por agente
- `models.tierFor()` / `models.modelFor()` — modelo por complexidade
- o **portão de entrega**: se o Developer acaba e `detectEntry()` devolve
  `none`, repete-se a etapa uma vez com modelo mais forte
- estado final: `done` só se houver ponto de entrada; senão `incomplete`

---

## Riscos conhecidos

**Não há autenticação nenhuma.** Quem souber o endereço pode construir, ler
o código produzido, apagar o vault e queimar a quota das três subscrições.
Já foi levantado várias vezes; o utilizador optou por adiar. Se ele voltar
ao assunto: Nginx com HTTP Basic + Let's Encrypt resolve em meia hora.

**Os agentes correm como root.**

**Timeout de 10 minutos por agente.** Suficiente para escrever código, não
para instalar dependências (ver plano abaixo).

**O QA não tem browser.** Testa lógica, não aparência.

---

## Próxima tarefa: suporte a Next.js

O objetivo do utilizador é sair do "HTML/CSS/JS puro" para plataformas
premium com frameworks. Ele mencionou também Sanity e Flutter — a
recomendação foi começar pelo Next.js, e ele concordou implicitamente ao
pedir este documento.

### A ideia central

**`output: 'export'`.** Um Next.js exportado produz HTML estático em `out/`,
que o `preview.js` já sabe servir — sem portas, sem processo por projeto,
sem memória. Para sites de marketing e portfólios é o encaixe perfeito.

Só apps com rotas de API ou SSR usariam o caminho da porta, que já existe
no `preview.js` para `package.json` com script `start`.

### O que é preciso construir

**1. Templates de stack** (`stacks/`)

O CTO inventa a arquitetura de cada vez. Com HTML puro isso funciona; com
Next.js dá projetos incoerentes. Criar scaffolds prontos:

```
stacks/
  estatico/          o que existe hoje (HTML/CSS/JS)
  nextjs-export/     Next.js + Tailwind + output:'export'
  nextjs-server/     Next.js com rotas de API
```

O CTO passa a **escolher** um destes em vez de inventar, e escreve a
escolha em `ARQUITETURA.md`. O scaffold é copiado para a pasta do projeto
antes do Designer começar.

**2. Etapa de build**

Nova etapa entre o Developer e o QA, no `pipeline.js`. Não é um agente —
é um passo mecânico que corre `npm install` e `npm run build`, transmite o
output pelo WebSocket como se fosse um agente, e falha de forma visível.

Se falhar, o Developer devia receber o erro de build e ter uma segunda
tentativa (o mesmo padrão do portão de entrega, que já existe).

**3. `detectEntry()` tem de conhecer o Next.js**

Em `vault.js`, acrescentar `out/index.html` à lista de candidatos estáticos,
antes de `public/index.html`. E reconhecer `.next/` como sinal de projeto
Next.js por construir.

**4. Timeouts diferenciados**

`AGENT_TIMEOUT_MS` são 10 minutos e chega para escrever código. A etapa de
build precisa dos seus próprios 15-20 minutos — `npm install` de um Next.js
leva 1-3 minutos e o build mais um par.

**5. Disco**

Cada projeto Next.js são 300-500 MB de `node_modules`. Com export estático,
depois do build já não fazem falta: apagar `node_modules` no fim liberta
quase tudo e o `out/` continua a servir. Em alternativa, pnpm com store
partilhado.

Convém verificar o espaço livre na VPS antes de assumir que dá.

**6. Personas**

O CTO precisa de saber que stacks existem e que critérios usar para
escolher. O Developer precisa de saber que não deve inventar estrutura
quando há scaffold. O Designer passa a produzir componentes React e
`tailwind.config` em vez de CSS solto.

### Depois disso

**Sanity** esbarra em credenciais: um projeto Sanity vive na plataforma
deles e precisa de project ID e token. Ou o utilizador cria à mão e põe o
ID num config, ou os agentes só geram os schemas e ele liga depois. Dar um
token com poderes a um servidor que ainda não tem password é má ideia —
vale a pena fazer a autenticação primeiro.

**Flutter** foi desaconselhado e o utilizador não insistiu: SDK de 2 GB,
builds de 5-15 minutos, **sem preview no browser** (o output é um APK para
instalar), e o QA fica cego porque não há emulador numa VPS. O ciclo de
feedback passaria de 20 segundos para dezenas de minutos. Se ele quiser
mobile, PWA em Next.js dá quase tudo sem perder o preview.

---

## Onde as coisas estão

- **VPS:** Contabo, Ubuntu, `/root/ai-office`, orchestrator na porta 3000
  gerido por pm2 (`pm2 logs ai-office` para diagnosticar)
- **Vault:** `/root/ai-office/vault/<slug>/`, cada projeto com git próprio
- **GitHub:** `github.com/FabioRocha-pt/ai-office`, push por chave SSH
- **APK:** compilado na VPS com `deploy/build-apk.sh`, servido em
  `/download/consultoria.apk`
- **Modelos e atribuições:** `models.json` e `assignments.json` na raiz,
  fora do repositório
