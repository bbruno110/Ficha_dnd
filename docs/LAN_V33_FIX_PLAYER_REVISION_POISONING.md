# LAN v33 - Correção assertiva de HP/ficha e checkpoint legado

## Problema encontrado nos logs

A ficha do jogador recebia vários `checkpoint_player_*` com `entityRevision` baseado em timestamp (`Date.now()`), por exemplo `1780679871041`.
Depois disso, os eventos reais de HP do mestre chegavam com revisão normal `1`, `2`, `3`...

Como o runtime comparava revisão por agregado, os eventos reais eram tratados como antigos e não aplicavam na ficha.
Resultado: o card da sessão podia mudar, mas a ficha não acompanhava.

## Correção

- `checkpoint_player_*` legado com revisão em timestamp não avança mais a versão do agregado `player`.
- O host não usa mais `player.revisionSeq` para decidir checkpoint de HP/XP/moedas/PV temporário.
- Checkpoint de player só é gerado quando já existe evento `player_patch` real para aquele agregado.
- A ficha normaliza revision de checkpoint legado antes de comparar com o último patch autoritativo.
- Eventos reais `player_patch` revision `1..N` voltam a ser aplicados corretamente.

## Efeito esperado

- HP do mestre atualiza o card e a ficha do jogador.
- Vários cliques de HP continuam entrando em ordem.
- Resync/checkpoint não bloqueia dano, cura, XP ou PV temporário.
- Snapshots continuam servindo apenas para bootstrap estrutural.
