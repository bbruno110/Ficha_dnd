# Refatoração LAN - Fluxo Final

## 1. Resumo

A refatoração LAN consolidou o estado vivo multiplayer na engine/projection. A projection passa a ser a fonte primária para HP, HP máximo, PV temporário, XP, moedas, inventário, equipamento, CA, modificadores, efeitos, condições, turno, status da sessão, sessão encerrada, testes pendentes, transações de item e recompensas.

O estado antigo vindo de SQLite, snapshot, payload, reload, public_status, stores e hooks permanece apenas como bootstrap, cache, compatibilidade visual ou histórico. Quando existe projection viva, esses caminhos não devem sobrescrever gameplay.

## 2. Causa raiz dos bugs

A causa raiz era a concorrência entre várias fontes tentando corrigir a ficha ao mesmo tempo: snapshot antigo, SQLite, public_status, callbacks locais de hook, stores runtime, payload_update e eventos LAN. Isso gerava rollback de HP, cura dupla, item consumido reaparecendo, equipamento piscando, efeito removido voltando, sessão encerrada reabrindo e alerta duplicado de save.

## 3. Arquitetura anterior

A arquitetura anterior misturava transporte, store, SQLite, hooks e tela como fontes de gameplay. Eventos como `player_patch`, `effect_patch`, `inventory_patch`, `pending_save_patch`, `public_status` e payloads podiam aplicar estado por caminhos diferentes. O host também usava reload e locks defensivos para tentar evitar rollback, mas isso apenas mascarava a disputa de fontes.

## 4. Nova arquitetura

O fluxo novo é:

1. tela cria comando;
2. bridge despacha para engine;
3. engine valida projection atual;
4. engine gera evento autoritativo;
5. reducer aplica evento na projection;
6. transporte replica o evento;
7. telas renderizam projection;
8. SQLite persiste em background/cache.

Single player continua SQLite-first. LAN é projection-first.

## 5. Engine LAN

A engine LAN fica em `src/services/lan/engine/*`. Ela contem tipos, comando -> evento, reducer, snapshot policy, bridge e adapter legado.

Comandos suportados/consolidados:

- `apply_damage`;
- `apply_heal`;
- `apply_temp_hp`;
- `apply_effect`;
- `remove_effect`;
- `advance_turn`;
- `pause_session`;
- `resume_session`;
- `end_session`;
- `consume_item`;
- `equip_item`;
- `unequip_item`;
- `grant_xp`;
- `set_xp`;
- `add_coins`;
- `set_coins`;
- `request_reward`;
- `grant_reward`;
- `send_item`;
- `donate_item`;
- `trade_item`;
- `use_spell`;
- `apply_pending_save`;
- `resolve_pending_save`;
- `apply_self_effect`.

## 6. Projection única

`SessionProjection` agora guarda jogadores, pending saves e transações/histórico de trade/reward. `CharacterProjection` guarda HP, XP, moedas, inventário, equipamento, efeitos ativos, atributos base, atributos efetivos e derivados como CA.

A projection registra `appliedEventIds` e `appliedCommandIds`, impedindo replay de cura, consumo, save, magia, trade ou reward.

## 7. Revisões por agregado

A engine usa revisões separadas por agregado:

- sessão;
- player;
- inventário;
- efeito;
- pending save;
- trade;
- transação.

Isso evita que um evento antigo de inventário bloqueie HP novo, ou que um snapshot antigo restaure efeito/item removido. `Date.now()` do transporte não é usado como revisão de domínio quando o valor parece seq/timestamp legado.

## 8. Fluxo do mestre

O mestre deve enviar comandos para a engine para dano, cura, PV temporário, efeitos, turno, pausa, retomada, encerramento, XP, moedas, recompensa e resolução de saves. A UI do mestre pode manter lista visual/histórica, mas o gameplay vivo sai da projection.

## 9. Fluxo do jogador

O jogador lê a ficha por `useLanProjection`. Consumo, equipamento e envio direto de item podem passar por `dispatchPlayerCommand`. Ações que dependem de regra/autorização do mestre devem virar comando/evento autoritativo, não patch solto.

## 10. HP, cura e dano

HP, cura, dano e PV temporário são `player_patch` ou `effect_patch` gerados pela engine. Dano consome PV temporário antes de HP. Cura respeita `hpMax`. Replay do mesmo evento não altera HP novamente.

## 11. XP e moedas

Atualizacao Bug 2 (2026-06-12): comandos diretos de XP/moeda geram `character_transaction`; pedidos de recompensa usam `request_reward`/`grant_reward`; pedido legado de moeda com valor final usa `set_coins`; replay, snapshot antigo, ACK/NACK e `public_status` nao alteram XP/moedas.

XP e moedas possuem comandos explícitos:

- `grant_xp` soma XP;
- `set_xp` fixa XP;
- `add_coins` soma moedas;
- `set_coins` fixa moedas.

Snapshot antigo não reverte XP/moedas novas. ACK/NACK e `public_status` não alteram XP/moedas.

## 12. Consumo de itens

`consume_item` é uma transação única: localiza item, aplica cura/efeito, baixa quantidade, remove se zerar e grava tombstone. A poção ou item não volta por snapshot antigo.

## 13. Poção de Cura 2d4+2

A poção `Cura 2d4+2` é parseada pelo serviço de fórmula e rolada uma vez no evento. O evento carrega a rolagem e o patch final. Replay, ACK/NACK ou resync duplicado não curam novamente.

## 14. Equipamentos, CA e modificadores

`equip_item` e `unequip_item` usam transação da engine. A projection recalcula bônus derivados por equipamento, sem contaminar atributos base. Armadura/escudo podem alterar CA; desequipar remove o bônus.

## 15. Magias

`use_spell` cobre a base de magia com cura, dano, efeitos/condições e save pendente. Se a magia tiver fórmula, ela é rolada uma vez no evento. Se tiver efeito, entra como efeito de origem `spell`. Se tiver save, cria pending save na projection.

Pendência real: nem todo campo do banco/modelo de magias foi mapeado na UI para `use_spell`; regras incompletas do catálogo devem ser documentadas caso a caso.

## 16. Saves/testes de resistência

`apply_pending_save` cria alerta pendente em `projection.pendingSaves`. `resolve_pending_save` resolve o alerta, registra resultado e pode remover efeitos vinculados ou aplicar efeito em falha. A idempotência impede alerta duplicado e snapshot antigo não reabre save resolvido.

## 17. Trocas, envio e doação

`send_item`, `donate_item` e `trade_item` são transações multi-alvo. O item sai de um jogador e entra no outro dentro do mesmo evento da engine. Replay do evento não duplica item.

`sheet.tsx` foi ajustado para envio direto de item pela engine quando possível. A UI antiga de proposta/contra-proposta ainda existe como compatibilidade e deve ser removida quando for redesenhada para transaction-first.

Atualizacao Bug 3 (2026-06-12): stack de inventario fica normalizado em `LanInventoryRules`. IDs transitorios (`id`, `inventoryItemId`, `clientMsgId`, `sourceId`, timestamps) nao separam stack. Itens stackaveis iguais, como `10 Dardos`, somam qty; itens com efeito diferente e equipamentos/magicos nao stackaveis permanecem separados. `send_item`, `donate_item`, `trade_item` e `grant_reward` usam projection/engine como fonte final, com SQLite em background.

## 18. Efeitos temporários

Efeitos vivem na projection. Avanço de turno/minuto/hora/descanso passa pela engine, decrementa duração e gera tombstone para efeitos expirados/removidos. PV temporário vinculado a efeito expira junto.

## 19. Passagem de turno

`advance_turn` chama `advanceProjectionTurn`. O reducer atualiza turno, tempo decorrido, efeitos alterados, efeitos expirados e PV temporário removido. Isso evita turno duplicado e decremento de efeito em caminhos paralelos.

## 20. Snapshot, resync e reconnect

Snapshot entra apenas por `applyIncomingSnapshot`. Se a projection já tem eventos aplicados, snapshot estrutural antigo é ignorado. Snapshot antigo não restaura efeito removido, item consumido, HP, XP, moedas, equipamento ou sessão encerrada.

Reconnect/resync reaplica eventos por `eventId`/`commandId`; duplicatas não causam cura, consumo ou trade novamente.


## Correção pós-logs reais de aparelhos

Os logs reais do mestre e do jogador mostraram que alguns fluxos ainda chegavam pela camada legada: ajuste permanente de atributo entrava como `effect_patch` visual, XP/moedas aceitos ainda podiam virar `player_patch`, itens como `10 Dardos` duplicavam stack por causa de IDs transitorios e eventos transacionais novos nao eram serializados para todos os clientes.

As correcoes aplicadas foram:

1. `Ajuste permanente de INT` e outros ajustes permanentes agora usam `isPermanentStatAdjustment`; o reducer altera `baseStats`/`effectiveStats` e nao cria efeito ativo visual.
2. Condicoes temporarias continuam visiveis e preservam `color`, `secondaryColor` e prioridade visual para breath/fade.
3. A stack key de itens stackaveis ignora IDs transitorios e considera identidade real do item: nome, tipo/categoria, dano, tipo de dano, propriedades, descricao e efeito funcional.
4. Patches de XP/moedas no mestre, quando ha projection, sao redirecionados para comandos da engine (`set_xp`, `set_coins`, `grant_xp`, `add_coins`) que geram transacao autoritativa.
5. Aceite de pedido de jogador para XP/moeda agora aplica resultado via `grant_reward`; pedido antigo de moeda que traz valor final usa `set_coins`.
6. Eventos `character_transaction`, `party_transaction`, `spell_transaction` e `reward_transaction` sao convertidos para envelopes LAN e tratados como eventos vivos pelo cliente.
7. `effect_save_request` legado e convertido para `pending_save_patch` para entrar na projection de saves.

Essas correcoes atacam diretamente os sintomas observados nos logs: card com ajuste permanente como efeito, moeda/XP aceitos sem atualizar, item duplicado em stack, condicao sem cor visual e eventos transacionais nao chegando ao jogador.

## CorreÃ§Ã£o Bug 1 - ajuste permanente nao e efeito visual

Em 2026-06-12, a regra foi revalidada para payloads legados: qualquer ajuste permanente com `target` de atributo (`FOR`, `DES`, `CON`, `INT`, `SAB`, `CAR`, `CA`) e `unit: "permanent"`/`isPermanent: true` altera `baseStats` e recalcula `effectiveStats`, mesmo se o payload vier como `kind: "buff"` ou `kind: "custom"`.

Esse ajuste permanente nao entra em `activeEffects`, nao aparece em `getVisibleEffects`, nao ativa cor/breath/fade e nao expira por turno. Ajustes temporarios de atributo continuam entrando em `activeEffects`, somam em `effectiveStats` e expiram conforme duracao. Condicoes temporarias como `Paralisado` continuam visuais e preservam `color`/`secondaryColor`.

## Correcao Bug 2 - XP, moedas e pedidos numericos

Em 2026-06-12, XP/moedas foram fechados como projection-first:

- `grant_xp`, `set_xp`, `add_coins` e `set_coins` geram `character_transaction`.
- `request_reward` cria pedido pendente sem alterar a ficha.
- `grant_reward` aplica XP/moedas e marca o pedido como `committed`.
- `coin_self_patch_request` deixou de aplicar moeda direto; o host converte em `resource_request` revisavel.
- A ficha do jogador nao faz mais atualizacao otimista de moeda em LAN; ela aguarda o evento autoritativo do mestre.
- `reloadSessionState`, snapshot antigo, ACK/NACK e `public_status` nao vencem XP/moedas da projection.

## Correcao Bug 3 - stack, envio, doacao e troca de itens

Em 2026-06-12, inventario LAN foi fechado como projection-first para stack e transferencias:

- `getInventoryStackKey` ignora ids transitorios e considera identidade real do item.
- `canStackInventoryItem` separa stackavel de nao stackavel.
- `addItemsToInventory`, `removeItemsFromInventory` e `compactInventoryBag` aplicam a mesma regra para recompensa, envio, doacao, troca e consumo.
- `send_item`, `donate_item` e `trade_item` removem/adicionam em uma transacao da engine; se uma ponta falha, ninguem perde item.
- `grant_reward` com item usa a mesma regra de stack.
- `inventory_patch` legado, SQLite, reload, ACK/NACK e `public_status` nao sao fonte final de gameplay quando existe projection.

## 21. Public status

`public_status` é somente visual/histórico. Ele não altera projection, ficha, HP, XP, moedas, efeitos, inventário, equipamento, turno, pending save, trade ou resync autoritativo.

## 22. Reload/recovery

`reloadSessionState` fica restrito a bootstrap/cache/visual. Quando existe projection, reload não corrige gameplay vivo. Locks como `holdLiveRuntimeLock` foram rebaixados para compatibilidade/no-op quando a projection já protege contra rollback.

## 23. SQLite

No modo LAN, SQLite é cache/persistência em background. Ele não vence projection, não restaura item/efeito removido, não volta HP/XP/moedas antigos, não desfaz equipamento, não reabre sessão encerrada e não bloqueia ACK/clique.

No single player, SQLite continua sendo fonte primária.

## 24. Stores e hooks

Stores e hooks podem guardar projection, status visual, logs, pending visual e status de conexão. Eles não devem aplicar gameplay manual fora da engine. Hooks de eventos encaminham para bridge/engine e pedem resync quando necessário.

Ainda existem funções legadas marcadas como deprecated/no-op para compatibilidade com telas antigas.

## 25. Transporte TCP

`lanTcpTransport.ts` transporta eventos, comandos/propostas, snapshots, ACK/NACK e resync. Ele encaminha eventos commitados para a engine, mas não decide regra de gameplay. Eventos transacionais novos (`character_transaction`, `party_transaction`, `spell_transaction`, `reward_transaction`) foram incluídos como críticos para replay.

## 26. Testes automatizados

Executado:

```bash
npm run test:lan
```

Resultado: passou. Saída: `LAN engine/domain tests passed`.

Executado:

```bash
npx tsc --noEmit
```

Resultado: passou sem erros.

A suíte cobre:

1. dano rápido do mestre;
2. cura rápida do mestre;
3. PV temporário e expiração;
4. efeito de atributo e expiração;
5. condição Paralisado por 3 turnos;
6. Poção de Cura `Cura 2d4+2`;
7. segunda poção removendo item;
8. replay não cura de novo;
9. ACK/NACK não altera projection;
10. public_status não altera projection;
11. snapshot antigo não restaura efeito;
12. snapshot antigo não remove equipamento;
13. snapshot antigo não reverte HP;
14. snapshot antigo não reverte XP/moedas;
15. reconnect/resync duplicado não reaplica evento;
16. equipar armadura recalcula CA;
17. desequipar armadura recalcula CA;
18. envio/doação de item não duplica item;
19. troca de item é transacional;
20. pedido de save não duplica alerta;
21. resolução de save remove alerta;
22. magia com efeito passa pela engine;
23. magia com cura/dano passa pela engine.

## 27. Testes manuais

NÃO TESTADO EM APARELHOS REAIS

## 28. Pendências reais

- Remover fisicamente a UI/fila legada de trade offer/counter, resource request, coin self request e alguns fluxos de magia quando as telas forem redesenhadas para command-first.
- Mapear todos os campos reais do banco de magias para `use_spell`.
- Fazer teste manual com mestre + 2 ou mais jogadores em aparelhos reais.
- Conferir UX final de alertas pendentes lendo apenas `projection.pendingSaves`.
- Conferir UX final de timeline/histórico lendo apenas `projection.trades`/event log, sem virar fonte de gameplay.
