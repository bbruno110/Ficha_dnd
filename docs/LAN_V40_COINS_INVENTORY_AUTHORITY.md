# LAN v40 — Moedas e inventário autônomo do jogador

## Regras corrigidas

- Jogador pode reduzir moedas próprias sem aprovação do mestre.
- Jogador pode converter moedas próprias sem aprovação do mestre, desde que o valor total não aumente.
- Jogador pode equipar, desequipar, doar, trocar, arremessar ou dropar itens próprios quando isso não aumenta quantidade total de itens.
- Qualquer aumento líquido de moedas ou itens continua exigindo aprovação do mestre.
- O mestre pode entregar PO, PP e PC separadamente. PP/PC não são mais normalizados automaticamente para PO.

## Correções técnicas

- O cálculo de conversão de moeda do jogador foi alinhado ao host: `1 PO = 10 PP = 100 PC`.
- `coin_self_patch_request` aceito agora atualiza imediatamente o runtime/roster do mestre, sem depender de reload posterior.
- O quick edit do mestre para moedas agora soma por denominação:
  - `qeGP` altera `gp`;
  - `qeSP` altera `sp`;
  - `qeCP` altera `cp`.
- Antes, `+20 PP` era transformado em `+2 PO`; agora permanece como `+20 PP`.

## Contrato esperado

### Permitido sem mestre

```txt
15 PO -> 14 PO
15 PO -> 14 PO + 10 PP
2 poções -> 1 poção
item equipado -> item desequipado
item no inventário -> item dropado
item enviado/trocado com outro jogador
```

### Exige mestre

```txt
15 PO -> 16 PO
0 PP -> 20 PP sem converter PO/PC equivalentes
1 poção -> 2 poções
adicionar item novo sem origem válida
```
