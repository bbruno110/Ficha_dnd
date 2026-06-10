# LAN v48 — Correção de agrupamento de item e inundação de eventos no jogador

## Problemas corrigidos

1. Ao mestre enviar o mesmo item várias vezes, o inventário do jogador podia não refletir a soma corretamente.
2. O jogador podia receber uma quantidade muito grande de eventos no tracer, chegando ao limite de 2000 logs, enquanto o mestre tinha poucos logs.
3. Eventos destinados a outros jogadores ou eventos já conhecidos podiam continuar sendo reprocessados pelo cliente em `forceFullDrain`/resync.

## Regras aplicadas

### Item stackável

O inventário agora compacta a mochila por uma chave normalizada de stack:

- nome normalizado;
- dano;
- tipo de dano;
- propriedades;
- efeito JSON;
- duração.

Assim, `Ampulheta` enviada várias vezes vira:

```txt
Ampulheta x1
Ampulheta x2
Ampulheta x3
Ampulheta x4
...
```

Mas itens com mesmo nome e efeitos ocultos diferentes não são misturados automaticamente.

### Caminhos alterados

- Mestre: `handleGrantItemToPlayer` agora usa `mergeInventoryItemIntoBag`.
- Host/session: `normalizeEquipment` compacta duplicatas vindas de SQLite/eventos.
- Jogador: `normalizeSheetEquipment` compacta duplicatas ao aplicar `inventory_patch`.

### Anti-flood no jogador

O cliente agora:

- ignora localmente eventos claramente destinados a outros jogadores;
- não faz `forceFullDrain` quando recebe evento de outro alvo;
- não reemite atualização de resync para evento já conhecido;
- limita a busca local de eventos do buffer TCP;
- registra lote de eventos recebidos em vez de logar um `PLAYER_EVENT_RECEIVED` por evento.

## Critério de aceite

1. Mestre envia `Ampulheta` uma vez: jogador vê `Ampulheta x1`.
2. Mestre envia novamente: jogador vê `Ampulheta x2`.
3. Mestre envia quantidade 4: jogador soma +4 no mesmo item.
4. O tracer do jogador não deve explodir para milhares de linhas por causa de resync/eventos antigos.
5. A ação não deve depender de reabrir ficha, fechar app ou reload manual.
