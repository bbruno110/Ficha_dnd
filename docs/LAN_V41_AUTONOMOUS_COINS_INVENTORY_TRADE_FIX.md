# LAN v41 - Correção consistente de moedas, inventário, envio e troca

## Problemas corrigidos

### 1. Moeda do jogador não atualizava o mestre de forma confiável
Antes, redução/conversão usava `coin_self_patch_request`, enquanto aumento usava `resource_request` e outras ações podiam disparar `sendLanTcpJoin`. Isso deixava o fluxo inconsistente.

Agora:
- redução/conversão de PO/PP/PC usa `player_patch` oficial com `coinPatchRequest` anexado;
- o host valida se o valor total em cobre não aumentou;
- se não aumentou, aplica no roster oficial e devolve `player_patch` autoritativo;
- se aumentou, só passa por `resource_request` e aprovação do mestre.

### 2. Pedido de recurso disparava rejoin/snapshot desnecessário
Antes, `sendResourceRequest` ainda chamava `notifyMasterJoin` em background. Isso criava snapshots/rejoins durante pedido de XP/moeda e podia atrasar ou confundir estado.

Agora pedido de recurso envia apenas o evento. O host cria/reativa o jogador pelo próprio evento quando necessário.

### 3. Inventário autônomo podia falhar se o cache do mestre estivesse atrasado
Equipar, dropar, consumir, doar ou arremessar podem acontecer em sequência. O host às vezes validava contra um inventário antigo.

Agora `inventory_patch` carrega também `baseEquipment`, o inventário local antes da ação. O host valida aumento contra esse snapshot base, não apenas contra o cache SQLite antigo.

### 4. Envio de item podia reverter inventário da origem
Antes o host tentava remover o item do cache autoritativo. Se esse cache estivesse atrasado, o patch oficial podia devolver um inventário antigo ao jogador.

Agora `send_item_request` carrega:
- `sourceEquipmentBefore`;
- `sourceEquipmentAfter`.

Se o `sourceEquipmentAfter` não tem aumento líquido em relação ao `sourceEquipmentBefore`, o host o aceita como inventário oficial da origem e adiciona o item ao destino.

### 5. Mestre não atualizava runtime imediatamente em moeda autônoma
Depois de aceitar uma redução/conversão, o host agora atualiza o `sessionState` imediatamente, envia `player_patch` oficial ao jogador e atualiza status público.

## Regras mantidas

- Jogador pode reduzir moeda.
- Jogador pode converter moeda sem aprovação se o valor total não aumentar.
- Jogador pode equipar/desequipar, dropar, arremessar, consumir, doar e trocar itens próprios.
- Jogador não pode aumentar moeda ou quantidade de item sem aprovação/origem válida.
- Mestre pode enviar PO, PP e PC separadamente.

## Arquivos alterados

- `src/app/sheet.tsx`
- `src/app/lan-session.tsx`
- `src/services/lanSession.ts`
