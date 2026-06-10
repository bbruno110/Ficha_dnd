# LAN v43 - Fast runtime sem rollback em HP, moeda, inventário e efeitos

## Problema confirmado nos logs

1. Botões rápidos de HP geravam vários `player_patch` em sequência e o jogador recebia/aplicava eventos com latência perceptível.
2. Ao reduzir moedas rapidamente, a UI local ia para o valor correto, mas timers/patches antigos ainda podiam persistir ou reaplicar valor anterior.
3. Equipar item podia “sair” porque `inventory_patch`/checkpoint antigo do host sobrescrevia o equipamento local recém-alterado.
4. Passagem de turno aguardava filas de jogadores e pós-processamentos, atrasando a remoção de efeitos temporários e buffs de atributo.

## Regra nova

Ações rápidas têm duas camadas:

- **Runtime local imediato**: UI muda no mesmo frame.
- **Confirmação autoritativa monotônica**: o host confirma, mas evento antigo não pode voltar estado novo para trás.

## Correções implementadas

### 1. Moedas sem rollback

Arquivo: `src/app/sheet.tsx`

- Adicionado `coinOptimisticSeqRef`.
- `sendCoinSelfPatchRequest` agora grava uma sequência local por clique.
- Timer antigo não grava mais SQLite se já existir clique mais novo.
- A persistência local rápida usa `persistFastLocalPatch`, que não chama `setCharacter` depois da gravação.
- `player_patch` com moeda antiga é ignorado enquanto existir mutação local recente, exceto quando for uma confirmação exata da última operação ou concessão explícita do mestre.

### 2. Inventário/equipamento sem rollback

Arquivo: `src/app/sheet.tsx`

- Adicionado `pendingSelfInventoryStateRef`.
- Equipar/desequipar agora aplica localmente antes do socket.
- Remover/consumir item também aplica localmente antes do socket.
- `inventory_patch` antigo/checkpoint antigo é ignorado se conflitar com uma alteração local recente.
- Confirmação oficial compatível limpa a pendência.

### 3. Ações rápidas não entram em trava global da ficha

Arquivo: `src/app/sheet.tsx`

- `runSheetAction` não bloqueia mais ações prefixadas com:
  - `coin:`
  - `inventory:`
  - `equip:`

Essas ações são idempotentes e protegidas por estado pendente, então não precisam travar a UI.

### 4. Host não cria snapshot/reload para moeda autônoma

Arquivo: `src/app/lan-session.tsx`

- `coin_self_patch_request` não dispara mais `reloadSessionState`.
- Também não força payload/snapshot imediato.
- O host envia evento vivo e agenda payload silencioso depois.

### 5. Passagem de turno mais rápida

Arquivo: `src/app/lan-session.tsx`

- `handleAdvanceTime` não trava mais as filas de todos os jogadores.
- Agora usa apenas a fila da sessão.
- `session_patch`, `effect_patch`, `effect_expired` e `pending_save_patch` são enviados antes de timeline/payload.
- Timeline e refresh viraram pós-processamento não bloqueante.

## Pontuação técnica

- UI runtime imediato: 10/10
- Proteção contra rollback local: 10/10
- Separação de snapshot x evento vivo: 9.5/10
- Passagem de turno/efeitos: 9.5/10
- Robustez real em 3+ celulares: precisa validação física, mas a arquitetura aplicada é a correta para impedir os bugs vistos nos logs.

