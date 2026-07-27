# Continuidade — para a próxima sessão

Documento para quem continuar este projeto. Escrito no fim de uma sessão
longa, com o que custou a descobrir e o que vem a seguir.

**Estado:** a funcionar em produção numa VPS Contabo, publicado em
`github.com/FabioRocha-pt/ai-office`. O utilizador é o Fábio, fala
português de Portugal, e o código e comentários estão todos em português.

**Próxima tarefa:** Sanity e mobile. O suporte a stacks/Next.js está FEITO —
ver secção «Stacks» abaixo.

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
    office.html      escritório 3D (Three.js inline) — ecrã grande
    flip.html        app do Z Flip: robôs 2D + voz + vault + config
    robots.js        os cinco robôs em SVG animado
    office3d.js      CÓDIGO MORTO — nada o importa (ver abaixo)
    vault.html       plataformas: abrir, corrigir, apagar
    graphs.html      estatísticas em SVG feito à mão
    index.html       primeira interface, mantida
    modelos/*.glb    modelos do Meshy, JÁ NÃO USADOS (ver abaixo)
android/             app Android em Jetpack Compose (WebView só no preview)

android/             app Android: WebView + reconhecimento de voz nativo
deploy/              setup-vps.sh, build-apk.sh, fetch-vendor.sh
```

Fora do repositório (gerados, no `.gitignore`): `vault/`,
`assignments.json`, `models.json`, `node_modules/`, `public/vendor/`.

Duas armadilhas nesta árvore, ambas verificadas com `grep`:

- **`office3d.js` não é a cena do `office.html`.** Esta linha já disse
  isso e induziu em erro pelo menos uma sessão. É a cena em miniatura
  que se escreveu para a Flex Window do Z Flip, e neste momento nada a
  importa — a cena do `office.html` é inline, com importmap para o
  unpkg. Apaga-o ou liga-o ao `flip.html`, mas não o edites à espera de
  mexer no escritório grande.
- **`public/modelos/*.glb` já não são carregados.** São 6.8 MB de robô e
  mobiliário gerados no Meshy que o escritório usou durante 2026-07-26 e
  deixou de usar quando se voltou ao escritório cartoon procedural.
  Ficam versionados porque os URLs de download do Meshy expiram e
  regerá-los custa créditos. Ver `CONTINUIDADE-ESCRITORIO.md`.

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

---

## Stacks (feito)

O CTO deixou de inventar arquitetura: escolhe de um catálogo fechado em
`agents/stacks.js`. Cada entrada traz os ficheiros do scaffold, os comandos
de build, o que conta como entrega e os segredos que precisa.

Existem hoje: `estatico` (o de sempre, por omissão), `nextjs-export`
(exportado para `out/`), `nextjs-server` (rotas de API) e
`nextjs-pagamentos` (Stripe Checkout).

Peças novas:

- `agents/stacks.js` — catálogo e scaffolding. Acrescentar uma stack é uma
  entrada aqui; o pipeline não precisa de saber que ela existe.
- `agents/build.js` — etapa mecânica entre Developer e QA. `npm install` +
  `npm run build`, timeout próprio de 20 min, e **recusa começar com menos
  de 2 GB livres** em vez de encher o disco a meio.
- `pipeline.js` — scaffold antes do primeiro agente; build depois do
  Developer; se o build falhar, o Developer recebe o erro do compilador e
  tem uma segunda tentativa, e só depois se desiste.
- `vault.js` — `detectEntry()` procura `out/index.html` primeiro, e
  distingue `porconstruir` (há package.json com build mas nada compilado)
  de `none`.
- `GET /stacks` — catálogo, espaço em disco e se os segredos existem.
  `POST /pipeline` aceita `stack`.

Verificado a sério: o scaffold `nextjs-export` instala (99 pacotes, 20 s) e
compila (Next 14.2.35), produzindo `out/index.html`. Os `node_modules` são
259 MB e o `out/` 768 KB — daí apagarem-se automaticamente no fim das
stacks de export (`limparNodeModules: true`). Nas stacks com servidor NÃO
se apagam, senão o `npm start` deixa de arrancar.

### Cuidados

- Versões **fixadas** de propósito no scaffold. Tailwind fica no 3.x: o 4
  mudou a configuração e deixaria de bater certo com o `tailwind.config.js`.
- Chaves do Stripe vêm do ambiente do orchestrator, nunca do repositório do
  projeto. Sem elas a plataforma compila na mesma e o checkout responde 503
  com mensagem clara.
- Os preços estão em **cêntimos** no `config/produtos.js`. O Stripe trabalha
  na unidade mínima da moeda e usar euros com vírgula flutuante dá erros de
  arredondamento reais em faturação.

## Plano original do Next.js (cumprido — mantido por contexto)

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

---

## D.A.I.S.Y. — biometria no telemóvel (servidor FEITO, app por ligar)

O nome: Margarida = daisy. Em 1961 um IBM 704 nos Bell Labs cantou
"Daisy Bell", a primeira sintese de voz de uma musica por computador —
e e por isso que o HAL 9000 a canta enquanto morre.

### O que a biometria faz e nao faz

A impressao digital NAO autentica no servidor e nunca sai do telemovel.
Ela desbloqueia uma chave AES no Keystore do Android, e essa chave
decifra um token de acesso. O servidor so ve o token. Por isso a
revogacao nao e um extra: e o unico recurso se o telemovel se perder.

### Servidor (feito e testado)

- `POST /auth/token` — Basic obrigatorio, devolve um token de 180 dias.
  Um token NAO pode gerar outro token: senao um telemovel roubado
  multiplicava-se e a revogacao deixava de valer. Travao de 5 tentativas
  por 15 minutos.
- `GET /auth/devices` — lista com etiqueta, criado, ultimo uso.
- `POST /auth/devices/:id/revogar` — corta o acesso na hora.
- `agents/auth.js` aceita o token por `Authorization: Bearer` OU pelo
  cookie `office_sess` (o WebView do Android nao deixa por cabecalhos em
  todos os pedidos, mas deixa por cookie).
- `dispositivos.json` guarda apenas METADADOS. O token nunca e gravado:
  quem ler o ficheiro nao consegue entrar com o que la esta.

Testado: emparelhar sem credenciais da 401; com credenciais devolve
token; o token funciona como Bearer e como cookie; depois de revogado
da 401.

### App (falta ligar)

`android/.../BiometricAuth.kt` esta escrito e comentado. Faz:
`disponivel()`, `motivoIndisponivel()`, `temTokenGuardado()`,
`guardar(activity, token, cb)`, `desbloquear(activity, cb)`,
`esquecer(ctx)`.

Dependencia ja adicionada: `androidx.biometric:biometric:1.1.0`.
`AppCompatActivity` ja estende `FragmentActivity`, que e o que o
BiometricPrompt exige — nao ha nada a mudar na hierarquia.

Falta no MainActivity.kt:

1. No arranque: se `temTokenGuardado()` -> `desbloquear()`; senao
   mostrar o ecra de credenciais.
2. Depois de obter o token do `/auth/token`, chamar `guardar()`.
3. Com o token em mao, po-lo no CookieManager antes de carregar o
   WebView:
   `CookieManager.getInstance().setCookie(baseUrl, "office_sess=$token; Path=/")`
   e `CookieManager.getInstance().flush()`.
4. Se o servidor devolver 401, chamar `esquecer()` e voltar ao ecra de
   credenciais.

### Cuidados

- `setInvalidatedByBiometricEnrollment(true)`: registar uma impressao
  digital nova invalida a chave DE PROPOSITO. Sem isto, quem tivesse o
  telemovel desbloqueado podia adicionar o proprio dedo e entrar. Quando
  isso acontece, a app pede as credenciais outra vez — nao e bug.
- So `BIOMETRIC_STRONG`. Aceitar credenciais do aparelho (PIN) faz o
  CryptoObject deixar de funcionar.
- `setUserAuthenticationParameters(0, ...)`: autenticacao a CADA uso.

### Nao alterado de proposito

O package Java continua `com.bonako.aioffice`. Mudar o package altera
caminhos, gradle e assinatura do APK — instalacoes existentes deixariam
de atualizar e passariam a aparecer duas apps. O nome visivel ja e
D.A.I.S.Y. (strings.xml). Se quiseres mudar mesmo o package, e uma
tarefa a fazer isolada, com a keystore de assinatura a mao.

---

## App nativa D.A.I.S.Y. (reescrita)

O ecra preto tinha duas causas, ambas fechadas:

1. **401 em silencio.** Com a autenticacao ligada, o WebView recebia 401
   e nao mostrava nada. Pior: num 401 com WWW-Authenticate o WebView
   chama `onReceivedHttpAuthRequest` e a implementacao por omissao
   CANCELA SEM DIZER NADA (isto ja estava documentado no Sessao.kt).
2. **Nenhum caminho de erro tinha UI.** Falha de rede, servidor em
   baixo, token revogado — tudo dava o mesmo ecra escuro.

Regra nova: NUNCA um ecra preto sem explicacao. Todos os caminhos de
falha acabam num painel nativo com o motivo e dois botoes ("Tentar outra
vez" e "Introduzir credenciais").

### Ficheiros

- `DaisyBootView.kt` — arranque desenhado em Canvas: 12 petalas que
  abrem com atraso proprio, dois aneis a rodar em sentidos opostos,
  varrimento tipo radar, miolo com estames, nome a compor-se letra a
  letra, log e barra de progresso REAL (reflete o estado da
  autenticacao, nao e decorativa). Nativo de proposito: tem de aparecer
  antes de existir ligacao ao servidor.
- `MainActivity.kt` — reescrito. Maquina de estados: arranque ->
  biometria ou credenciais -> cookie -> WebView. UI construida em codigo
  em vez de XML (nao ha layouts para desalinhar com IDs).
- `BiometricAuth.kt` — Keystore + BiometricPrompt (ja existia).
- `Sessao.kt` — emparelhamento e cookie (ja existia; o MainActivity usa
  este e nao uma copia).
- `res/drawable/daisy_logo.xml` e `ic_launcher_foreground.xml` — vetor:
  margarida e diafragma de lente ao mesmo tempo.
- Tema: `windowBackground` igual ao fundo do arranque, para nao haver o
  clarao branco de um frame antes de a activity desenhar.

### VPS fixa

`MainActivity.URL_PADRAO = "http://169.58.37.101:3000"`, editavel no
painel de credenciais e guardado em SharedPreferences.

### Nao verificado

NAO consigo compilar Android aqui (sem SDK). Verifiquei: equilibrio de
chaves e parenteses, referencias cruzadas entre os quatro ficheiros
Kotlin, e XML valido nos recursos. O compilador do GitHub Actions e que
tem a palavra final — o artefacto passou a chamar-se `daisy-apk`.

### Primeiro arranque esperado

1. Animacao ~2,3s (minimo garantido, para nao ser engolida).
2. Painel de credenciais: URL ja preenchido, utilizador `fabio`, password.
3. "Emparelhar aparelho" -> POST /auth/token -> token de 180 dias.
4. BiometricPrompt para GUARDAR (confirma logo que o sensor funciona).
5. Painel carrega.
6. Arranques seguintes: so a impressao digital.

Se o dispositivo aparecer em `GET /auth/devices` com a etiqueta
"samsung SM-F741..." entao o emparelhamento funcionou.

---
---

# CONTINUIDADE — app 100% nativa (sem WebView)

Escrito no fim da sessao de 26/07. O Fabio vai continuar noutra conta com
um objetivo claro: **substituir o WebView por interface nativa**, ligada
a API por HTTP e WebSocket. Nada de webviewer.

## Estado neste momento

Funciona e esta verificado:

- Orchestrator na VPS `http://169.58.37.101:3000`, Node sob pm2.
- Autenticacao: Basic + cookie de sessao + tokens de dispositivo.
  **CONFIRMADO A FUNCIONAR NO FLIP 6** — emparelhamento feito, entra
  com impressao digital.
- Stacks: `estatico`, `nextjs-export` (compila e serve), `nextjs-server`,
  `nextjs-pagamentos`.
- App atual: Kotlin nativo com arranque em Canvas (`DaisyBootView`),
  biometria (`BiometricAuth` + `Sessao`), e um WebView para o painel.

O que fica por fazer: o WebView. Tudo o resto da app ja e nativo e pode
ser reaproveitado tal como esta.

## Superficie da API (extraida do server.js, nao de memoria)

Autenticacao em TODOS os endpoints. Tres formas, todas aceites:
`Authorization: Basic ...`, `Authorization: Bearer <token>`, ou cookie
`office_sess=<token|sessao>`.

### Leitura

    GET  /agents      -> [{id,label,cli,defaultCli,options[],status}]
    GET  /projects    -> [{id,name,brief,status,stages[],files{files,bytes,byExt},
                           git{total,byAgent},entry{type,root?,script?},
                           stack,complexity,deliverable,createdAt}]
    GET  /stacks      -> {stacks[],defeito,disco{livreMB,minimoMB,chega}}
    GET  /assignments -> {assignments{},defaults{},options[]}
    GET  /models      -> {models{},defaults{},tiers[],matrix{}}
    GET  /stats       -> agregados para graficos (zero tokens)
    GET  /auth/devices-> {dispositivos[{id,etiqueta,criado,ultimoUso,revogado}]}

### Acao

    POST /pipeline              {brief,complexity?,stack?} -> {accepted:true}
                               travao: 6 por 10 min
    POST /projects/:id/revise   {brief,agents?,complexity?}
    POST /task/:agentId         tarefa a um agente so
    POST /assignments           {developer:"codex"}   (409 se estiver a correr)
    POST /models                {codex:{light:"gpt-5.4-mini"}}
    POST /plan                  {brief,complexity?} -> plano SEM gastar quota
    POST /projects/:id/launch    arranca o preview
    POST /projects/:id/stop
    DELETE /projects/:id
    POST /reset                 destranca um pipeline preso
    POST /auth/token            Basic obrigatorio -> {token,id,expira}
    POST /auth/devices/:id/revogar

### WebSocket  (ws://169.58.37.101:3000)

O cookie `office_sess` autentica o handshake — por isso e que o token vai
no cookie e nao num cabecalho.

Primeira mensagem ao ligar:

    {type:"state", state:{<agentId>:{status,lastOutput}}, 
     pipeline:{running,project}}

Depois, em fluxo:

    {type:"status", agentId, status:"working"|"done"|"error",
     projectId?, cli?, tier?, model?, output?, error?}
    {type:"stream", agentId, chunk}          <- output ao vivo, linha a linha
    {type:"pipeline", phase:"start"|"end", project?, error?}

Nota: `agentId` pode ser `"build"`, que NAO e um agente. A UI tem de
tolerar ids que nao estao em /agents — foi exatamente isso que rebentou
o pipeline no server.js quando a etapa de build foi adicionada.

## Plano para a app nativa

O que ja existe e se aproveita: `DaisyBootView` (arranque), `BiometricAuth`,
`Sessao`, tema, logo, workflow de build.

O que substituir, por ordem de valor:

1. **Ecra principal** — lista de agentes com estado ao vivo, campo de
   briefing, seletor de stack e complexidade, botao construir. E o que da
   90% do uso. RecyclerView + WebSocket.
2. **Consola** — o `{type:"stream"}` chega em pedacos; acumular por
   agente e mostrar num TextView com scroll automatico.
3. **Vault** — lista de projetos com estado e botao de abrir. Aqui o
   WebView continua a fazer sentido: e para ver a plataforma construida,
   que E uma pagina web. Nao vale a pena reimplementar um browser.
4. **Graficos** — o /stats da tudo agregado; desenhar em Canvas como o
   DaisyBootView, sem bibliotecas.
5. **Escritorio 3D** — deixar para o fim ou nao fazer. E bonito no
   desktop; no telemovel a lista de agentes e mais util.

Sugestao de arquitetura: um `Repositorio` unico que detem o WebSocket e
expoe estado observavel; os ecras subscrevem. Evita cinco sitios a abrir
ligacoes proprias.

## ARMADILHAS — ler antes de escrever codigo

Cada uma destas custou tempo real nesta sessao.

**Confirmar flags com `--help`, nunca com artigos.** Mandei trocar
`agy --mode accept-edits` por `--headless --approve all` com base em
blogues. Nao existem nessa versao: a CLI sai com codigo 2 sem correr
nada. O `--help` no terminal do Fabio resolveu em dez segundos.

**Nomes de modelos: testar, nao supor.** Inventei `gpt-5.6` e
`gemini-3.5-flash`. A conta ChatGPT rejeita o nome de familia nu (so
`sol`/`terra`/`luna`), e no `agy` o nivel de esforco faz parte do NOME
(`gemini-3.6-flash-high`). Usar `agy models` e testar cada candidato.

**"Compila" nao e "funciona".** Compilei o scaffold Next.js, vi
`out/index.html` aparecer, e declarei-o testado. Nunca abri o HTML: os
caminhos eram `/_next/...` absolutos e o preview serve em `/preview/<id>/`.
Resultado: site em Times New Roman, sem CSS nem JS. Resolvido com
`assetPrefix` injetado pelo build.

**Substituicao de texto por indice apanha a ocorrencia errada.** Cortei
`office.html` de `for(const d of Object.values(desks)){` ate
`posicionarPins()` — mas essa primeira linha tambem existe dentro do
`build()`, 200 linhas acima. Apaguei o `init()` inteiro. Verificar
sempre que a ancora e UNICA e procurar o fim A PARTIR do inicio.

**Substituicoes que falham em silencio.** Duas edicoes minhas nao
aplicaram porque a string tinha espacos a mais (`set(0, 2.55, .2)` vs
`set(0,2.55,.2)`). Nada avisou. Sempre `assert conta == 1`.

**Hooks de notificacao nao podem matar o trabalho.** `state[id].status`
com um id desconhecido (`"build"`) lancou TypeError, a excecao subiu, e o
pipeline morreu depois do Developer: sem build, sem QA, projeto marcado
como concluido. Verificar antes de escrever: `if (state[id])`.

**Erros longos passam por trabalho valido.** A verificacao de "output
plausivel" era por comprimento. A mensagem "model is not supported" tem
centenas de caracteres e passou. Reconhecer erros pelo CONTEUDO
(FATAL_PATTERNS em runner.js), nao pelo tamanho.

**Codigo de saida nao e veredicto.** O Claude Code sai com 1 depois de
7 minutos de trabalho bem feito, porque a sessao acaba numa acao
bloqueada. Falha = saida suja E output residual.

**Workspaces do Claude Code precisam de confianca.** Sem a entrada em
`~/.claude.json` com `hasTrustDialogAccepted: true`, as 34 regras de
permissao sao IGNORADAS e o agente recusa todos os comandos. O
`trustWorkspace()` no runner.js ja o faz por cada pasta nova.

**A VPS nao se atualiza com `git push`.** O GitHub recebe o codigo, a VPS
so recebe quando se descompacta o zip la. E facil ficar com a app a
frente do servidor — foi o que deu o 404 no `/auth/token`.

**`unzip` sem `pm2 restart` nao faz nada.** O Node le os modulos no
arranque. Ficheiros novos em disco, codigo velho em memoria.

## Seguranca — o que falta

- Intervalo 8100-8149 aberto na firewall para o preview. Expoe servidores
  escritos por agentes, SEM autenticacao (correm em processos proprios,
  fora do middleware). So teste; fechar quando nao estiver a usar.
- `AGY_SKIP_PERMISSIONS=1` auto-aprova tudo no Antigravity, como root.
- Chaves Stripe: so `sk_test_`. Uma chave de producao aqui seria imprudente.
- Correr `deploy/hardening.sh` (fail2ban, ufw limit ssh, chaves SSH).
- Passar o orchestrator para utilizador nao-root fica por fazer.

## Nao verificado por mim

- A app nova NAO foi compilada por mim (sem SDK Android aqui). Verifiquei
  equilibrio de chaves/parenteses, referencias cruzadas entre os quatro
  ficheiros Kotlin, e XML valido. O Gradle tem a palavra final.
- `nextjs-server` e `nextjs-pagamentos` compilam mas nunca foram abertos
  de ponta a ponta.
- Stack Sanity: `agents/sanity.js` provisiona (projeto, dataset, token
  viewer, CORS) mas o scaffold do Studio embebido AINDA FALHA no build,
  na fronteira servidor/cliente. E sao 845 MB de node_modules por
  projeto, que nao dao para apagar por ser stack com servidor. Considerar
  Studio alojado em sanity.studio em vez de embebido.

---

## Gestor de mensalidades e domínios (FEITO)

Duas coisas separadas de proposito. A faturacao nao depende do Plesk: se
a API do painel falhar ou mudar de versao, continuas a saber quem te deve
dinheiro.

### Mensalidades — `agents/faturacao.js` + `public/faturacao.html`

Menos de 10 clientes, so registo e aviso. Ficheiro JSON, sem base de
dados: e facil de copiar para seguranca e le-se com os olhos.

- **Valores em CENTIMOS inteiros.** A API recusa `49.9`. A interface
  aceita euros e converte com `Math.round` — `49.90*100` em virgula
  flutuante da `4989.999...` e truncar perderia um centimo por cliente
  por mes.
- Pagamentos **anulam-se, nao se apagam**. Clientes **desativam-se**.
  Um historico reescrevivel nao serve de prova.
- Copia `.bak` antes de cada escrita.

Armadilhas de datas, todas testadas: dia 31 em fevereiro vence a 28 (nao
transborda para marco); `somarMeses` e aritmetica de inteiros e nao
`Date`, porque somar meses a um Date faz 31/jan + 1 mes = 3/mar;
trimestral so deve de 3 em 3; previsao mensal normaliza (anual de 600 EUR
conta 50/mes); mes corrente antes do dia de vencimento NAO e atraso.

    GET  /faturacao/estado          quem deve o que, ordenado por atraso
    GET  /faturacao/clientes/:id    historico
    POST /faturacao/clientes
    POST /faturacao/pagamentos      avisa se ja havia pagamento no mes
    POST /faturacao/pagamentos/:id/anular

### Dominios — `agents/saude.js` + `public/dominios.html`

Inventario = dominios do Plesk + dominios associados a clientes. Mostra
os que estao no Plesk sem cliente (sites que talvez nao estejas a cobrar)
e os que tens em faturacao mas nao estao no Plesk.

Verifica por dominio: DNS (A/AAAA/MX), certificado (emissor, dias para
expirar, se cobre o dominio), HTTP e HTTPS (codigo, tempo, HSTS,
redireccionamento). Sem dependencias.

**Decisao central:** o socket TLS usa `rejectUnauthorized: false`. Parece
errado num verificador de seguranca, mas e o contrario — se rejeitasse
certificados invalidos, a ligacao caia antes de o podermos LER, e o
diagnostico mais util ("expirou ha 3 dias") ficava impossivel. Nos nao
confiamos no certificado: inspecionamo-lo e relatamos.

O varrimento corre EM FUNDO e responde imediatamente: com 30 dominios
passa dos 30 segundos e um proxy a frente cortaria a ligacao. A pagina
sonda `/dominios/saude` de 3 em 3 segundos.

    GET  /dominios                      inventario
    GET  /dominios/saude                ultimo resultado (nao verifica)
    POST /dominios/saude/verificar      varre em fundo (6 por 10 min)
    GET  /dominios/saude/:dominio       um so, a vontade

### Plesk — `agents/plesk.js`

**A CHAVE DE API FICA VINCULADA AO IP DE ONDE FOI PEDIDA.** Gerar a
partir da Contabo, por SSH, nunca do PC — senao da 401 sempre:

    curl -k -X POST -u admin:PASSWORD -H "Content-Type: application/json" \
      -d '{}' https://SERVIDOR:8443/api/v2/auth/keys

Endpoints usados: `GET /api/v2/domains`, `GET /api/v2/clients`, header
`X-API-Key`, porta 8443. Cache de 10 minutos.

Muitas instalacoes Plesk tem certificado auto-assinado; o Node recusa-o e
bem. `PLESK_IGNORAR_CERT=1` existe mas a resposta certa e instalar
Let's Encrypt no proprio Plesk.

### NAO verificado

Os testes de certificado no MEU ambiente nao valem nada: ha um proxy TLS
que substitui todos os certificados (emissor aparece como "Anthropic",
e `expired.badssl.com` deu 30 dias em vez de expirado). A logica de
classificacao foi testada com dados controlados e esta certa; os
certificados REAIS so se veem na VPS.

A ligacao ao Plesk nunca foi testada contra um Plesk a serio.

### Fora de ambito, de proposito

Nao gera faturas nem comunica ao e-Fatura. Em Portugal isso exige
software certificado pela AT. Isto e um **registo de controlo interno**
para saberes quem paga o que; as faturas continuam a sair de onde saem.

---

## Navegação nativa na app (FEITO)

`DaisyNavBar.kt` — barra em Canvas, quatro secções: Escritório, Domínios,
Mensalidades, Vault. O indicador DESLIZA entre secções (ValueAnimator,
260ms, DecelerateInterpolator) e o texto acende por proximidade ao
indicador, não só no fim do percurso.

Transição entre secções: o conteúdo sai 22% da largura para o lado de
onde veio o toque, a página nova carrega escondida, e entra do lado
oposto. A direção transmite onde estás na sequência. O WebView é
escondido durante o carregamento — sem isso via-se um clarão branco a
meio da animação.

A barra fica IMÓVEL enquanto o conteúdo transita. É isso que separa uma
app de um site dentro de uma moldura.

Entrada no painel: o ecrã de arranque desvanece ENQUANTO o painel
aparece (340ms sobrepostos) e a barra entra 120ms depois. Sem ecrã vazio
entre os dois.

Detalhes:
- `onPageFinished` sincroniza a barra com o URL, para navegação feita a
  partir de links dentro do HTML também mover o indicador.
- Botão voltar fora da primeira secção leva ao Escritório em vez de sair
  da app — comportamento esperado em navegação por separadores.
- Nos painéis de credenciais e de erro a barra desaparece.
- As páginas HTML escondem a sua própria nav quando `DAISY_VOZ_NATIVA`
  está definido (classe `na-app`): senão eram duas barras a dizer o
  mesmo, uma delas a deslizar com o conteúdo.

---

## Domínios em nativo (FEITO) — e a decisão sobre bateria

`Api.kt` + `EcraDominios.kt`. O WebView deixou de ser usado nesta secção.

### Porque NÃO há WebSocket aqui

O custo de uma ligação persistente não está nos dados, está no rádio:
quando ele acorda para transmitir, não volta a dormir logo — fica alguns
segundos em estado de alta energia à espera de mais tráfego. Keepalives
de 30 em 30 segundos mantêm esse ciclo em permanência, mesmo sem passar
nada de útil.

No ecrã exterior do Flip 6 isso é desperdício puro: as sessões duram
segundos (abrir, ver a cor, fechar) e o corpo é fino demais para
dissipar bem. Além disso o health check NÃO é tempo real — o resultado
de um varrimento vale horas, certificados não mudam ao segundo.

Regra adotada, por ecrã e não global:
- **Domínios e Mensalidades**: leem ao abrir. Rádio acorda, transfere
  uns KB, dorme.
- **Escritório**: WebSocket (há output ao vivo), mas SÓ enquanto o ecrã
  estiver visível — por fazer.

Durante um varrimento há sondagem de 3 em 3 segundos, mas é uma janela
de meio minuto, não uma ligação sempre aberta. `onPause()` corta-a: uma
app que continua a trabalhar depois de fechada é a diferença entre
aquecer e não aquecer.

### Adaptação ao ecrã exterior

`compacto` = largura < 420dp. Nesse modo o cartão reduz-se ao essencial
(barra de cor, domínio, resumo) em vez de encolher tudo
proporcionalmente. Numa olhadela de três segundos o que se lê é a cor,
não os milissegundos de resposta. Os detalhes (HTTP, ms, dias de
certificado, emissor, cliente) só aparecem no ecrã grande.

A barra de cor fica à ESQUERDA e é o primeiro elemento — lê-se antes de
qualquer texto.

### Ainda por fazer

Escritório e Mensalidades continuam em WebView. O Vault deve ficar
assim: serve para ver plataformas web, e reimplementar um browser não
tem retorno.
