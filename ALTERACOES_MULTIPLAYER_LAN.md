# Alteracoes - Multiplayer LAN TCP

## Resumo

O app ganhou um modo multiplayer local em `Sessao LAN`, mantendo o uso single player local e adicionando uma camada TCP para mesa em rede local.

O celular do mestre abre um servidor TCP. Os jogadores entram pelo codigo da sessao ou escaneando o QR Code. A sessao guarda configuracao no SQLite, fecha sessoes ativas anteriores ao abrir uma nova e permite vincular ficha existente ou criar uma ficha nova durante a mesa.

## Principais entregas

- Botao `SESSAO LAN` na tela inicial.
- Tela `src/app/lan-session.tsx` com modo `Mestre` e `Jogador`.
- Mestre pode:
  - informar nome da sessao/campanha;
  - ativar ou desativar sincronizacao de conteudo custom;
  - escolher exatamente quais conteudos custom serao enviados;
  - filtrar e buscar conteudos custom no modal;
  - permitir ficha existente ou exigir ficha nova;
  - iniciar uma sessao TCP local;
  - mostrar codigo e QR Code da sessao;
  - ver jogadores conectados.
- Jogador pode:
  - digitar codigo da sessao;
  - escanear QR Code;
  - informar nome na mesa;
  - vincular uma ficha existente;
  - entrar na sessao TCP.
- Cada sessao tem id unico e codigo com `sessionId`, IP e porta.
- Ao iniciar/entrar em uma sessao nova, sessoes LAN ativas anteriores sao fechadas.
- A ficha exibe um indicador `LAN` quando existe sessao ativa.
- Alteracoes feitas na ficha pelo fluxo central `updateDB` enviam snapshot via TCP.
- Criar personagem durante uma sessao vincula e sincroniza a ficha criada.
- Editar/evoluir personagem durante uma sessao tambem sincroniza a ficha.

## Arquitetura adicionada

- `src/types/lan.ts`
  - Tipos de sessao, mensagens, conteudo custom e snapshots de personagem.

- `src/network/lanProtocol.ts`
  - Geracao de id de sessao.
  - Codigo LAN no formato `DNDLAN-<ID>-<IP>-<PORTA>`.
  - Parser de codigo.
  - Encoder/decoder de mensagens JSON por linha.

- `src/network/lanTransport.ts`
  - Wrapper TCP usando `react-native-tcp-socket`.
  - Servidor do mestre.
  - Cliente do jogador.
  - Broadcast para jogadores.
  - Framing de mensagens por `\n`.

- `src/network/lanRepository.ts`
  - Persistencia das sessoes LAN no SQLite.
  - Identidade local do aparelho.
  - Registro de jogadores.
  - Busca/importacao de conteudo custom.
  - Snapshots de ficha recebidos pela rede.

- `src/contexts/LanSessionContext.tsx`
  - Estado global da sessao ativa.
  - Acoes para iniciar, entrar, encerrar, vincular ficha e transmitir personagem.
  - Tratamento de mensagens `HELLO`, `WELCOME`, `CUSTOM_CONTENT` e `CHARACTER_UPSERT`.

## Banco de dados

Novas tabelas criadas em `src/database/init.ts`:

- `lan_device_identity`
- `lan_sessions`
- `lan_session_players`
- `lan_character_snapshots`
- `lan_event_log`

## Dependencias adicionadas

- `react-native-tcp-socket`
- `expo-network`
- `expo-camera`
- `react-native-qrcode-svg`
- `react-native-svg`

## Permissoes e build

`app.json` recebeu permissoes Android para rede local e camera:

- `INTERNET`
- `ACCESS_NETWORK_STATE`
- `ACCESS_WIFI_STATE`
- `CHANGE_WIFI_MULTICAST_STATE`
- `CAMERA`

Tambem foi configurado o plugin `expo-camera`.

Importante: TCP usa modulo nativo. Portanto esse modo precisa de dev build/APK gerado com as dependencias nativas. Nao e esperado funcionar no Expo Go puro.

## Validacao feita

Comando executado:

```bash
npx tsc --noEmit
```

Resultado: os arquivos novos da feature LAN nao apresentaram erros de TypeScript. O comando ainda falha por erros antigos ja existentes em:

- `src/components/app-tabs.tsx`
- `src/components/app-tabs.web.tsx`
- `src/components/ui/collapsible.tsx`
- `src/hooks/use-theme.ts`

Comando executado:

```bash
npm run lint
```

Resultado: o lint falha por erros antigos de `react/no-unescaped-entities` em:

- `src/app/advanced.tsx`
- `src/app/sheet.tsx`

Tambem existem varios warnings antigos no projeto. Os warnings introduzidos nos arquivos LAN foram limpos.

