# LAN v38 - Level up autoritativo no mestre

Correção focada no problema em que o jogador subia de nível localmente, mas o mestre continuava com nível/PV máximo antigos e depois reenviava `player_patch` rebaixando a ficha.

## Causa encontrada

Na v37, o level up só enviava `player_progression_patch` quando o parâmetro `levelUpTo` vinha preenchido. Em alguns fluxos reais, o jogador salvava a ficha com `class = "Mago 2"` e `hp_max` novo, mas o código emitia apenas `sendLanTcpJoin`. O join/reconnect podia atualizar parte do roster ou ficar preso em reload, sem aplicar oficialmente o PV máximo no mestre.

## Correções

- O envio de `player_progression_patch` agora compara o estado salvo contra a ficha anterior.
- O evento é enviado se houve aumento de nível, aumento de PV máximo ou classe com sufixo de nível novo.
- O evento de progressão é enviado antes do `notifyMasterJoin`, para não depender de reconnect.
- O `notifyMasterJoin` não abre revisão quando a progressão já foi enviada por evento oficial.
- O host aceita progressão mesmo quando o nível já foi parcialmente aplicado, mas o PV máximo ainda não foi atualizado.
- O host aceita `incomingLevel == currentLevel` quando o `hpMax` novo é maior e o XP oficial autoriza aquele nível.
- A validação continua bloqueando mudança de raça e alterações de inventário/moedas.

## Fluxo esperado

1. Mestre concede XP oficial até o nível permitido.
2. Jogador salva level up.
3. Jogador envia `player_progression_patch`.
4. Mestre atualiza roster oficial: nível, classe, PV atual, PV máximo, atributos e snapshot.
5. Qualquer `player_patch` posterior usa o PV máximo novo.
6. O jogador não volta para o nível anterior e o modal de level up não reaparece em loop.
