# LAN v32 - Runtime rápido + reconciliação leve

Correção feita sobre a v31 após teste com múltiplos celulares.

## Problemas observados nos logs

1. O `reloadSessionState` ainda rodava muitas vezes no mestre durante joins, ACKs e comandos vivos. Isso fazia o SQLite competir com HP, troca e envio de item.
2. `player_patch` no jogador atualizava a UI, mas aguardava leitura/gravação SQLite antes do ACK. Em LAN isso deixava o card da sessão e a ficha visualmente divergentes.
3. O resync criava checkpoints de efeito e inventário usando `player.revisionSeq` como fallback. Assim, qualquer alteração de HP/XP podia gerar checkpoint de inventário/efeito, enchendo a fila e atrasando troca/envio.

## Mudanças

- `player_patch` agora é aplicado na ficha imediatamente e a persistência SQLite roda em background.
- `reloadSessionState` ganhou cooldown para chamadas não críticas.
- Quando um reload já está rodando, chamadas não críticas não ficam enfileiradas.
- Checkpoint de efeito só usa revisão real do agregado `effect`.
- Checkpoint de inventário só usa revisão real do agregado `inventory`.
- Snapshot/checkpoint deixam de competir com envio/troca quando a alteração é apenas HP/XP/moedas.

## Resultado esperado

- Vida no card e na ficha devem atualizar juntas.
- Troca/envio continuam autoritativos, mas com menos fila travando atrás de reload/checkpoint.
- Reconexão continua possível, mas sem replay pesado desnecessário.
