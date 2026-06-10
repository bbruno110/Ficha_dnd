# LAN v31 - Arquitetura Command -> Event -> Aggregate -> Broadcast

Esta versão refatora a base da LAN para trabalhar como um sistema multiplayer autoritativo.

## Objetivo

Suportar vários eventos ao mesmo tempo sem duplicar, travar ou sobrescrever estado:

- jogador 3 solicita troca com jogador 1;
- jogador 2 envia item para jogador 5;
- mestre clica várias vezes em `-1 HP` no jogador 4;
- jogador 6 solicita XP;
- jogador 7 equipa item;
- jogador 8 consome item com efeito permanente ou temporário;
- mestre passa turno durante essas ações.

## Princípio principal

O host/mestre é a única autoridade de estado.

O jogador não confirma estado final. O jogador envia um comando:

```txt
COMMAND -> Host -> Validação -> Commit SQLite -> Evento oficial -> Broadcast
```

O estado vivo dos jogadores é derivado de eventos oficiais do host.

## Novos componentes

### `src/services/lan/lanCommandBus.ts`

Command Bus persistente no SQLite.

Ele cria a tabela `lan_command_log` e garante:

- idempotência persistente por comando;
- comandos duplicados são ignorados mesmo após reconexão;
- comando repetido por ACK/replay de socket não executa mutação duas vezes;
- cada comando entra em fila pelos agregados envolvidos.

Tipos de comando mapeados:

- `INVENTORY_SEND_ITEM`
- `TRADE_PROPOSE`
- `TRADE_COUNTER`
- `TRADE_ACCEPT`
- `TRADE_DECLINE`
- `RESOURCE_REQUEST`
- `ITEM_EQUIP`
- `ITEM_CONSUME`
- `PLAYER_NUMBER_DELTA`
- `PLAYER_NUMBER_SET`
- `SESSION_ADVANCE_TURN`
- `EFFECT_PATCH`

### `src/services/lan/lanEntityQueue.ts`

Fila por agregado.

Exemplos de chaves:

```txt
sessionId:player:<playerKey>
sessionId:inventory:<playerKey>
sessionId:session
sessionId:request:<requestId>
```

Eventos no mesmo agregado são serializados. Eventos em agregados diferentes podem rodar em paralelo.

### `src/services/lan/lanEventStore.ts`

Event Store persistente.

A v31 adiciona `lan_aggregate_versions`, que registra a revisão atual de cada agregado:

```txt
Player#4 revision=58
Inventory#4 revision=92
Trade#ABC revision=5
Session revision=20
```

Isso impede que evento antigo sobrescreva evento novo.

## Diferença para v30

A v30 já tinha fila por entidade, mas ainda dependia muito de trava em memória no host (`processedHostActionIdsRef`).

A v31 adiciona idempotência persistente no SQLite. Assim, se o host receber o mesmo comando de novo depois de reconexão, foreground, ACK duplicado ou replay TCP, o comando não roda novamente.

## Snapshot

Snapshot continua existindo apenas para:

- bootstrap de entrada na mesa;
- resync inicial;
- reconstrução de tela.

Snapshot não deve ser usado como fonte para sobrescrever HP/inventário/efeitos vivos durante a sessão.

## Resultado esperado

- vários cliques rápidos em HP são aplicados em ordem;
- envio de item altera origem e destino uma única vez;
- troca só executa uma vez no aceite final;
- consumo/equipamento não deve travar HP nem turno de outro jogador;
- passagem de turno não deve fazer vida voltar;
- replay/reconexão não duplica comando;
- muitos jogadores podem disparar comandos independentes simultaneamente.
