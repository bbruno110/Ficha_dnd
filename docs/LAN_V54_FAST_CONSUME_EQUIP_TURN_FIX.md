# LAN v54 - correção de equipamento, consumo autônomo e turno único

## Objetivo
Corrigir os bugs restantes da v53:

- turnos avançando duas vezes;
- consumo de item próprio pedindo permissão do mestre;
- consumíveis permanentes/temporários não reduzindo quantidade no inventário;
- item equipado com bônus de atributo/CA não refletindo corretamente no mestre;
- armadura criada no avançado somando bônus duas vezes por ter o mesmo efeito no texto e no `effect_json`;
- mestre não enxergando claramente a CA do jogador.

## Regras consolidadas

### Item próprio do jogador
O jogador pode consumir, equipar, desequipar, dropar, arremessar, doar e trocar item próprio sem aprovação do mestre, desde que a ação não aumente a quantidade do inventário.

Fluxo correto:

```txt
Jogador usa item
  -> atualiza UI local imediatamente
  -> reduz quantidade local imediatamente
  -> envia inventory_patch com baseEquipment + equipment final
  -> se houve redução, envia itemDelta remove
  -> se houve atributo permanente, envia statsPatch
  -> se houve efeito temporário, envia effect_patch
  -> host aplica no runtime
  -> host persiste em background
  -> host confirma para jogador
```

### Aumentar item/moeda
Se o jogador tentar aumentar quantidade sem origem válida, continua sendo solicitação para o mestre.

## Correções aplicadas

### 1. Consumo não depende mais do mestre
`applyStructuredItemEffects` não cria mais `item_use_request` em LAN para item próprio. O consumo vira patch autônomo:

- `inventory_patch` para remover item;
- `statsPatch` para atributo permanente;
- `effect_patch` para temporário/condição;
- `player_patch` apenas quando o efeito altera HP/PV diretamente.

### 2. Inventário reduz quantidade corretamente
`notifyInventoryPatch` agora infere `itemDelta remove` comparando `baseEquipment` e `equipment` final.

Exemplo:

```txt
2x Consumível Temporário -> consumir 1 -> 1x Consumível Temporário
1x Consumível Temporário -> consumir 1 -> remove da mochila
```

### 3. Consumível permanente não vira efeito ativo
Consumível permanente altera o atributo real em `statsPatch`. Ele não precisa aparecer como buff temporário.

### 4. CON permanente ajusta HP base
Se um consumível permanente altera CON, o app ajusta `hp_max` e `hp_current` localmente. Ao receber `statsPatch` oficial, a ficha também recalcula HP base se o CON mudou.

### 5. Equipamento com `effect_json` não duplica bônus
Itens criados no avançado podem salvar o bônus tanto no texto legível quanto no `effect_json`, por exemplo:

```txt
Texto: CA 5 + CON 10
Effect JSON: CA +5, CON +10
```

A partir da v54, quando existe efeito estruturado em `effect_json`, o parser ignora o texto como fonte mecânica e usa apenas o `effect_json`. O texto fica só como descrição.

### 6. Mestre vê CA do jogador
O card do mestre agora mostra:

```txt
HP atual/máximo - CA X - XP - moedas - efeitos
```

A CA é calculada com equipamento, DES, bônus temporário, bônus de item e efeitos ativos.

### 7. Turno não duplica
`handleAdvanceTime` já cria e envia o `session_patch` vivo. `advanceLanSessionTime` agora aceita `skipSessionPatchEvent`, evitando gravar um segundo `session_patch` de turno no SQLite que depois voltava por resync e avançava novamente.

## Arquivos alterados

```txt
src/app/sheet.tsx
src/app/lan-session.tsx
src/services/lanSession.ts
src/stores/lanSessionRuntimeStore.ts
docs/LAN_V54_FAST_CONSUME_EQUIP_TURN_FIX.md
```

## Testes recomendados

```txt
1. Mestre entrega armadura com CA +5 e CON +10 criada no avançado.
2. Jogador equipa.
3. CA e HP/CON devem refletir uma única vez no jogador e no mestre.
4. Jogador desequipa.
5. Bônus deve sair uma única vez.
6. Mestre entrega 2x consumível temporário.
7. Jogador consome 1x.
8. Deve ficar 1x no inventário, sem pedir permissão.
9. Jogador consome o segundo.
10. O item deve sair do inventário.
11. Mestre entrega consumível permanente.
12. Jogador consome.
13. Atributo real deve mudar, sem criar efeito ativo permanente.
14. Mestre passa um turno.
15. Deve avançar exatamente 1 turno.
```
