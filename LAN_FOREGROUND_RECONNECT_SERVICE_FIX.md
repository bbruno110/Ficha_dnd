# LAN — Foreground Service, Reconnect e Resync após bloqueio de tela

Este ajuste adiciona a base de resiliência para sessões LAN quando o mestre ou jogador bloqueia o celular, minimiza o app ou volta de outro aplicativo.

## O que foi implementado no código JS/React Native

- `LanSessionContext` agora escuta `AppState`.
- Ao voltar de `background/inactive` para `active`, o app tenta retomar a sessão LAN automaticamente.
- Mestre reabre o servidor TCP com a mesma sessão ativa.
- Jogador reconecta no host salvo e envia `HELLO` + `REQUEST_RESYNC` + `SNAPSHOT_REQUEST`.
- Resync usa `last_event_seq` local para pedir eventos que faltaram.
- Se não houver eventos para reenviar, o mestre envia `SESSION_SNAPSHOT` completo.
- Adicionado heartbeat `PING/PONG` a cada 5 segundos para manter o canal ativo e detectar queda.
- A tela de Sessão LAN agora diferencia `TCP ON`, `TCP OFF`, `SYNC` e `RECONECTANDO`.
- Adicionado bridge `src/services/lan/LanForegroundService.ts` para chamar um Foreground Service Android nativo quando ele existir.

## Importante

Este ZIP não contém a pasta `android`. Portanto o Foreground Service nativo real não foi compilado dentro do Android neste pacote.

A bridge já está pronta para chamar um módulo nativo chamado `LanForegroundService`. Quando a pasta `android` estiver presente, o próximo passo é implementar esse módulo nativo em Kotlin/Java para manter o host vivo mesmo com a tela bloqueada.

Sem o módulo nativo, o app já tenta reconectar e ressincronizar ao desbloquear, mas o Android ainda pode suspender o servidor TCP do mestre enquanto a tela estiver bloqueada.

## Fluxo esperado após este ajuste

### Mestre bloqueia/desbloqueia

1. Mestre inicia sessão.
2. App tenta iniciar `LanForegroundService` se existir.
3. Mestre bloqueia ou abre outro app.
4. Ao voltar, `AppState` chama `recoverLanSession`.
5. Servidor TCP é reaberto na mesma sessão.
6. Jogadores fazem reconnect/resync automaticamente.

### Jogador bloqueia/desbloqueia

1. Jogador volta ao app.
2. App reconecta ao IP/porta salvos.
3. Envia `HELLO` com `deviceId` e `characterId` já vinculados.
4. Envia `REQUEST_RESYNC` com `last_event_seq`.
5. Mestre envia eventos faltantes ou snapshot.
6. Ficha e quadro Sessão LAN atualizam.

## Arquivos alterados/adicionados

- `src/contexts/LanSessionContext.tsx`
- `src/types/lan.ts`
- `src/app/lan-session.tsx`
- `src/services/lan/LanForegroundService.ts`
