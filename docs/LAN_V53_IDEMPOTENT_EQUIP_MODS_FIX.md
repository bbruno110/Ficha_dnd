# LAN v53 - Correção de bônus duplicado ao equipar item

## Problema corrigido

Ao equipar um item com bônus de atributo, por exemplo uma armadura com `CON +2`, o bônus podia ser aplicado duas vezes quando o mesmo estado de equipamento era reenviado pelo jogador ou reaplicado por checkpoint/resync.

Nos logs, o mesmo estado de equipamento apareceu mais de uma vez:

- `inventory_patch` de equipar armadura enviado pelo jogador;
- commit oficial do mestre;
- checkpoint de inventário;
- novo `inventory_patch` equivalente alguns segundos depois.

Se o cálculo de `equip_mods` fosse incremental, isso podia transformar `CON +2` em `CON +4`.

## Regra nova

`equip_mods` não é mais tratado como soma incremental.

Agora ele é sempre derivado do estado final dos slots equipados:

```txt
slots atuais -> ler effect_json/texto dos itens -> calcular equip_mods do zero
```

Isso torna a operação idempotente:

```txt
aplicar Armadura CON +2 uma vez  => equip_mods.CON = 2
reaplicar o mesmo estado         => equip_mods.CON = 2
receber checkpoint do mesmo slot => equip_mods.CON = 2
```

## Arquivos alterados

- `src/app/sheet.tsx`
- `src/stores/lanSessionRuntimeStore.ts`

## Alterações principais

### Ficha do jogador

- Adicionado cálculo de bônus de equipamento a partir dos slots atuais.
- `handleEquipItem` agora recalcula `equip_mods` do zero após montar `nextEquipment`.
- `applyLanInventoryPatchToCharacter` também recalcula `equip_mods` do zero ao receber `inventory_patch`/checkpoint.
- Envio duplicado de inventário idêntico em curto intervalo é ignorado localmente.

### Runtime do mestre

- `applyHostInventoryPatchRuntime` agora compara CON anterior e CON nova usando estados canônicos derivados dos slots.
- O HP máximo só muda pela diferença real entre o equipamento anterior e o equipamento atual.
- Reaplicar o mesmo `inventory_patch` não aumenta HP novamente.

## Critério de aceite

1. Mestre entrega uma armadura com `CON +2`.
2. Jogador equipa a armadura.
3. A ficha deve mostrar o bônus uma única vez.
4. O mestre deve ver o mesmo valor.
5. Se houver resync/checkpoint/rebind, o bônus não pode duplicar.
6. Desequipar deve remover o bônus exatamente uma vez.
