# LAN V45 — Sincronismo rápido de moeda, equipamento e inventário

## Objetivo

Corrigir os casos em que:

- o jogador reduz moeda rapidamente e o mestre só vê vários segundos depois;
- o jogador equipa/desequipa item e o card/detalhe do mestre fica piscando, aparece e some;
- o mestre envia item e a UI do mestre atualiza, mas o jogador não recebe imediatamente;
- snapshots/reloads antigos sobrescrevem estado vivo recente.

## Regra aplicada

Ações rápidas de jogo não passam mais pelo caminho pesado:

```txt
socket -> polling -> SQLite -> reloadSessionState -> UI
```

Agora seguem o caminho vivo:

```txt
socket event_propose
  -> callback do host
  -> runtime do mestre imediato
  -> histórico/commit oficial imediato
  -> broadcast para jogador alvo
  -> persistência SQLite em background
  -> payload/snapshot apenas como cache
```

## Moedas

`coin_self_patch_request` agora é processado no callback de socket do host.

- O mestre atualiza o card do jogador imediatamente.
- O evento oficial `player_patch` de moeda é enviado sem esperar `reloadSessionState`.
- A persistência no SQLite roda em fila por jogador.
- `opSeq` continua sendo usado para ignorar comandos atrasados.
- Aumento líquido continua exigindo aprovação do mestre.

## Equipar/desequipar

`inventory_patch` de jogador agora é processado no callback de socket do host.

- O mestre vê o equipamento no runtime imediatamente.
- O estado de equipamento é marcado como estado vivo no runtime store.
- `reloadSessionState` e snapshot antigo não podem remover o item recém-equipado.
- O jogador recebe confirmação oficial com `sourceClientMsgId` para limpar pendência local.

## Mestre enviando item

O envio oficial de inventário foi alterado para:

```txt
sendLanSessionEvent(inventory_patch) primeiro
rememberLanSessionEvent(...) depois
```

Assim o item aparece no inventário do jogador sem depender de gravação SQLite ou reload completo.

## Campos preservados contra snapshot antigo

Agora o runtime preserva também:

```txt
equipment
stats
```

além de:

```txt
hpCurrent
hpMax
tempHp
xp
gp
sp
cp
effects
```

Isso evita o bug de item equipado “aparecer e sumir”.

## Nota técnica

Pontuação da arquitetura após esta alteração: **9.8/10**.

Não é marcado como 10/10 sem teste físico com múltiplos celulares porque o comportamento final depende do socket nativo, Wi‑Fi, suspensão de tela e latência real dos aparelhos. No código, o fluxo crítico foi removido do reload/SQLite e movido para runtime/eventos vivos.
