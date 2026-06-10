# LAN v90 - Estabilidade pós-level-up e reconexão

## Problema observado

Após o jogador subir de nível, a ficha era atualizada, mas a sincronização ficava instável. O jogador precisava sair/abrir a ficha para atualizar e o mestre parecia perder a conexão ou ter dificuldade para aplicar novos eventos.

Nos logs, o level-up foi aceito e o mestre já enviava `player_patch` com `hpMax` atualizado, porém vários `reloadSessionState` longos continuavam rodando em paralelo. Alguns duraram de 2s a 6,7s e competiam com os eventos vivos de dano/cura/efeito.

## Correção

- Adicionado lock de runtime vivo no mestre (`MASTER_LIVE_RUNTIME_LOCK_HELD_V90`).
- `reloadSessionState` não roda durante a janela crítica após level-up, dano, cura, efeito, inventário ou status público.
- O level-up segura o lock por uma janela maior para evitar que snapshot/cache antigo rebaixe HP máximo ou nível.
- Payload/snapshot recebido pelo jogador não pode rebaixar a própria ficha se a ficha local já está em nível/HP máximo mais novo.
- O card público do próprio jogador também protege progressão local contra payload antigo durante reentrada na ficha.

## Resultado esperado

Depois do level-up:

1. Mestre aceita o novo nível/HP máximo imediatamente.
2. Dano/cura continuam funcionando sem precisar sair e voltar.
3. Snapshots antigos não fazem a ficha piscar para nível/HP antigo.
4. Reabrir a ficha continua permitido, mas não deve ser necessário para restaurar a sincronização.
