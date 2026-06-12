# Migracao LAN Engine Checklist

Data de inicio: 2026-06-11
Ultima atualizacao: 2026-06-12

## Baseline

- [x] Ler `AUDITORIA_LAN_POS_CODEX.md`.
- [x] Ler `REFATORACAO_LAN_FLUXO_FINAL.md`.
- [x] Ler engine/projection em `src/services/lan/engine/*`.
- [x] Rodar `npm ci` porque o ZIP veio sem `node_modules`.
- [x] Rodar `npm run test:lan`.
  - Resultado final: passou. Saida: `LAN engine/domain tests passed`.
- [x] Rodar `npx tsc --noEmit`.
  - Resultado final: passou sem erros.

## Etapas

- [x] Fase 3 / Corte 1. Bridge + stores lendo projection.
  - `LanEngineBridge` registra sinks e publica projection para stores/telas.
  - Stores mantem projection por sessao.

- [x] Fase 3 / Corte 2. Transporte encaminhando eventos/snapshots para engine.
  - `lanTcpTransport.ts` encaminha eventos commitados para `applyIncomingLegacyLanEvent`.
  - Snapshot/payload entram por `applyIncomingSnapshot`/`LanSnapshotAdapter`.
  - `public_status` nao entra como gameplay.

- [x] Fase 3 / Corte 3. Comandos principais do mestre.
  - Dano, cura, PV temporario, aplicar/remover efeito, passagem de turno, pausar, retomar e encerrar passam pela engine/projection.

- [x] Fase 3 / Corte 4. Consumo/equipamento do jogador.
  - `consume_item`, `equip_item` e `unequip_item` usam eventos transacionais da engine.
  - Poção de Cura `Cura 2d4+2` e replay idempotente cobertos por teste.

- [x] Fase 3 / Corte 5. Hooks/reconnect/ficha priorizando projection.
  - `useLanProjection` le `getLanProjection`/`subscribeLanProjection`.
  - Reconnect/foreground pedem resync sem reconstruir ficha viva por SQLite.
  - Hooks de eventos rebaixados para bridge/engine no modo projection.

- [~] Fase 3 / Corte 6. Limpeza final e neutralizacao de legados.
  - `public_status` permanece visual/historico.
  - `reloadSessionState` fica bootstrap/cache/visual quando ha projection.
  - Stores/runtime legados foram marcados/rebaixados para no-op quando ha projection.
  - Ainda existem trechos legados fisicos em `sheet.tsx` e `lan-session.tsx` para compatibilidade de UI, fila e historico.

- [x] Completar comandos pendentes na engine.
  - Adicionados/consolidados: `grant_xp`, `set_xp`, `add_coins`, `set_coins`, `request_reward`, `grant_reward`, `send_item`, `trade_item`, `donate_item`, `use_spell`, `apply_pending_save`, `resolve_pending_save`, `apply_self_effect`.
  - Todos geram evento autoritativo, passam pelo reducer e sao idempotentes por `commandId`/`eventId`.

- [x] Migrar XP e moedas no dominio da engine.
  - XP/moedas agora possuem comandos explicitos e testes contra snapshot antigo.
  - ACK/NACK/public_status nao alteram projection.
  - Observacao: algumas telas ainda podem ter wrappers legados de solicitacao visual; a engine ja cobre o estado vivo.

- [~] Migrar magias.
  - Engine possui `use_spell` com cura, dano, efeito e save pendente.
  - Testes cobrem cura, dano, efeito e save.
  - Pendente real: mapear todos os modelos de magia do banco/UI para o comando `use_spell`; regras incompletas do catalogo continuam documentadas.

- [x] Migrar saves/testes de resistencia no dominio.
  - Engine possui `apply_pending_save` e `resolve_pending_save`.
  - Projection guarda `pendingSaves` e impede duplicidade por idempotencia.
  - Resolucao remove/atualiza alerta e pode remover efeito vinculado.

- [~] Migrar envio, doacao e troca de itens.
  - Engine possui transacao multi-alvo para `send_item`, `donate_item` e `trade_item`.
  - Testes cobrem envio/doacao sem duplicar item e troca transacional.
  - `sheet.tsx` foi ajustado para enviar item direto pela engine quando possivel.
  - Pendente real: remover completamente telas legadas de proposta/contra-proposta quando a UI for redesenhada para transaction-first.

- [~] Limpar stores antigos.
  - Stores podem guardar projection/status/log/visual.
  - Funcoes antigas estao rebaixadas/deprecated/no-op em modo projection.
  - Pendente real: remocao fisica completa so deve ocorrer depois que UI antiga de troca/magia/recompensa for apagada.

- [~] Limpar hooks.
  - Hooks principais ja leem projection e encaminham eventos.
  - Pendente real: alguns callbacks legados continuam para compatibilidade visual e historico.

- [~] Limpar `sheet.tsx`.
  - Leitura central prioriza projection.
  - Consumo/equipamento/envio direto passam por comandos da engine.
  - Pendente real: telas legadas de moedas, magia, trade offer/counter e resource request ainda existem como compatibilidade.

- [~] Limpar `lan-session.tsx`.
  - Comandos principais do mestre passam pela engine.
  - Host recebe eventos novos pelo transporte/bridge.
  - Pendente real: handlers legados de fila e historico ainda existem.

- [x] Transporte.
  - Transporte continua entregando envelopes, ACK/NACK, snapshots e resync.
  - Eventos transacionais novos sao tratados como criticos para replay.
  - `public_status` continua fora da engine.

- [x] Snapshot/reconnect.
  - Snapshot antigo nao vence projection com eventos aplicados.
  - Tombstones impedem efeito/item removido de voltar.
  - Sessao encerrada nao volta para ativa por snapshot antigo.

- [x] Testes automatizados ampliados.
  - `scripts/lan-domain-tests.ts` cobre dano/cura rapidos, PV temporario, efeito/condicao, Pocao de Cura, replay, ACK/NACK, public_status, snapshot antigo, equipamento, XP/moedas, resync duplicado, envio/doacao/troca, saves e magias.

- [ ] Testes manuais em aparelhos reais.
  - NÃO TESTADO EM APARELHOS REAIS.

## Arquivos alterados nesta conclusao

- `src/services/lan/engine/LanTypes.ts`
- `src/services/lan/engine/LanCommandHandler.ts`
- `src/services/lan/engine/LanReducer.ts`
- `src/services/lan/engine/LanGameEngine.ts`
- `src/services/lan/engine/LanLegacyAdapter.ts`
- `src/app/sheet.tsx`
- `src/services/lanSession.ts`
- `src/services/lanTcpTransport.ts`
- `scripts/lan-domain-tests.ts`
- `MIGRACAO_LAN_ENGINE_CHECKLIST.md`
- `REFATORACAO_LAN_FLUXO_FINAL.md`

## Testes executados nesta conclusao

- `npm ci` - executado porque o ZIP nao incluia `node_modules`.
- `npm run test:lan` - passou.
- `npx tsc --noEmit` - passou.


## Correção pós-logs reais de aparelhos - 2026-06-11

- [x] Corrigir ajuste permanente de atributo.
  - `Ajuste permanente de INT` e equivalentes agora sao identificados por `isPermanentStatAdjustment`.
  - O reducer aplica o ajuste em `baseStats`/`effectiveStats` e nao cria `activeEffect` visual.
  - `getVisibleEffects`/borda visual ignoram ajustes permanentes.
  - Revalidado em 2026-06-12: payload legado com `kind: "buff"`/`custom` + `target` de atributo + `unit: "permanent"` tambem e ajuste permanente e nao entra em `activeEffects`.

- [x] Corrigir efeitos visuais temporarios/condicoes.
  - `LanEffectRules` preserva `color`, `secondaryColor`, `visualPriority`, `visibleToPlayer`, `mode` e `isPermanent`.
  - `isVisibleTemporaryEffect` e `isConditionVisualEffect` separam condicao temporaria de ajuste permanente.
  - A ficha recebe cores da projection para breath/fade sem usar `public_status`.
  - Revalidado em 2026-06-12: ajuste temporario de INT entra em `activeEffects`, expira por turno e preserva o valor permanente; `Paralisado` continua visual com cor.

- [x] Corrigir stack de itens.
  - `getInventoryStackKey` ignora IDs transitorios (`id`, `inventoryItemId`, `clientMsgId`, timestamps) e usa identidade real do item.
  - `addItemToBag`/transacoes passam a somar stacks iguais, incluindo `10 Dardos`.
  - Testes cobrem 5 concessoes de `10 Dardos`, envio e troca mantendo stack unico.
  - Revalidado em 2026-06-12 / Bug 3: `canStackInventoryItem`, `addItemsToInventory`, `removeItemsFromInventory` e `compactInventoryBag` ficaram centralizados em `LanInventoryRules`.
  - Itens stackaveis somam mesmo com IDs transitorios diferentes; itens com efeito diferente ou equipamento/magico nao stackavel ficam separados.
  - `send_item`, `donate_item`, `trade_item` e `grant_reward` usam transacoes da engine/projection; `inventory_patch` legado fica compatibilidade/cache e nao e fonte final quando ha projection.
  - Snapshot antigo, ACK/NACK, `public_status` e `reloadSessionState` nao vencem inventario da projection.

- [x] Corrigir XP/moedas aceitos pelo mestre.
  - `grant_xp`, `set_xp`, `add_coins` e `set_coins` agora geram `character_transaction`, nao `player_patch` manual.
  - `handleReviewResourceRequest` aceita pedidos de XP/moeda via `grant_reward`; pedido antigo de moeda com valor final usa `set_coins`.
  - `coin_self_patch_request` nao altera a ficha: o host converte em `resource_request` revisavel e so o aceite do mestre aplica a projection.
  - `request_reward` registra pedido pendente e `grant_reward` fecha o pedido com status `committed`.
  - O fluxo antigo fica somente como fallback visual/compatibilidade quando nao houver projection.

- [x] Corrigir envio de eventos transacionais para jogadores.
  - `authoritativeEventToLanSessionEvent` agora serializa `character_transaction`, `party_transaction`, `spell_transaction` e `reward_transaction`.
  - `lanClientEngine` trata esses eventos como vivos/criticos.

- [x] Corrigir save/teste de resistencia legado.
  - `LanLegacyAdapter` converte `effect_save_request` para `pending_save_patch`.
  - Pedidos/resolucoes de save permanecem idempotentes na projection.

- [~] Reconnect/sair e voltar.
  - Projection, snapshot policy e replay idempotente seguem impedindo rollback por snapshot/reload.
  - Pendente real: validar em aparelhos reais o fluxo background/foreground depois destas correcoes.

- [~] Encerrar sessao/desvinculo.
  - `end_session` continua na engine com tombstone contra snapshot antigo.
  - Pendente real: validar em aparelhos reais se a navegacao/desvinculo visual do jogador sai da sessao sem binding antigo.

## Testes executados apos logs reais

- 2026-06-12 / Bug 1 permanente vs visual: `npm run test:lan` - passou.
- 2026-06-12 / Bug 1 permanente vs visual: `npx tsc --noEmit` - passou.
- 2026-06-12 / Bug 2 XP/moedas/pedidos numericos: `npm run test:lan` - passou.
- 2026-06-12 / Bug 2 XP/moedas/pedidos numericos: `npx tsc --noEmit` - passou.
- 2026-06-12 / Bug 3 stack/envio/doacao/troca: `npm run test:lan` - passou.
- 2026-06-12 / Bug 3 stack/envio/doacao/troca: `npx tsc --noEmit` - passou.
- `npm ci` - executado porque o ZIP nao incluia `node_modules`.
- `npm run test:lan` - passou.
- `npx tsc --noEmit` - passou.
- Testes manuais: NÃO TESTADO EM APARELHOS REAIS.

## Pendencias reais

- Remover fisicamente trechos legados de UI/fila depois de redesenhar moedas, magias, propostas/contra-propostas e recompensas para command-first.
- Mapear integralmente todos os campos de magia do banco para `use_spell`.
- Validar em aparelhos reais com mestre + multiplos jogadores.
- Revisar UX final dos alertas de save/trade/reward para ler somente `projection.pendingSaves` e `projection.trades`.
