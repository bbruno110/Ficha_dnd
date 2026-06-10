# LAN v46 — Runtime-first para histórico, turno, efeitos e solicitações

## Problema corrigido

Os logs mostravam que alguns fluxos ainda esperavam SQLite, payload ou `reloadSessionState` antes de atualizar a mesa:

- histórico da sessão demorava para aparecer;
- passagem de tempo/turno demorava;
- expiração de efeitos/condições/PV temporário demorava;
- solicitação do jogador chegava tarde ao mestre;
- ao aceitar +moeda, o mestre podia mandar `player_patch` com revisão/valor antigo, então o jogador recebia a resposta mas a ficha não atualizava corretamente.

## Regra aplicada

Para fluxo vivo da sessão:

```txt
UI Action
  -> Runtime Update imediato
  -> Histórico imediato
  -> Evento vivo no socket
  -> Persistência SQLite em background
  -> Payload/snapshot apenas como cache posterior
```

## Alterações principais

### 1. Solicitação do jogador ao mestre

`resource_request` agora entra no histórico do mestre imediatamente no callback do socket.

Antes:

```txt
socket -> rememberLanSessionEvent -> ensurePendingPlayer -> setSessionEvents
```

Agora:

```txt
socket -> setSessionEvents imediato -> persistência em background
```

### 2. Aceite do mestre para moeda/XP/HP/PV temporário

O aceite não usa mais o caminho lento:

```txt
applyLanResourceRequest -> getLanSessionState -> syncPayload -> player_patch
```

Agora o aceite faz:

```txt
runtime atual do mestre -> calcula patch -> atualiza UI do mestre -> envia player_patch -> persiste em background
```

Isso evita o bug em que o jogador tinha 8 moedas, pedia +1 duas vezes, o mestre aceitava, mas o jogador não ia para 10.

### 3. Histórico rápido

`resource_review`, `player_patch`, `effect_patch`, `session_patch`, `effect_expired` e eventos de turno são adicionados ao histórico em memória antes de SQLite.

### 4. Turno/tempo runtime-first

A passagem de turno agora envia imediatamente:

- `session_patch`;
- `effect_patch` com decremento/remoção de efeito;
- `effect_expired` para efeitos encerrados.

A função `advanceLanSessionTime` ainda persiste o estado depois, mas não bloqueia a UI nem o socket.

### 5. Efeitos/condições

Ao aplicar efeito rápido do mestre, o histórico aparece antes do ACK do socket.

Ao avançar turno, efeitos com `remaining = 0` são removidos no runtime e enviados para o jogador imediatamente.

## Arquivos alterados

```txt
src/app/lan-session.tsx
```

## Critério de aceite

1. Jogador pede +1 moeda duas vezes.
2. Mestre vê as duas solicitações imediatamente.
3. Mestre aceita as duas.
4. Jogador deve subir de 8 para 10 sem esperar reload.
5. Ao passar turno, turno e efeitos expirados aparecem rapidamente no mestre e jogador.
6. Buff/condição/PV temporário não deve ficar preso na UI depois de expirar.
7. Histórico da partida não pode depender de `reloadSessionState`.
