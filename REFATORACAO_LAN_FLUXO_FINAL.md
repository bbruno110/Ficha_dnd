# Refatoracao LAN - Fluxo Final

## 1. Problemas encontrados

- Eventos de dominios diferentes ainda podiam compartilhar o mesmo `revisionSeq` visual do jogador.
- Consumo textual de item removia quantidade antes de concluir cura/efeito, quebrando atomicidade.
- Equipamento ainda mantinha um fluxo incremental legado antes de recalcular o estado final.
- Snapshot/cache podia competir com campos vivos quando o runtime nao carregava metadados por dominio.
- O parser de dados nao resolvia modificadores de atributo como `1d6+CON`.

## 2. Causas principais

- Regras de inventario, equipamento, efeito e sincronismo estavam espalhadas nas telas.
- SQLite/snapshot ainda apareciam como mecanismos de recuperacao defensiva perto de fluxo vivo.
- A revisao de jogador era usada como atalho para efeito/inventario em partes do runtime.
- Consumo de item era dividido em passos independentes.

## 3. Arquitetura anterior

- `sheet.tsx` calculava consumo, efeitos, inventario, equipamento e envio LAN.
- `lan-session.tsx` aplicava runtime e persistencia com muita regra no proprio componente.
- `lanSessionRuntimeStore.ts` preservava campos vivos, mas sem chaves explicitas para efeito/inventario.
- `diceFormulaService.ts` extraia dados simples, mas nao tinha contexto de atributo.

## 4. Nova arquitetura

- `lanInventoryDomain.ts`: normaliza inventario, consome item, equipa/desequipa e recalcula `equip_mods`.
- `lanEffectDomain.ts`: normaliza efeito ativo, aplica stack policy e expira por turno/tempo.
- `lanProjectionEngine.ts`: projection pura com evento idempotente, snapshot seguro e revisoes por dominio.
- `diceFormulaService.ts`: parser de formula com `2d4+2`, texto como `Cura 2d4+2` e atributo como `1d6+CON`.
- `sheet.tsx`: passou a usar comando atomico para consumo/equipamento.

## 5. Fonte de verdade

No LAN, a regra aplicada e documentada ficou:

1. evento vivo mais recente;
2. runtime/projection;
3. snapshot/resync;
4. SQLite.

SQLite continua como persistencia/cache. Ele nao deve vencer runtime vivo.

## 6. Event Log e Projection

Foi criada uma projection pura com:

- `playerRevision`;
- `effectRevision`;
- `inventoryRevision`;
- `sessionRevision`;
- `pendingSaveRevision`;
- `tradeRevision`;
- `appliedEventIds`.

Evento duplicado por `eventId` nao reaplica. Snapshot antigo sem revisao nao sobrescreve entidade que ja recebeu evento vivo.

## 7. Fluxo Single Player

Single player continua SQLite-first. O consumo/equipamento agora usa o mesmo dominio puro, mas persiste localmente pela tela.

## 8. Fluxo Multiplayer

No LAN, consumo/equipamento atualizam o estado local primeiro, enviam patch ao Mestre e deixam SQLite em background.

## 9. Consumo de Itens

`consumeItemAtomically` valida item, quantidade, reduz stack e remove item zerado em uma unica transacao de estado.

## 10. Pocao de Cura 2d4+2

O parser reconhece `Cura 2d4+2` como formula `2d4+2`, rola dois d4 e soma modificador fixo `+2`. O teste garante que nao vira `2+2+2` fixo.

## 11. Equipamentos, CA e Modificadores

`equipItemAtomically` calcula bag, slots e stats finais juntos. `equip_mods` e derivado dos slots finais, evitando bonus duplicado.

## 12. Efeitos Temporarios

`lanEffectDomain.ts` normaliza efeitos ativos, status e politica de stack. Efeitos temporarios carregam `remaining` e `unit`.

## 13. Passagem de Turno

`advanceEffectsByUnit` reduz duracao e separa efeitos expirados. O runtime do Mestre tambem passou a guardar metadados de efeito separados de jogador.

## 14. Snapshot, Resync e Reconnect

Projection ignora snapshot antigo quando ja existe revisao viva. O runtime tambem preserva campos vivos considerando metadados de player, efeito e inventario.

## 15. Telas e Stores

- `sheet.tsx` foi reduzido nos fluxos de consumo/equipamento, que agora chamam dominios.
- `lanSessionRuntimeStore.ts` separou metadados de player/effect/inventory.
- A projection pura ainda nao substitui toda renderizacao de `lan-session.tsx`; ela foi introduzida como camada testavel para migracao incremental.

## 16. Testes Criados

Script: `npm run test:lan`.

Coberturas:

- parser `2d4+2`;
- parser `Cura 2d4+2`;
- parser `1d6+CON`;
- idempotencia por `eventId`;
- snapshot antigo ignorado;
- `effectRevision` nao bloqueia `playerRevision`;
- consumir item quantidade 2 virar 1;
- consumir item quantidade 1 remover item;
- consumo/rolagem nao reexecutar por evento duplicado;
- efeito temporario expirar por turno;
- equipamento nao duplicar bonus;
- equipamento nao produzir slot final vazio.

## 17. Cenarios Manuais

Nao foram validados em aparelhos reais nesta execucao:

- Mestre e jogador em dois dispositivos.
- Reconnect apos bloquear tela.
- Encerramento de sessao com limpeza visual imediata.
- Card LAN em rede real apos snapshot antigo.
- Fluxo completo de dano/cura do Mestre apos consumo em TCP real.

## 18. Checklist de Aceite

- Parser e dominios puros: validado automaticamente.
- TypeScript: validado.
- Consumo/equipamento local: migrado para dominio atomico.
- Projection unica em todas as telas: pendente de migracao completa.
- Teste manual LAN real: pendente.

## 19. Pendencias

- Migrar `lan-session.tsx` inteiro para consumir `SessionProjection` em vez de manter regras no componente.
- Migrar hooks de jogador para projection unica.
- Remover bloco legado de equipamento em `sheet.tsx` depois de validar comportamento visual no app.
- Adicionar runner de testes formal ao projeto, caso a suite cresca alem dos testes de dominio.
