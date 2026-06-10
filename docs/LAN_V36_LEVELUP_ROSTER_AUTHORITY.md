# LAN V36 - Level up autônomo sincronizado no mestre

## Problema corrigido

O jogador subia de nível localmente, mas o mestre continuava com o roster antigo. Depois disso, qualquer `player_patch` do mestre usava `level`, `hpMax` e snapshot antigos, fazendo a ficha do jogador voltar para o nível anterior ou receber HP máximo antigo.

Nos logs isso aparecia assim:

- Jogador recebia XP oficial suficiente.
- Jogador salvava a ficha como `Monge 2` e enviava `sendLanTcpJoin`.
- Mestre registrava apenas `MASTER_JOIN_UPSERT_DONE`, sem atualizar o roster oficial para nível 2.
- O próximo patch do mestre continuava baseado no estado antigo.

## Regra final

- XP solicitado pelo jogador continua dependendo de aceite do mestre.
- Level up depois de XP oficial suficiente é autonomia do jogador.
- Quando o jogador salva o level up, o host aceita automaticamente a progressão se:
  - o nível novo for maior que o nível atual;
  - o XP oficial conhecido autorizar esse nível;
  - não houver troca de raça;
  - não houver mudança bloqueada de moedas/inventário.

## Mudanças

- `upsertLanSessionPlayerFromNetwork` agora detecta progressão de nível autorizada mesmo quando `reviewSnapshot` não chega no pacote de join.
- Novo helper `updateLanPlayerProgressionFromNormalizedSnapshot` atualiza:
  - level;
  - class_name;
  - character_snapshot;
  - stats_json;
  - hp_max/hp_current do level up.
- O helper preserva recursos vivos do mestre:
  - XP oficial nunca é reduzido pelo snapshot do jogador;
  - moedas não são sobrescritas;
  - inventário não é sobrescrito.

## Resultado esperado

1. Mestre concede XP até 300.
2. Jogador sobe do nível 1 para o nível 2.
3. Mestre atualiza roster para nível 2 automaticamente.
4. Próximos patches de HP do mestre não fazem a ficha voltar para nível 1.
