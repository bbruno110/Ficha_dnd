# Ficha D&D - contexto para agentes de IA

Este documento descreve a estrutura tecnica, dominio, regras de negocio e cuidados do projeto `ficha-dnd`. Use como contexto inicial antes de alterar codigo.

## Objetivo do produto

O app e uma ficha de D&D/BG3 feita em React Native com Expo Router.

Principais capacidades:

- criar, editar e consultar personagens;
- manter banco local SQLite com classes, racas, itens, magias, kits, pericias e testes;
- criar conteudo customizado pelo mestre/jogador;
- rodar uma sessao LAN local entre mestre e jogadores;
- permitir que o mestre veja e altere estado oficial dos jogadores;
- sincronizar HP, XP, moedas, inventario, efeitos/status e historico da mesa em tempo quase real via TCP local.

## Stack

- Expo SDK 54
- React Native 0.81
- React 19
- Expo Router
- Expo SQLite
- AsyncStorage
- `react-native-tcp-socket` para multiplayer LAN TCP
- `expo-network` para descobrir IP local do host
- `expo-camera` para ler QR Code
- Three.js / React Three Fiber para rolagem 3D de dados
- Android Foreground Service nativo para manter a mesa do mestre visivel/ativa em segundo plano

Scripts importantes:

```bash
npm install
npx tsc --noEmit
npm run lint
npx expo run:android
npm run web -- --port 8081
```

## Regra essencial sobre o multiplayer

O multiplayer atual NAO e nuvem e NAO funciona como WhatsApp.

Arquitetura atual:

```text
Celular do mestre = servidor TCP da mesa
Celular do jogador = cliente TCP
Rede = mesma LAN/Wi-Fi
Banco oficial = SQLite local do mestre durante a sessao
Banco do jogador = cache/local copy da propria ficha
```

Consequencias:

- se o mestre minimiza o app ou bloqueia a tela, o Android deve manter uma notificacao persistente da mesa;
- a notificacao permite voltar ao app e tem botao `Encerrar` para finalizar a sessao;
- se o mestre usa force stop, remove a tarefa agressivamente, o sistema mata o processo, desliga o celular ou perde Wi-Fi, o host TCP cai;
- jogadores so recebem eventos enquanto conseguem conectar ao host LAN;
- ao voltar do background, o app tenta recriar socket e buscar snapshot atual;
- para funcionar com app fechado/desligado como mensageria real, precisa backend externo: Supabase Realtime, Firebase, WebSocket proprio, etc.

## Estrutura de pastas

```text
src/app/
  _layout.tsx              Root layout e provider SQLite
  index.tsx                Tela inicial / lista de personagens
  create.tsx               Criacao de personagem
  edit.tsx                 Edicao / level up
  sheet.tsx                Ficha jogavel do personagem
  advanced.tsx             Criador avancado de conteudo customizado
  lan-session.tsx          Tela do mestre e painel da sessao LAN
  sessionJoin.tsx          Entrada do jogador via QR, URL ou codigo

src/database/
  init.ts                  Criacao/seed base do SQLite
  migration_dnd_v2.ts      Migracoes e seeds novos para LAN/efeitos

src/services/
  lanSession.ts            Regras de sessao LAN, payload, eventos, persistencia
  lanTcpTransport.ts       Transporte TCP puro mestre/jogadores
  effects/                 Catalogo, aplicacao e resolucao de efeitos/status

src/hooks/
  useLanAppLifecycle.ts              Reconnect/refresh ao voltar do background
  useLanRealtimePlayerPatches.ts     Cliente recebe patches do mestre em tempo real

src/components/
  CharacterCard.tsx
  DiceRoller3D.tsx
  SpellSelector.tsx
  QrCodeView.tsx
  ...

src/styles/
  globalStyles.ts          Design system local e estilos das telas

android/app/src/main/java/com/bbruno115/fichadnd/
  LanSessionModule.kt                Ponte nativa usada pelo JS
  LanSessionForegroundService.kt     Notificacao persistente da mesa do mestre
  MainActivity.kt
  MainApplication.kt

android/app/src/main/AndroidManifest.xml
  Permissoes de rede/notificacao/foreground service e registro do service
```

## Telas e responsabilidades

### `src/app/index.tsx`

Tela inicial. Lista personagens locais, permite abrir ficha, criar, editar, remover e lidar com vinculos de sessao.

Regras importantes:

- personagem vinculado a uma sessao pode aparecer com indicacao de sessao;
- ao desvincular, o personagem volta a poder ser usado em outra mesa;
- nao deve apagar dados da sessao sem acao explicita.

### `src/app/create.tsx`

Cria personagem.

Fluxo principal:

- escolhe raca, classe, atributos, pericias/testes, magias, kit inicial e historia;
- salva em `characters`;
- equipamentos sao JSON no campo `equipment`;
- atributos ficam em JSON no campo `stats`;
- pericias e testes ficam em `skill_values` e `save_values`;
- historia/personagem fica em `personality_traits`, `ideals`, `bonds`, `flaws`, `features_traits`, `backstory`, `allies_organizations`, `languages`.

Regra LAN:

- se criado a partir de uma sessao (`sessionId`, `joinUrl`), o personagem deve entrar vinculado aquela sessao.

### `src/app/edit.tsx`

Edita personagem e suporta level up.

Regras:

- level up deve recalcular HP, slots/magias e selecoes respeitando progressao;
- nao quebrar JSON de `stats`, `equipment`, `spells`, `skill_values`, `save_values`;
- ao editar personagem vinculado em sessao pausada, o mestre pode receber revisao pendente.

### `src/app/sheet.tsx`

Ficha jogavel do personagem.

Responsabilidades:

- mostra atributos, proficiencias, inventario, magias e historia;
- aplica consumiveis e magias locais;
- em sessao LAN, respeita estado `active`, `paused`, `ended`;
- envia pedidos/eventos para mestre quando jogador tenta alterar recursos oficiais.

Regras LAN na ficha:

- jogador nao deve adicionar XP, moedas ou itens livremente durante sessao ativa sem passar pelo mestre;
- reducoes permitidas podem ser enviadas como patch ou inventario;
- aumentos de recursos devem virar `resource_request`;
- eventos recebidos do mestre atualizam personagem local imediatamente;
- ao voltar do background, limpar socket cliente e buscar snapshot novo.

### `src/app/lan-session.tsx`

Tela do mestre e painel oficial da sessao.

Responsabilidades:

- criar/retomar/finalizar/pausar sessao;
- gerar convite QR/deep link;
- listar jogadores;
- editar HP, XP, moedas, inventario, efeitos/status;
- aceitar/recusar pedidos de jogador;
- acompanhar testes pendentes;
- ver historico da sessao;
- ver ficha completa do jogador.

Regras recentes/atuais:

- moedas do jogador devem ser alteradas em patch unico (`gp`, `sp`, `cp`) para evitar delay/inconsistencia;
- kick remove o jogador da lista do mestre e impede que uma entrada antiga do socket reinsira a mesma ficha kickada;
- historico aparece abaixo do painel de jogadores/aplicacao de efeitos;
- aplicacao de efeitos suporta multi-selecao;
- busca de efeitos deve filtrar sem sobrescrever o texto digitado;
- modal de inventario do mestre filtra por categoria e busca por nome, dano, tipo, propriedade e descricao;
- `Ver ficha` deve mostrar atributos, recursos, pericias, testes, habilidades, historia, inventario e efeitos.

### `src/app/sessionJoin.tsx`

Entrada do jogador em mesa LAN.

Fluxo:

1. jogador escaneia QR, cola URL ou digita codigo;
2. app resolve URL `tcp://IP:43115/sessionId`;
3. busca payload da sessao no mestre;
4. importa acervo customizado recebido;
5. salva sessao local como jogador (`isMaster: false`);
6. se personagem ja estiver vinculado e ainda estiver na mesa, entra direto na ficha;
7. caso contrario, mostra personagens elegiveis ou opcao de criar.

Regras:

- jogador nunca deve salvar sessao como mestre por padrao;
- se foi kickado, deve poder escolher/criar outra ficha conforme regra da mesa;
- personagem vinculado a outra sessao deve ficar oculto na selecao.

## Banco de dados

Banco local: Expo SQLite.

Inicializacao:

- `src/database/init.ts`
- executa `PRAGMA journal_mode = WAL`
- executa `PRAGMA foreign_keys = ON`
- cria tabelas base e seeds;
- roda `migrateDatabaseV2(db)`.

### Tabelas base principais

`items`

- catalogo de itens;
- campos: `name`, `weight`, `damage`, `damage_type`, `properties`, `descricao`;
- campos mecanicos novos: `effect_json`, `duration_value`, `duration_unit`;
- `criador` indica base/proprio/importado.

`races`

- racas, bonus de atributos, velocidade e features.

`classes`

- classes, stats recomendados, equipamento inicial, ouro, hit dice, saves, caster e features.

`subclasses`

- subclasses associadas a uma classe, nivel requerido, bonus de pericias e features.

`spells`

- magias, habilidades e passivas;
- campos: level, category, classes, casting_time, range, components, duration, damage_dice, damage_type, saving_throw, description;
- campos mecanicos: `effect_json`, `duration_value`, `duration_unit`.

`skills`

- pericias com id, nome e atributo base.

`saving_throws`

- testes de resistencia com id, nome e atributo base.

`starting_kits`

- kits iniciais em JSON.

`bg3_companions`

- origens/companions BG3 com historia, habilidades e stats.

`characters`

- personagem local;
- campos JSON importantes:
  - `stats`
  - `proficiencies`
  - `save_values`
  - `skill_values`
  - `spells`
  - `spell_slots_used`
  - `equipment`
  - `active_effects_json` via migracao
- campos numericos oficiais:
  - `gp`, `sp`, `cp`
  - `hp_max`, `hp_current`, `temp_hp`
  - `level`, `xp`

### Tabelas LAN

`lan_sessions`

- sessao da mesa;
- contem regras da mesa, status, payload JSON, join URL e metadados de transporte;
- campos importantes:
  - `id`
  - `name`
  - `master_name`
  - `level`
  - `allow_existing`
  - `invite_code`
  - `join_url`
  - `payload_json`
  - `status`: `active`, `paused`, `ended`
  - `current_turn`
  - `elapsed_minutes`
  - `selected_catalog_json`
  - `transport_mode`
  - `host_ip`
  - `host_port`
  - `protocol_version`
  - `current_seq`
  - `is_master`
  - `active`

`lan_session_players`

- jogadores/personagens dentro de uma sessao;
- e a tabela oficial do mestre para estado da party;
- campos importantes:
  - `session_id`
  - `remote_key`
  - `client_id`
  - `player_name`
  - `character_id`
  - `character_name`
  - `character_snapshot`
  - `hp_current`, `hp_max`, `temp_hp`, `xp`, `gp`, `sp`, `cp`
  - `stats_json`
  - `equipment_json`
  - `effects_json`
  - `pending_character_snapshot`
  - `is_active`
  - `is_connected`
  - `revision_seq`
  - `kicked_at`

Regra:

- jogador ativo e visivel precisa ter `is_active = 1` e `kicked_at IS NULL`;
- jogador kickado nao deve ser reinserido pelo mesmo `remote_key`;
- `character_snapshot` deve preservar ficha completa para o mestre visualizar.

`lan_session_events`

- historico/event sourcing da sessao;
- campos:
  - `id`
  - `session_id`
  - `seq`
  - `type`
  - `from_key`, `from_name`
  - `to_key`, `to_name`
  - `client_msg_id`
  - `payload_json`
  - `processed`
  - `created_at`

`lan_session_pending_requests`

- estrutura para pedidos pendentes ao mestre.

`lan_session_trades`

- estrutura para trocas entre jogadores.

### Tabelas de efeitos/status

Criadas por `src/services/effects/effectSchema.ts` e migracao v2.

`lan_effect_catalog`

- catalogo de condicoes/status/efeitos;
- inclui cor, icone, alvo, valor, duracao default, stack, teste de resistencia e regras JSON.

`lan_active_effects`

- efeitos ativos por jogador;
- fonte oficial para rebuild de `effects_json`;
- armazena duracao, save, visibilidade e payload JSON.

`lan_pending_saves`

- testes pendentes gerados por efeitos que exigem save repetido.

## Modelo de sessao LAN

Tipos centrais em `src/services/lanSession.ts`:

- `LanSessionRules`
- `LanSessionPayload`
- `LanSessionState`
- `LanSessionPlayerState`
- `LanSessionEvent`
- `LanSessionEffect`
- `LanResourceRequest`
- `PublicLanPlayer`

### Payload LAN

`LanSessionPayload` representa snapshot exportavel da mesa:

```ts
{
  type: 'ficha-dnd-lan-session',
  version: 1,
  createdAt,
  session,
  catalog,
  effectCatalog,
  selectedCatalog,
  state,
  events
}
```

Regras:

- mestre publica payload oficial;
- jogador importa catalogo e usa payload para atualizar propria ficha;
- payload deve ter `state.players` atualizado antes de broadcast;
- eventos recentes devem ser preservados no payload para reconexao.

## Transporte TCP

Arquivo: `src/services/lanTcpTransport.ts`

Porta padrao:

```ts
LAN_TCP_PORT = 43115
```

URL:

```text
tcp://192.168.x.x:43115/lan_...
```

Mensagens TCP em JSON por linha:

- `hello`
- `session_snapshot`
- `join`
- `event`
- `payload_update`
- `session_rejected`

Regras:

- toda mensagem pertence a uma sessao;
- host rejeita sessionId incompatvel;
- cliente aplica `payload_update` depois do primeiro snapshot;
- send de join/event tenta reconectar se socket antigo falhar;
- socket usa `setNoDelay(true)` e keepalive;
- `subscribeLanTcpHostUpdates` e `subscribeLanTcpClientUpdates` atualizam UI sem esperar polling.
- cliente TCP nao deve forcar `interface: "wifi"` por padrao; deixar o Android usar a rede ativa evita crashes/overhead em alguns aparelhos ao entrar ou varrer codigo da mesa.
- resolucao por codigo curto faz varredura da sub-rede com concorrencia limitada (8 workers) para evitar abrir sockets demais no celular fisico;
- hosts especiais de emulador (`10.0.2.2`, `10.0.3.2`) so entram na varredura quando o IP local parece de emulador.

## Foreground service Android

Arquivos:

- `android/app/src/main/java/com/bbruno115/fichadnd/LanSessionForegroundService.kt`
- `android/app/src/main/java/com/bbruno115/fichadnd/LanSessionModule.kt`
- `android/app/src/main/AndroidManifest.xml`
- `src/services/lanSession.ts`
- `src/app/lan-session.tsx`

Objetivo:

- quando o mestre inicia/retoma uma mesa TCP, iniciar um Foreground Service Android;
- mostrar notificacao persistente com nome da mesa, codigo, quantidade de jogadores e URL;
- oferecer botao `Encerrar` na notificacao;
- ao tocar `Encerrar`, o nativo grava uma flag e emite evento `LanSessionForegroundStop`;
- `lan-session.tsx` consome esse evento/flag e chama o mesmo fluxo de encerramento da UI (`handleStopSession`).

Regras importantes:

- service e notificacao sao exclusivos do mestre; jogador nao deve iniciar foreground service ao salvar sessao local;
- `syncLanSessionPayload` so atualiza a notificacao se `lan_sessions.is_master = 1`;
- se o Android negar/rejeitar o foreground service, o service deve parar sem derrubar o app;
- foreground service reduz queda ao minimizar/bloquear tela, mas nao sobrevive a force stop, kill agressivo do sistema, bateria extrema, perda de rede ou celular desligado;
- isso nao transforma o app em WhatsApp/nuvem.

## Eventos LAN

Tipos atuais:

- `send_item`
- `trade_offer`
- `trade_accept`
- `trade_decline`
- `public_status`
- `spell_hp`
- `spell_effect`
- `player_joined`
- `effect_expired`
- `player_kicked`
- `character_update_review`
- `resource_request`
- `resource_review`
- `player_patch`
- `inventory_patch`
- `effect_patch`
- `effect_catalog_patch`
- `pending_save_patch`
- `session_patch`
- `timeline_event`

Regras gerais:

- `rememberLanSessionEvent` persiste evento local e gera `seq`;
- `rememberAndSendLanSessionEvent` persiste e envia pelo socket;
- `player_patch` e usado para atualizacao rapida de numeros;
- `inventory_patch` e usado para inventario;
- `resource_request` precisa revisao do mestre;
- `resource_review` informa aceite/recusa ao jogador;
- `effect_patch` informa atualizacao de efeitos oficiais;
- `pending_save_patch` informa criacao/resolucao de testes pendentes.

## Autoridade e regras de negocio

### Mestre

O mestre e autoridade da sessao.

Pode:

- iniciar, pausar, retomar e encerrar sessao;
- aceitar jogadores;
- kickar jogadores;
- alterar HP, HP maximo, PV temporario, XP e moedas;
- entregar/remover itens;
- aplicar/remover efeitos;
- aceitar/recusar pedidos dos jogadores;
- resolver testes pendentes;
- avancar turno, minuto, hora, descanso curto ou descanso longo.

Nao deve:

- depender do banco do jogador para estado oficial durante sessao ativa;
- deixar jogador kickado continuar ativo;
- salvar uma sessao de jogador como mestre.

### Jogador

Jogador tem autoridade local limitada.

Pode:

- abrir ficha;
- rolar dados;
- ver estado publico da mesa;
- enviar pedido ao mestre;
- reduzir recursos permitidos quando a regra autoriza;
- propor troca/enviar item se o fluxo permitir.

Durante sessao ativa:

- aumento de XP, moedas, HP, PV temporario, atributo ou inventario deve ir para o mestre como pedido;
- aplicacao oficial de efeitos deve vir do mestre;
- ao receber snapshot oficial, ficha local deve ser atualizada.

### Kick

Regras esperadas:

- mestre marca `is_active = 0`, `is_connected = 0`, `kicked_at = CURRENT_TIMESTAMP`;
- jogador recebe `player_kicked`, desvincula personagem da sessao e volta a poder escolher/criar ficha;
- ficha kickada deve sair do painel do mestre;
- entrada antiga do socket nao deve reinserir o mesmo `remote_key`.

### Moedas

Unidades:

- `gp`: PO/ouro
- `sp`: PP/prata
- `cp`: PC/cobre

Conversao usada no painel do mestre:

```text
1 PO = 10 PP = 100 PC
1 PP = 10 PC
```

Regra pratica:

- quando mestre ajusta moedas, enviar `gp`, `sp`, `cp` em um unico `player_patch`;
- evitar tres eventos separados para uma unica edicao de moedas.

### HP e PV temporario

- `hpCurrent`: vida atual
- `hpMax`: vida maxima
- `tempHp`: vida temporaria

Regras:

- HP atual nao deve ficar negativo;
- cura nao deve ultrapassar HP maximo quando a regra assim exigir;
- PV temporario pode ser efeito (`temp_hp`) ou numero oficial;
- efeitos que alteram HP/PV devem sincronizar payload.

### XP

- mestre pode distribuir XP para todos;
- jogador pode pedir adicao/remocao conforme UI;
- level up e fluxo separado em `edit.tsx`.

### Inventario

Formato normalizado:

```ts
{
  bag: [...],
  slots: {...}
}
```

Regras:

- se `equipment` antigo for array, normalizar para `{ bag, slots }`;
- mestre pode entregar item via modal de inventario;
- item entregue deve preservar campos mecanicos: `effect_json`, `duration_value`, `duration_unit`, `descricao`;
- busca de itens do mestre deve considerar nome, dano, tipo, propriedades e descricao.

### Efeitos/status

Alvos:

- `FOR`
- `DES`
- `CON`
- `INT`
- `SAB`
- `CAR`
- `CA`
- `HP`
- `PV_TEMP`
- `custom`

Kinds:

- `stat`
- `hp`
- `temp_hp`
- `status`
- `custom`

Duracao:

- `turn`, `round`
- `minute`
- `hour`
- `day`
- `short_rest`
- `long_rest`
- `rest`
- `concentration`
- `while_equipped`
- `while_active`
- `until_save`
- `permanent`
- `manual`

Regras:

- efeito simples de atributo nao deve herdar save/teste de resistencia de catalogo se nao estiver usando `statusKey`;
- condicoes/status podem usar catalogo e gerar save pendente;
- testes pendentes so devem surgir quando efeito tiver `saveAbility`/`repeatSave` configurado;
- remover efeito deve atualizar `lan_active_effects`, cache `effects_json`, payload e evento;
- avancar tempo deve reduzir duracao e registrar expiracoes.

## Criador avancado

Arquivo: `src/app/advanced.tsx`

Cria conteudo customizado:

- item;
- raca;
- classe;
- subclasse;
- magia/habilidade/passiva;
- kit inicial;
- progressao de magia.

Regras:

- conteudo customizado usa `criador = 'proprio'`;
- conteudo importado de sessao usa `criador = 'importado'`;
- acervo selecionado pelo mestre e incluido no payload da sessao;
- magias e itens podem ter `effect_json` e duracao estruturada.

## Deep link / convite

`buildJoinDeepLink(joinUrl, payload)` cria:

```text
fichadnd:///sessionJoin?code=ABC123&sessionId=lan_...&url=tcp://...
```

Regras:

- se `joinUrl` existe, QR deve conter URL TCP;
- se nao existe, pode cair em payload embutido, mas nao sera tempo real;
- Expo Go nao suporta TCP local porque falta modulo nativo.

## Ciclo de vida

Hook: `useLanAppLifecycle`

Mestre:

- ao voltar para foreground, tenta retomar host TCP com payload atualizado.
- ao iniciar/retomar host TCP, liga a notificacao foreground Android;
- ao encerrar sessao pela tela ou pela notificacao, finaliza sessao no banco, publica payload final e para TCP/foreground service.

Jogador:

- ao ir para background, fecha cliente TCP;
- ao voltar, reseta cliente TCP, conecta e busca snapshot novo.
- jogador nunca deve iniciar a notificacao foreground da mesa.

## Regras para agentes ao editar este projeto

1. Preserve o padrao atual de Expo Router e SQLite local.
2. Nao transforme LAN em nuvem sem pedido explicito.
3. Nao salve jogador como mestre; use `{ isMaster: false }` para entrada de jogador.
4. Nao confie em estado visual antigo; depois de alterar banco de sessao, chame `syncLanSessionPayload` ou `reloadSessionState` conforme o fluxo.
5. Para alteracoes pequenas em tempo real, prefira eventos delta (`player_patch`, `inventory_patch`) em vez de payload gigante.
6. Para mudancas oficiais do mestre, persistir no SQLite do mestre primeiro.
7. Para mudancas vindas de jogador, registrar evento e validar regra antes de aplicar.
8. Nunca reinserir personagem kickado pelo mesmo `remote_key`.
9. Nao quebrar JSONs existentes: sempre parsear com fallback e normalizar.
10. Antes de finalizar, rodar:

```bash
npx tsc --noEmit
npm run lint
```

## Pontos conhecidos de atencao

- A base possui avisos antigos de lint em varios arquivos; nao refatorar tudo sem necessidade.
- Ha textos com encoding quebrado em alguns arquivos; cuidado ao editar trechos com acentos.
- `eslint.config.js` pode ser gerado automaticamente pelo `expo lint`; se isso for indesejado, remover antes de finalizar.
- TCP exige dev/native build; Expo Go nao serve para testar multiplayer real.
- Teste de APK fisico normalmente usa `npm run build:android`, que gera release em `android/app/build/outputs/apk/release/`.
- Emulador Android pode gerar IP `10.0.2.x`, inacessivel por celular fisico sem redirecionamento.
- Roteadores com isolamento de cliente/AP isolation impedem conexao entre celulares.
- Se o app fechar ao iniciar/entrar no celular fisico, conectar o aparelho por USB e coletar `adb logcat` filtrando por `AndroidRuntime`, `ReactNativeJS`, `TcpSockets`, `LanSessionForeground` e `com.bbruno115.fichadnd`.

## Fluxos de teste manual recomendados

### Criacao e entrada LAN

1. Mestre abre `Sessao LAN`.
2. Mestre inicia sessao.
3. QR mostra `tcp://IP:43115/lan_...`.
4. Jogador entra por QR/codigo.
5. Jogador escolhe/cria ficha.
6. Mestre ve jogador no painel.

### Tempo real mestre -> jogador

1. Mestre altera HP/XP/moedas.
2. Jogador deve ver mudanca sem esperar varios segundos.
3. Mestre aplica efeito.
4. Jogador deve receber efeito/snapshot oficial.

### Tempo real jogador -> mestre

1. Jogador faz pedido de HP/XP/moeda.
2. Mestre ve no historico.
3. Mestre aceita/recusa.
4. Jogador recebe resposta.

### Kick

1. Mestre kicka jogador.
2. Jogador e desvinculado.
3. Ficha sai do painel do mestre.
4. Ao entrar de novo, jogador pode escolher/criar ficha conforme regra da sessao.

### Inventario

1. Mestre abre inventario do jogador.
2. Busca item por nome/propriedade/dano/descricao.
3. Filtra categoria.
4. Entrega item.
5. Jogador recebe inventario atualizado.

## Arquivos de referencia rapida

- `src/services/lanSession.ts`: regras de negocio da sessao.
- `src/services/lanTcpTransport.ts`: socket TCP e protocolo.
- `src/app/lan-session.tsx`: UX e acoes do mestre.
- `src/app/sessionJoin.tsx`: UX de entrada do jogador.
- `src/app/sheet.tsx`: ficha e UX do jogador.
- `src/services/effects/activeEffectService.ts`: aplicacao/remocao/tick de efeitos.
- `src/services/effects/effectCatalogService.ts`: catalogo de efeitos/status.
- `src/services/effects/effectResolver.ts`: testes pendentes e normalizacao mecanica.
- `src/database/init.ts`: schema e seed base.
- `src/database/migration_dnd_v2.ts`: migracao LAN/efeitos.
