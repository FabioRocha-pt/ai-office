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
