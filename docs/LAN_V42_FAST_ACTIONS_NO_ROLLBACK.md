# LAN v42 — Ações rápidas sem rollback visual

Objetivo: corrigir atraso e rollback visual em botões rápidos de HP/PV temporário/moedas.

## Causa encontrada nos logs

O jogador aplicava várias reduções rápidas de moeda localmente, por exemplo 60 -> 59 -> 58 -> 57. Depois o host devolvia confirmações absolutas antigas (`player_patch`) contendo valores intermediários, como `gp:57`, quando a ficha local já estava mais abaixo. A ficha aplicava esse eco antigo e parecia voltar.

Também havia duplicidade de aplicação do mesmo evento em alguns fluxos, com `PLAYER_APPLY_EVENT_START` repetido para o mesmo `eventId`.

## Correções

### 1. Moeda autônoma agora usa evento próprio

Redução/conversão de moeda do jogador sai como:

```ts
coin_self_patch_request
```

Não sai mais como `player_patch` genérico.

O host valida:

- se o total em cobre diminuiu ou ficou igual: aceita;
- se aumentou: rejeita e continua exigindo aprovação do mestre.

### 2. Debounce curto para clique rápido de moeda

Vários cliques rápidos de `-1 PO` são aplicados imediatamente na UI local, mas o socket envia o último estado consolidado depois de 120 ms. Isso reduz fila, ACK e eco atrasado.

### 3. Proteção contra eco antigo

A ficha mantém `pendingSelfCoinStateRef`. Se chegar um patch absoluto do mestre com moeda maior que o valor local enquanto existe alteração própria recente, a ficha ignora apenas `gp/sp/cp` desse patch e ainda aplica HP/XP/PV se houver.

Isso impede:

```txt
60 -> 59 -> 58 -> 57 -> volta 59/57
```

### 4. Intenção do numberPatch

Eventos oficiais agora carregam:

```ts
numberPatchIntent: 'hp' | 'temp_hp' | 'xp' | 'coins' | 'self_coin' | 'mixed'
```

Assim a ficha sabe diferenciar:

- ajuste explícito de moeda feito pelo mestre;
- eco de moeda do próprio jogador;
- patch de HP que só carrega moeda junto por ser absoluto.

### 5. Dedupe geral no jogador

`handleLanEvents` agora deduplica todos os eventos por `event.id`, evitando aplicar o mesmo `player_patch`/`inventory_patch` duas vezes quando chega por snapshot/resync/socket ao mesmo tempo.

### 6. Persistência do botão rápido do mestre não bloqueia a fila viva

`persistHostNumberPatch` envia o evento vivo primeiro e agenda SQLite em background. Isso evita o botão rápido de HP ficar preso esperando gravação/reload antes de liberar o próximo comando.

## Arquivos alterados

- `src/app/sheet.tsx`
- `src/app/lan-session.tsx`
- `src/services/lanSession.ts`
