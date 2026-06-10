# LAN v37 - Level up como evento oficial

Problema observado nos logs:

- O jogador salvava o level up localmente e fazia `sendLanTcpJoin` com classe como `Mago 2`.
- O host tratava isso como join/reconnect comum.
- Em algumas situações havia reload/timeout no caminho de join, então o roster do mestre permanecia no nível antigo.
- Depois o mestre enviava `player_patch` de HP baseado no roster antigo (`hpMax` antigo e sem nível), fazendo a ficha do jogador parecer pronta para subir de nível de novo.

Correção:

- Level up agora envia `player_progression_patch` explícito para o host.
- O host valida se o XP oficial autoriza o nível novo.
- Se autorizado, atualiza o roster oficial do mestre imediatamente.
- O jogador preserva `hpMax` local de level up quando recebe `player_patch` antigo com `hpMax` menor, desde que o XP oficial já autorize o nível atual.
- XP pedido pelo jogador continua sendo `resource_request` e exige aceite do mestre.
