# LAN V50 — histórico rápido, grant de item stackável, stats em tempo real e pause sem alerta duplicado

## Objetivo
Corrigir regressões da v49:

- grant de item do mestre não chegando/empilhando corretamente no inventário do jogador;
- histórico da campanha demorando a aparecer;
- atributo permanente demorando ou chegando sem aplicação imediata;
- pause da sessão disparando dois alertas no jogador;
- replay/snapshot antigo interferindo em inventário/equipamento.

## Alterações principais

### 1. Histórico runtime-first
`recordMasterTimelineEvent` agora adiciona o evento no runtime imediatamente via `rememberSentEventInTimeline` e persiste em background.

Regra: histórico visível da campanha nunca deve depender de reload, snapshot ou SQLite lento.

### 2. Grant de item com `itemDelta`
`inventory_patch` agora pode carregar:

```ts
itemDelta: {
  mode: 'add',
  item,
  qty,
  stackKey,
}
```

O `equipment` continua sendo o estado final autoritativo, mas o `itemDelta` permite o jogador aplicar imediatamente grants stackáveis mesmo se o payload completo chegar atrasado.

Exemplo esperado:

```txt
Mestre envia Faca 1x -> jogador vê Faca x1
Mestre envia Faca 1x -> jogador vê Faca x2
Mestre envia Faca 4x -> jogador vê Faca x6
```

### 3. Stats patch direto
`useLanRealtimePlayerPatches` ganhou `onStatsPatch`. Assim, `player_patch` com `statsPatch` não precisa passar pelo fluxo genérico `onEvent/handleLanEvents` para atualizar a ficha.

Isso corrige atributo permanente e reduz atraso.

### 4. Pause sem alerta duplicado
Adicionado dedupe global de alerta de pausa por `sessionId + eventId`.

Motivo: durante foreground/rebind, podem existir duas assinaturas vivas por poucos milissegundos. O evento deve ser processado, mas o alerta visual não pode aparecer duas vezes.

## Arquivos alterados

- `src/services/lanSession.ts`
- `src/hooks/useLanRealtimePlayerPatches.ts`
- `src/app/sheet.tsx`
- `src/app/lan-session.tsx`

## Critérios de teste

1. Mestre concede item que o jogador já possui.
2. O item deve somar quantidade no inventário do jogador.
3. Mestre concede item repetidas vezes rapidamente.
4. O jogador não deve receber duplicatas como linhas separadas.
5. Mestre aplica atributo permanente.
6. O atributo deve atualizar rapidamente na ficha do jogador.
7. Mestre pausa a sessão.
8. O jogador deve receber apenas um alerta.
9. Histórico da campanha deve registrar as ações sem depender de reload.
