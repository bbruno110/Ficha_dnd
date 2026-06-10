# LAN v52 — Equipamento CON/HP e consumo permanente/temporário

## Objetivo
Corrigir os problemas restantes da v51:

- item equipado com bônus de atributo, especialmente CON, não refletia corretamente na ficha e no mestre;
- consumível permanente aparecia como efeito ativo parecido com temporário;
- consumíveis permanentes/temporários podiam não sair do inventário rapidamente;
- consumo de item ainda podia reenviar eventos antigos recentes e gerar sensação de atraso/rollback.

## Correções

### 1. Equipamento agora lê `effect_json`
Antes o bônus de equipamento vinha quase só do texto `damage`, por exemplo `CON 2 + CA 3`.
Agora `getEquipBonus()` também lê efeitos estruturados salvos em `effect_json`.

Isso permite que uma armadura criada no editor avançado com:

```json
{
  "effects": [{ "type": "stat", "target": "CON", "value": 2 }]
}
```

adicione `equip_mods.CON = +2` enquanto estiver equipada.

### 2. CON equipada altera HP no mestre
O runtime do mestre agora calcula a diferença de modificador de CON antes/depois do `statsPatch` e ajusta:

- `hpMax`;
- `hpCurrent`.

Assim o card/roster do mestre acompanha o mesmo efeito visual que a ficha do jogador.

### 3. Consumível permanente não cria mais `effect_patch`
Quando o item consumível concede atributo permanente, o host agora chama `applyPermanentStatEffectToPlayer()` e envia `player_patch` com `statsPatch`, em vez de criar `effect_patch` com `permanent_item_effect`.

Resultado esperado:

- FOR +1 permanente altera `stats.FOR`;
- não aparece como efeito ativo temporário/permanente na lista;
- fica salvo como atributo real da ficha.

### 4. Consumível remove inventário por delta
O consumo agora envia `inventory_patch` com:

```ts
itemDelta: {
  mode: 'remove',
  item,
  qty,
  stackKey
}
```

O jogador aplica a remoção mesmo se o snapshot completo estiver atrasado.

### 5. Remoção runtime-first
Ao consumir item, o host atualiza o runtime primeiro, envia o patch vivo para o jogador e persiste o SQLite em segundo plano.

### 6. Não reenviar eventos antigos no consumo
O fluxo de consumo não chama mais `sendRecentLiveEvents()` para `player_patch/effect_patch` depois do uso do item. Isso evita o jogador receber dano/efeito antigo logo após consumir item.

## Arquivos alterados

- `src/app/sheet.tsx`
- `src/app/lan-session.tsx`
- `src/stores/lanSessionRuntimeStore.ts`

## Teste recomendado

1. Mestre entrega uma armadura com `CON +2` via efeito estruturado.
2. Jogador equipa a armadura.
3. A ficha do jogador deve mostrar CON/HP ajustados.
4. O mestre deve ver HP máximo atualizado no card/roster.
5. Jogador consome item temporário.
6. O item deve sair do inventário e gerar efeito temporário.
7. Jogador consome item permanente.
8. O item deve sair do inventário e o atributo deve alterar direto na ficha, sem aparecer como efeito ativo.
