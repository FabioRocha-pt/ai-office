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

# Sessão de 26/07 — Vault nativo, stacks no APK, backups

## O que ficou feito

**O Vault deixou de ser WebView.** Lista, detalhe, relatórios e ações são
Compose. O WebView aparece agora **num único sítio**: ao abrir a
plataforma construída, dentro do detalhe.

O detalhe de cada plataforma mostra o briefing original, cada etapa com
resultado e duração, e os relatórios dos agentes. Três ações: abrir,
corrigir e anular (com confirmação).

**Os relatórios não são guardados em lado nenhum.** O endpoint novo
`GET /projects/:id` lê os próprios ficheiros markdown que os agentes
escrevem — `PLANO.md`, `ARQUITETURA.md`, `DESIGN.md`, `QA.md`, `NOTAS.md`.
É onde vive a verdade; duplicá-los em metadados só criaria duas versões
para divergirem.

**Seletor de stack no APK**, com a mesma lista do painel web. As stacks
sem chaves configuradas aparecem a cinzento e dizem porquê, em vez de
deixarem escolher e falharem no build. A complexidade mudou-se para junto
da stack: as duas decidem-se por projeto, ao contrário das atribuições de
CLI, que são permanentes.

**`deploy/backup.sh`** arquiva vault e configuração, mantém 14 cópias e
recusa correr com menos de 500 MB livres. Testado. Instalar:

```bash
chmod +x deploy/backup.sh
(crontab -l 2>/dev/null; echo "0 4 * * * /root/ai-office/deploy/backup.sh") | crontab -
```

E confirmar que o orchestrator sobrevive a um reinício: `pm2 startup`
(correr o comando que ele imprime) seguido de `pm2 save`.

## Armadilhas do Compose que custaram iterações

Todas deram erro de compilação ou ecrã vazio, e todas foram culpa de
detalhes que não se adivinham:

- **`animateColorAsState`** está em `androidx.compose.animation`, não em
  `.animation.core`. O wildcard do core não o traz.
- **`CircleShape`** está em `androidx.compose.foundation.shape` e não vem
  com `import androidx.compose.foundation.*`.
- **`kotlinx.coroutines.launch`** tem de ser importado à mão para usar
  `rememberCoroutineScope().launch`.
- **`HorizontalPager`** é experimental; o opt-in está nos
  `freeCompilerArgs` do `app/build.gradle`. Não tirar.
- **O cookie é `office_sess`.** Inventei outro nome e o resultado foi um
  ecrã preto com "a reconectar" — nem REST nem WebSocket autenticavam.

**Ver erros de compilação sem correr o script todo:**

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME=$HOME/android-sdk
cd /root/ai-office/android
~/gradle-8.7/bin/gradle assembleRelease --no-daemon 2>&1 | grep "^e: " | head -20
```

Sem as variáveis, o Gradle queixa-se de "SDK location not found", que não
tem nada a ver com o erro real e faz perder tempo.

## Um erro de edição que vale a pena conhecer

Ao acrescentar métodos ao `Cliente.kt`, inseri-os imediatamente antes de
um marcador de comentário e, no mesmo script, removi código antigo
cortando *da posição dele até esse mesmo marcador* — apagando o que tinha
acabado de escrever. O balanço de chavetas passava na mesma.

Só a verificação de "cada método chamado existe mesmo?" é que apanhou.
Vale a pena correr essa verificação depois de edições grandes:

```bash
for m in stacks detalhe lancar apagar; do
  echo "$m -> usado $(grep -h "cliente\.$m(" *.kt | wc -l), definido $(grep -c "fun $m(" Cliente.kt)"
done
```

## Por fazer, por ordem de retorno

### 1. Dar olhos ao QA

O QA testa lógica mas nunca vê a página: não sabe se o menu se parte no
telemóvel nem se o contraste falha. É o maior buraco na qualidade do que
o escritório entrega.

Playwright headless na VPS (`npx playwright install --with-deps chromium`)
e uma ferramenta em `orchestrator/tools/ver-pagina.js` que receba um URL e
devolva: screenshot em viewport de telemóvel e de secretária, erros da
consola, contraste dos pares texto/fundo, e elementos que transbordem na
horizontal.

O `npx` já está na lista de comandos permitidos do `runner.js`. Falta a
persona do QA em `roles.js` mencionar a ferramenta e exigir que ele a use
antes de dar parecer. O alvo é `http://localhost:3000/preview/<id>/` —
dentro da própria VPS.

### 2. Notificações e widget

Um `ForegroundService` que mantenha o WebSocket aberto com a app fechada.
O `Cliente.kt` já tem toda a lógica de ligação e reconexão; o serviço só
precisa de o instanciar e reagir a `pipeline/end`.

Com o serviço de pé, o widget vem quase de graça: `AppWidgetProvider` com
`RemoteViews` — texto e barra de progresso, porque widgets Android não
fazem Canvas nem 3D. Permissões: `POST_NOTIFICATIONS` e
`FOREGROUND_SERVICE_DATA_SYNC`.

### 3. Publicar plataformas no GitHub

Cada projeto do vault já é um repositório git com histórico por agente;
falta o remoto. Um `POST /projects/:id/publicar` que crie o repositório
pela API (token com *Administration: write*, no `.env`), faça `git remote
add` e `git push`, e grave o URL nos metadados. Privado por omissão — são
plataformas geradas por IA e podem conter disparates. No APK, o botão vai
no detalhe, ao lado de Abrir e Corrigir.

### 4. Consciência de gasto

Não há visibilidade sobre quanta quota cada corrida queima. As etapas já
guardam `startedAt`, `finishedAt`, `cli`, `tier` e `model` — a
matéria-prima está toda lá, falta agregar por CLI e por dia e mostrar nos
gráficos. Não dá tokens exatos (as CLIs de subscrição não os reportam),
mas tempo por CLI é bom indicador de onde está a ir a quota.
