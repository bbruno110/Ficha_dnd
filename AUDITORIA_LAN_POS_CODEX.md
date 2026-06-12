# Auditoria LAN pos Codex

Data: 2026-06-11

## Escopo

Esta auditoria foi feita antes de uma nova refatoracao. O objetivo foi verificar se a refatoracao anterior realmente substituiu o fluxo LAN antigo ou apenas adicionou modulos paralelos.

Fontes lidas:
- `REFATORACAO_LAN_FLUXO_FINAL.md`
- `src/app/sheet.tsx`
- `src/app/lan-session.tsx`
- `src/services/lanSession.ts`
- `src/services/lanTcpTransport.ts`
- `src/stores/lanRealtimeStore.ts`
- `src/stores/lanSessionRuntimeStore.ts`
- `src/hooks/useLanRealtimePlayerPatches.ts`
- `src/services/lan/lanActiveRuntimeSync.tsx`
- `src/services/lan/lanInventoryDomain.ts`
- `src/services/lan/lanEffectDomain.ts`
- `src/services/lan/lanProjectionEngine.ts`
- `scripts/lan-domain-tests.ts`
- Logs anexados: `1_4995027904183142381.txt` e `app-trace-todos-os-logs-20260611-091358.txt`

## Resumo executivo

A refatoracao anterior criou bons blocos puros de dominio, mas nao substituiu o fluxo principal do app. O jogo ainda e decidido por uma combinacao de tela, store runtime, transporte TCP, persistencia SQLite, snapshots, `public_status`, patches e locks temporarios. Isso deixa o comportamento fragil: um efeito removido pode voltar por snapshot/store antigo, revisoes de dominios diferentes podem se misturar, e `reloadSessionState` continua competindo com o runtime em tempo real.

Conclusao: nao existe ainda um motor LAN unico. O app tem varios motores pequenos disputando a verdade.

## 1. O que a refatoracao anterior criou

Foram criados/restaurados estes modulos:

- `src/services/lan/lanInventoryDomain.ts`: regras puras para normalizar inventario, consumir item atomicamente, equipar item atomicamente e derivar bonus de equipamento.
- `src/services/lan/lanEffectDomain.ts`: regras puras para normalizar efeitos, aplicar stack, remover efeitos, avancar duracao e calcular stats efetivos.
- `src/services/lan/lanProjectionEngine.ts`: projecao pura para aplicar eventos e snapshots em uma visao de sessao.
- `scripts/lan-domain-tests.ts`: testes de dominio/projecao.
- `package.json`: script `test:lan`.

Esses modulos melhoram a testabilidade, mas nao comandam a mesa LAN.

## 2. O que ficou pendente

O proprio documento `REFATORACAO_LAN_FLUXO_FINAL.md` indica que a integracao real da projecao ficou pendente. A tela do mestre e a ficha do jogador continuam chamando funcoes antigas diretamente.

Pendencias reais:

- Transformar evento LAN em comando unico de jogo.
- Aplicar comando por um unico reducer/engine.
- Separar revisoes por dominio sem fallback cruzado.
- Definir snapshot apenas como bootstrap/recuperacao, nunca como overwrite cego de runtime vivo.
- Remover `public_status` do caminho autoritativo.
- Fazer consumo/equipamento/efeito/passagem de tempo passarem pelo mesmo motor.
- Trocar testes de dominio isolados por testes de fluxo host + player + snapshot atrasado + replay.

## 3. Modulos novos sem uso real suficiente

`src/services/lan/lanProjectionEngine.ts` e o principal exemplo. Ele existe, tem testes, mas nao aparece como fonte central de estado da tela LAN. A tela continua usando `reloadSessionState`, stores runtime, handlers locais e transporte.

O modulo tambem tem um problema de modelo: `cleanRevision` transforma revisoes muito altas em `0`. Isso mascara `Date.now()` como revision, mas pode permitir reprocessamento, porque uma revisao invalida deixa de bloquear evento velho.

## 4. Modulos usados so parcialmente ou so por testes

- `lanProjectionEngine.ts`: usado pelos testes, mas nao dirige o fluxo principal.
- `lanEffectDomain.ts`: usado em testes; a tela LAN ainda aplica efeito em `lan-session.tsx` por `applyHostEffectPatchRuntime` e persistencias locais.
- `lanInventoryDomain.ts`: tem uso real em `sheet.tsx`, mas apenas em parte do caminho. O arquivo ainda contem o fluxo legado desativado por `if (false)` no handler de equipamento.

Evidencia:

- `src/app/sheet.tsx:27` importa `consumeItemAtomically`.
- `src/app/sheet.tsx:28` importa `equipItemAtomically`.
- `src/app/sheet.tsx:8130` inicia `handleEquipItem`.
- `src/app/sheet.tsx:8173` contem `if (false)` envolvendo fluxo legado.
- `src/app/sheet.tsx:7719` ainda tem `processConsumeItem`.
- `src/app/sheet.tsx:7453` ainda tem `applyStructuredItemEffects`.

## 5. Onde o fluxo velho ainda domina

O fluxo velho domina principalmente em:

- `src/app/lan-session.tsx`: aplica runtime, persiste em SQLite, envia evento, manda `public_status`, recarrega sessao.
- `src/app/sheet.tsx`: interpreta item/magia/efeito, decide consumo, calcula stats, envia patches.
- `src/services/lanTcpTransport.ts`: cria snapshots, payload updates, ACKs e checkpoints.
- `src/stores/lanSessionRuntimeStore.ts`: mantem estado runtime com tombstones e revisoes.
- `src/stores/lanRealtimeStore.ts`: guarda eventos/patches/checkpoints recebidos.
- `src/hooks/useLanRealtimePlayerPatches.ts`: aplica eventos no jogador em paralelo ao store.

Isso significa que o dominio novo nao e o dono da regra. Ele e um auxiliar.

## 6. Duplicidade entre tela, store, service e dominio

Duplicidades encontradas:

- Equipamento: `lanInventoryDomain.ts` tem regra atomica, mas `sheet.tsx` ainda calcula bonus em `getSheetEquipBonusFromItem` e `buildSheetStatsWithDerivedEquipMods` (`src/app/sheet.tsx:684`, `src/app/sheet.tsx:739`).
- Consumo: `consumeItemAtomically` existe, mas `sheet.tsx` ainda tem `processConsumeItem`, `applyStructuredItemEffects`, `notifyInventoryPatch`, `notifyNumberPatch` e `notifyEffectPatch` (`src/app/sheet.tsx:5970`, `src/app/sheet.tsx:6042`, `src/app/sheet.tsx:6224`, `src/app/sheet.tsx:7453`, `src/app/sheet.tsx:7719`).
- Efeitos: `lanEffectDomain.ts` existe, mas `lan-session.tsx` usa `applyHostEffectPatchRuntime` em varios pontos (`src/app/lan-session.tsx:1443`, `src/app/lan-session.tsx:1882`, `src/app/lan-session.tsx:4231`, `src/app/lan-session.tsx:6105`, `src/app/lan-session.tsx:6282`, `src/app/lan-session.tsx:6418`).
- Revisoes: `lanRealtimeStore.ts`, `lanSessionRuntimeStore.ts`, `lanActiveRuntimeSync.tsx`, `useLanRealtimePlayerPatches.ts` e `lanTcpTransport.ts` possuem filtros proprios.

## 7. Onde snapshots podem sobrescrever runtime

`lanTcpTransport.ts` ainda envia `session_snapshot` e `payload_update`:

- `src/services/lanTcpTransport.ts:40` define `session_snapshot`.
- `src/services/lanTcpTransport.ts:47` define `payload_update`.
- `src/services/lanTcpTransport.ts:322` envia snapshot ao cliente.
- `src/services/lanTcpTransport.ts:434` envia snapshot.
- `src/services/lanTcpTransport.ts:451` envia payload update.
- `src/services/lanTcpTransport.ts:1276` e `src/services/lanTcpTransport.ts:1421` processam snapshot/payload update.

Nos logs do jogador, snapshots chegam repetidamente durante a mesa:

- `1_4995027904183142381.txt:64`: `SESSION_SNAPSHOT_RECEIVED`.
- `1_4995027904183142381.txt:357`: snapshot depois de patches de efeito.
- `1_4995027904183142381.txt:737`: snapshot apos atualizacao/remocao de efeitos.

Isso e perigoso enquanto o snapshot carregar estado antigo ou revisao contaminada. Snapshot deveria inicializar ou reconciliar por motor, nao sobrescrever runtime ativo.

## 8. Onde `public_status` influencia estado vivo

`public_status` deveria ser visual/roster, mas ainda passa por caminhos de evento e store:

- `src/app/lan-session.tsx:1039` define `sendPublicPlayerStatus`.
- `src/app/lan-session.tsx:1073` cria evento `public_status`.
- `src/app/lan-session.tsx:1368` inclui `public_status` como evento que segura live lock.
- `src/app/lan-session.tsx:4019` processa `public_status`.
- `src/services/lanTcpTransport.ts:113` reconhece `public_status`.
- `src/services/lanTcpTransport.ts:1665` prioriza `public_status`.
- `src/services/lanTcpTransport.ts:2189` permite `public_status` em replay.
- `src/stores/lanSessionRuntimeStore.ts:11` inclui `public_status` como `RuntimeSource`.
- `src/stores/lanRealtimeStore.ts:163` trata `public_status` junto de player/effect/inventory para limpeza de revisao.

Mesmo quando ha comentarios dizendo que ele nao deve contaminar revisao, o tipo ainda atravessa a infraestrutura de estado vivo.

## 9. Onde `reloadSessionState` compete com runtime

`reloadSessionState` continua ativo e chamado em varios pontos:

- `src/app/lan-session.tsx:448` a `451`: refs de controle de reload e lock.
- `src/app/lan-session.tsx:847`: `holdLiveRuntimeLock`.
- `src/app/lan-session.tsx:2679`: definicao de `reloadSessionState`.
- `src/app/lan-session.tsx:4290`, `7040`, `7050`, `7163`: chamadas explicitas.

Logs do mestre mostram a competicao:

- `app-trace-todos-os-logs-20260611-091358.txt:7119`: `FUNCTION_CALL / reloadSessionState`.
- `app-trace-todos-os-logs-20260611-091358.txt:7136`: reload ignorado por cooldown.
- `app-trace-todos-os-logs-20260611-091358.txt:7181`, `7238`, `7295`: reload chamado novamente.
- Muitos eventos `MASTER_RELOAD_SESSION_STATE_SKIPPED_LIVE_RUNTIME_LOCK_V90` aparecem entre os patches.

Se precisa de tantos locks para impedir overwrite, a fonte de verdade ainda esta dividida.

## 10. Onde consumo ainda nao e completamente atomico

O dominio tem `consumeItemAtomically`, mas a ficha ainda separa:

- reduzir inventario;
- aplicar cura/dano/temp HP;
- aplicar efeitos;
- enviar patch de numero;
- enviar patch de efeito;
- enviar patch de inventario.

Evidencia:

- `src/app/sheet.tsx:7453`: `applyStructuredItemEffects`.
- `src/app/sheet.tsx:7665`: envia `notifyInventoryPatch`.
- `src/app/sheet.tsx:7673`: envia `notifyNumberPatch`.
- `src/app/sheet.tsx:7677`: envia `notifyEffectPatch`.
- `src/app/sheet.tsx:7719`: `processConsumeItem`.

Risco: item consumido e efeito aplicado podem divergir se um patch chega/reaplica e outro nao.

## 11. Onde equipamento ainda fica intermediario

`handleEquipItem` usa o dominio novo, mas o arquivo ainda tem calculo local de bonus e o bloco legado permanece no mesmo handler:

- `src/app/sheet.tsx:684`: `getSheetEquipBonusFromItem`.
- `src/app/sheet.tsx:739`: `buildSheetStatsWithDerivedEquipMods`.
- `src/app/sheet.tsx:8130`: `handleEquipItem`.
- `src/app/sheet.tsx:8173`: `if (false)` com fluxo legado.
- `src/app/sheet.tsx:8240`: recalculo de stats no caminho legado.

Isso e um sinal claro de migracao incompleta.

## 12. Onde efeito removido pode voltar

Existem tombstones em runtime, mas eles estao espalhados:

- `src/stores/lanSessionRuntimeStore.ts:62`: tombstone de efeito removido.
- `src/services/lan/lanActiveRuntimeSync.tsx:89`: tombstone de efeito removido live.

Ao mesmo tempo, snapshots e payload updates continuam entrando pelo transporte, e `lanProjectionEngine.ts` possui `applySnapshotToProjection`. Se uma remocao vive so em runtime/tombstone local e chega um snapshot antigo com efeito ainda presente, o risco de retorno existe.

Nos logs:

- `1_4995027904183142381.txt:319`: aplica `PV Temporario` com `entityRevision: 1`.
- `1_4995027904183142381.txt:346`: remove/expira efeito com `entityRevision: 11`.
- `1_4995027904183142381.txt:357`: logo depois chega snapshot.
- `1_4995027904183142381.txt:726`, `760`, `787`: patches de efeito de passagem de tempo aparecem com `entityRevision: 36`, misturando dominio de revisao.

## 13. Onde revisoes se misturam

Ha revisoes separadas em alguns tipos, mas o transporte e os stores ainda lidam com `entityRevision` generico.

Evidencia no codigo:

- `src/services/lanSession.ts:335`: `entityRevision` generico em evento.
- `src/services/lanSession.ts:3248`: ainda cria `entityRevision: Date.now()`.
- `src/services/lanTcpTransport.ts:1439` e `1451`: cria `seq = Date.now()` e usa como `entityRevision`.
- `src/services/lanTcpTransport.ts:2035` e `2045`: novo `Date.now()` usado como revision.
- `src/services/lanTcpTransport.ts:2116`: escolhe `entityRevision` generico.
- `src/stores/lanRealtimeStore.ts:135` a `163`: tenta detectar `Date.now()` contaminando revisao.
- `src/hooks/useLanRealtimePlayerPatches.ts:31`: comentario reconhece que seq TCP geralmente e `Date.now()`.
- `src/services/lan/lanProjectionEngine.ts:113` a `115`: usa `player.revisionSeq` para player, effect e inventory no snapshot inicial.

Evidencia nos logs:

- `1_4995027904183142381.txt:179` a `313`: `player_patch` com revisoes 1 a 10.
- `1_4995027904183142381.txt:319`: `effect_patch` com revisao 1.
- `1_4995027904183142381.txt:346`: remocao de efeito com revisao 11.
- `1_4995027904183142381.txt:726`, `760`, `787`: `effect_patch` com `entityRevision: 36`, igual dominio de player.
- `app-trace-todos-os-logs-20260611-091358.txt:6756`: ACK com `entityRevision: 1781179974156`.
- `app-trace-todos-os-logs-20260611-091358.txt:6825`: ACK com `entityRevision: 1781179979051`.

Conclusao: `entityRevision` ainda mistura relogio, sequencia TCP, revisao de player, revisao de efeito, revisao de inventario e revisao de sessao.

## 14. Onde os testes sao insuficientes

`npm run test:lan` passa, mas testa dominio isolado. Ele nao prova:

- host aplicando evento e player recebendo;
- snapshot atrasado chegando depois de evento novo;
- remocao de efeito seguida de payload antigo;
- consumo de item com inventario + efeito + HP em uma transacao de jogo;
- equipamento mudando stats sem fluxo legado;
- ACK/NACK sem contaminar revisao;
- passagem de tempo removendo/atualizando efeito e sincronizando ambos os lados;
- reconexao com checkpoint sem reanimar estado antigo.

`npx tsc --noEmit` tambem passa, mas isso so valida tipagem, nao a consistencia temporal do LAN.

## Diagnostico final

A refatoracao anterior nao deve ser considerada concluida. Ela criou pecas corretas, mas o sistema ainda nao tem um `LanGameEngine` como fonte de verdade.

Para corrigir sem repetir o erro, a proxima etapa deve ser uma migracao real:

1. Criar `src/services/lan/engine/LanGameEngine.ts` como unico ponto de aplicacao de comandos/eventos.
2. Mover regras de inventario, equipamento, efeitos, HP, recursos e passagem de tempo para arquivos do engine.
3. Fazer tela do mestre e ficha chamarem comandos do engine, nao recalcularem regra local.
4. Tornar `public_status` apenas uma projecao visual derivada.
5. Tornar snapshot apenas bootstrap/reconcile pelo engine.
6. Separar revision domains: `playerRevision`, `effectRevision`, `inventoryRevision`, `sessionRevision`, sem fallback cruzado.
7. Remover ou transformar os modulos anteriores para nao ficarem como arquitetura paralela.
8. Substituir testes atuais por cenarios de fluxo real e manter testes puros como base.

Esta auditoria para aqui de proposito: seguir criando mais modulos sem trocar o fluxo dominante repetiria o mesmo problema.
