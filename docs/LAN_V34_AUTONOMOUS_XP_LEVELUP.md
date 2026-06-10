# LAN v34 - XP e level up autônomos

## Problema corrigido

Na v33, o jogador em modo LAN ainda usava o fluxo de `resource_request` para alterar XP pela ficha. Isso fazia o XP depender do mestre aceitar, e só depois o host emitia um `player_patch`. Nos logs, entre o clique do jogador para adicionar XP e o patch oficial, havia vários segundos de atraso.

Além disso, ao subir de nível, a ficha enviada ao mestre usava `reviewSnapshot`, criando evento de revisão/solicitação de alteração de personagem. Para o requisito do app, level up é autonomia do jogador e não deve depender de aceite do mestre.

## Alterações

- XP em LAN agora é aplicado imediatamente na ficha local do jogador.
- O jogador envia `player_patch` ao host apenas para espelhar o XP no roster oficial.
- O host passa a aceitar `xp` em `applyLanPlayerNumberPatch` quando o patch vem do próprio jogador.
- Level up com `reviewSnapshot` agora é autoaceito quando é progressão de nível do próprio jogador e não envolve mudanças bloqueadas como inventário, moedas ou raça.
- A autoaceitação de level up não cria mais `character_update_review`, evitando notificação de “mestre precisa aceitar”.
- `syncLanFromHost` não abre mais revisão por diferença de nível quando o jogador já subiu localmente.
- Checkpoints antigos de player com revisão baseada em timestamp são ignorados também na geração do checkpoint, evitando envenenar revisões de HP/XP.
- Aceite de `resource_request` não faz mais reload completo imediato depois de enviar o patch vivo.

## Resultado esperado

- Jogador adiciona XP: aparece na ficha imediatamente.
- Se atingir XP de novo nível: botão/modal de level up aparece na hora.
- Jogador salva level up: ficha local atualiza e host sincroniza sem pedir aprovação.
- Mestre ainda vê o jogador atualizado na sessão.
- HP/XP não ficam presos atrás de `reloadSessionState` ou checkpoints legados.
