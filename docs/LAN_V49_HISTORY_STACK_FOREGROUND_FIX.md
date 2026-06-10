# LAN v49 — Histórico, Empilhamento, Equipamento e Reconexão

## Objetivo
Corrigir regressões encontradas na v48:

- card de histórico da sessão não podia sumir;
- envio repetido do mesmo item pelo mestre precisava empilhar quantidade;
- equipar/desequipar item estava piscando ou revertendo;
- jogador recebia centenas/milhares de eventos após resync;
- voltar de outro app/ferramentas podia deixar mestre/jogador dessincronizados;
- navegação na criação/ficha não deve deixar o usuário preso em telas antigas.

## Correções aplicadas

### 1. Histórico da sessão sempre visível ao mestre
`renderTimelineCard()` agora sempre renderiza o card quando há sessão ativa, mesmo que ainda não exista evento visível. Isso evita a regressão onde o mestre perdia o registro da campanha.

### 2. Loop de inventory_patch corrigido
A causa do flood era:

```txt
jogador envia inventory_patch
host valida e emite inventory_patch oficial
callback do host recebia o próprio inventory_patch oficial
host processava de novo como comando do jogador
novo inventory_patch oficial
loop...
```

Agora `handleHostInventoryPatchEvent()` ignora qualquer `inventory_patch` com:

```ts
fromKey === 'master' || originClientId === 'master'
```

Evento oficial do mestre é confirmação para jogador, não comando para o host reprocessar.

### 3. Resync não despeja histórico vivo inteiro
`getEventsAfterSeq()` deixou de reenviar `player_patch`, `inventory_patch`, `effect_patch`, `pending_save_patch`, `public_status` e `timeline_event` antigos. Estado vivo volta por checkpoint único.

Isso reduz o caso onde o jogador gerava 900/2000 logs recebendo centenas de eventos antigos.

### 4. Checkpoints não exigem ACK
Checkpoints de player/effect/inventory passaram a usar:

```ts
ackRequired: false
```

Eles servem para corrigir estado, não para acionar retry/ACK em massa.

### 5. Empilhamento de item mais tolerante
O empilhamento normaliza:

- maiúsculas/minúsculas;
- acentos;
- espaços duplicados;
- `[]`, `{}`, `null`, `undefined` como vazio.

Assim `Ampulheta`, `ampulheta` e `Ampulheta ` agrupam. Também evita que `effect_json: []` e campo ausente sejam tratados como itens diferentes.

### 6. Runtime do mestre publicado no transporte
Quando o mestre aplica inventário/equipamento no runtime, o payload vivo do host também é atualizado com `updateLanTcpHostPayload(..., { broadcast: false })`. Isso ajuda quem volta de outro app/ferramentas a receber estado atual, não snapshot antigo.

### 7. Navegação da criação
O botão físico de voltar do Android em `create.tsx` agora volta direto para `index.tsx`, evitando navegar por histórico antigo de telas.

## Arquivos alterados

- `src/app/lan-session.tsx`
- `src/services/lanTcpTransport.ts`
- `src/app/create.tsx`
- `src/app/sheet.tsx`
- `src/services/lanSession.ts`

## Critérios de teste

1. Mestre abre sessão e concede `Ampulheta` 1x.
2. Jogador vê `Ampulheta x1`.
3. Mestre concede `Ampulheta` novamente.
4. Jogador deve ver `Ampulheta x2`, não duas linhas.
5. Mestre concede quantidade 4.
6. Jogador deve ver `Ampulheta x6` se já tinha 2.
7. Jogador equipa item.
8. Mestre deve ver equipado sem piscar/sumir.
9. Abrir ferramentas do mestre ou trocar de app e voltar.
10. Comunicação deve continuar sem precisar fechar app.
11. Gerar tracer: não deve explodir com milhares de `PLAYER_EVENT_RECEIVED` para eventos antigos.
