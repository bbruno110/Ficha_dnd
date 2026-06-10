# LAN v47 — Correção de navegação, histórico, atributos e inventário

## Problemas corrigidos

1. **Voltar da ficha**
   - A tela `sheet` agora sempre volta para `index.tsx` usando `router.replace('/')`.
   - Isso vale no offline e no multiplayer LAN.
   - O botão voltar físico do Android também volta para a Home.
   - A ficha não volta mais para `edit.tsx`/level up pelo histórico de navegação.

2. **Histórico duplicado**
   - O histórico do mestre agora usa uma chave de deduplicação por `id`, `clientMsgId`, `sourceClientMsgId` e `tradeId`.
   - `resource_review`, `player_patch`, `effect_patch` e `inventory_patch` vindos do mesmo comando não devem aparecer duplicados.
   - O patch técnico de confirmação de recurso aceito não aparece duplicado quando já existe a mensagem de aceite no histórico.

3. **Atributo permanente e temporário**
   - Pedido de atributo permanente aprovado pelo mestre agora gera `player_patch` com `statsPatch` em tempo real.
   - O jogador aplica `statsPatch` recebido por socket imediatamente, antes do SQLite.
   - Buff temporário/condição aprovado pelo mestre agora vira `effect_patch` vivo imediatamente.

4. **Envio de item pelo mestre**
   - Removido cooldown que impedia clicar novamente para somar quantidade.
   - Cada clique de envio gera uma nova entrega válida.
   - Se o jogador já possui o item, a quantidade é somada.
   - O patch oficial de inventário é enviado antes da persistência.

5. **Envio/troca entre jogadores**
   - `send_item_request` e `trade_accept` passam a ter caminho rápido no callback do socket do host.
   - O host atualiza runtime dos envolvidos, manda `inventory_patch` e só depois persiste no SQLite.
   - Se o caminho rápido não conseguir validar os envolvidos, cai no caminho antigo como fallback.

## Arquivos alterados

- `src/app/sheet.tsx`
- `src/app/lan-session.tsx`
- `src/hooks/useLanRealtimePlayerPatches.ts`

## Critérios de aceite

- Da ficha, offline ou LAN, o botão voltar e o botão físico devem ir para a Home.
- Histórico não pode duplicar a mesma solicitação/aceite/evento vivo.
- Mestre aprova aumento de atributo e o jogador vê o atributo mudar sem reabrir ficha.
- Mestre aplica buff temporário e o jogador vê o efeito/atributo rapidamente.
- Mestre envia item repetidas vezes e a quantidade soma.
- Jogador envia item ou conclui troca e os inventários dos envolvidos atualizam sem reload.
