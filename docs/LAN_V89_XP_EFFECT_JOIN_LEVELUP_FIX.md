# LAN v89 — XP, remoção de efeitos, join e level-up runtime-first

## Problemas tratados

- XP distribuído pelo mestre não refletia no jogador.
- XP enviado diretamente para um jogador não refletia, enquanto XP via solicitação funcionava.
- Jogador ainda podia piscar ao entrar/reentrar na sessão.
- Condição/efeito manual aplicado pelo mestre não era removido imediatamente pelo ícone de lixeira.
- Após o jogador subir de nível, a ficha podia ficar travada para ações do mestre como dano/cura.

## Correções aplicadas

### 1. XP direto e distribuído agora usa `player_patch` vivo

Foi criado o fluxo `grantXpToPlayerFast`, que usa o mesmo caminho autoritativo e fluido de HP/moedas:

- atualiza o runtime do mestre imediatamente;
- gera `player_patch` com `numberPatch.xp`;
- envia evento vivo pelo socket;
- persiste no SQLite em background;
- não depende de reload completo para aparecer no jogador.

`MASTER_DISTRIBUTE_XP` e `MASTER_APPLY_QUICK_EDIT` do tipo XP passam por esse fluxo.

### 2. Remoção de condição/efeito manual é runtime-first

O clique na lixeira agora chama `persistHostEffectRemovalPatch`:

- remove o efeito do runtime local do mestre imediatamente;
- envia `effect_patch.remove` para o jogador;
- atualiza o card público;
- persiste a remoção no SQLite em background.

Se o efeito removido for de PV temporário, o `tempHp` também é recalculado e enviado junto no mesmo evento.

### 3. Join/reconnect sem sobrescrever jogador vivo

Quando um jogador que já existe no runtime entra/reentra:

- o mestre confirma o join imediatamente com o runtime atual;
- o upsert SQLite roda em background;
- snapshots antigos não removem jogadores vivos do roster;
- o status público é reenviado para estabilizar o card dos jogadores.

Isso reduz o “piscar” ao entrar/reconectar.

### 4. Level-up runtime-first

`player_progression_patch` agora é aplicado primeiro no runtime do mestre antes da persistência no SQLite:

- atualiza nível, classe, HP máximo/atual e atributos;
- envia status público atualizado;
- persiste e sincroniza depois.

Além disso, quando o jogador reconecta após salvar level-up, o snapshot de join também tenta aplicar a progressão no runtime imediatamente, sem aguardar o upsert lento.

### 5. Snapshot antigo preserva jogadores ativos

`mergeSessionStatePreservingLiveFields` agora preserva jogadores já vivos no runtime quando chega snapshot SQLite/payload com roster menor. Isso evita sumiço/reaparecimento visual durante join, reload e level-up.

## Observação

Envio, doação e troca de itens não foram alterados no fluxo principal porque o teste confirmou que estão funcionando corretamente.
