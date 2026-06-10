# LAN v39 — Level up autoritativo e pausa estável

Correção focada em dois bugs recorrentes:

1. Jogador subia de nível localmente, mas o mestre continuava com nível/PV máximo antigo.
2. Pausar sessão alternava visualmente entre pausado/continuando por causa de snapshot/payload atrasado.

## Correções aplicadas

### 1. Inferência real de nível pela classe

Alguns fluxos salvavam a classe como `Ladino 2`, `Mago 2`, etc., mas o campo `level` podia continuar antigo ou não ser confiável durante join/reconnect.

Agora o app infere o nível total pelo texto da classe:

- `Ladino 2` => nível 2
- `Guerreiro 2 / Mago 1` => nível 3

Essa inferência foi aplicada no jogador e no host.

### 2. Join/reconnect também pode carregar progressão

O level up não depende mais exclusivamente do evento `player_progression_patch`.

Se o jogador reconectar/enviar `sendLanTcpJoin` com classe/nível/PV máximo de progressão, o mestre autoaceita quando:

- o XP oficial do mestre autoriza o nível;
- a raça não mudou;
- o fluxo não tenta sobrescrever moedas/inventário oficiais.

### 3. Runtime do mestre não bloqueia mais HP máximo de level up

Antes, o runtime preservava `hpMax` como campo vivo de combate. Isso protegia contra vida voltando, mas também impedia o `hpMax` novo de level up de entrar.

Agora:

- se o incoming representa progressão, `hpCurrent/hpMax` do level up são aceitos;
- se o current já está em nível maior, snapshot antigo não rebaixa nível/classe/hpMax.

### 4. Player patch antigo não deve spammer level up

A ficha agora considera nível inferido pela classe ao decidir se deve mostrar modal de level up.

Também há debounce por `(personagem, XP, nível esperado)`, evitando abrir o modal repetidamente a cada `player_patch` com o mesmo XP.

### 5. Pausa/continuação só por evento oficial

Payload/snapshot não gera mais `session_patch` sintético de `paused/active`.

Motivo: payload é cache estrutural e pode chegar atrasado. Só `session_patch` oficial criado pelo mestre altera pausa/continuação.

### 6. Lock curto de ciclo de vida no mestre

Durante pausar/continuar, reloads do SQLite não podem sobrescrever o status recém-aplicado na UI. Foi adicionado um lock curto para evitar alternância visual entre `active` e `paused`.

## Arquivos alterados

- `src/services/lanSession.ts`
- `src/app/edit.tsx`
- `src/app/sheet.tsx`
- `src/services/lanTcpTransport.ts`
- `src/app/lan-session.tsx`
- `src/stores/lanSessionRuntimeStore.ts`
