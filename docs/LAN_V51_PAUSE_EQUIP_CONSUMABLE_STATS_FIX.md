# LAN v51 — Pause dedupe, equipamento com atributo e consumível permanente

## Correções

### 1. Pause sem alert duplicado
O `session_patch` de pause/resume agora possui dedupe global por `sessionId:eventId` antes de qualquer `await`.

Isso evita que múltiplas assinaturas vivas no jogador processem o mesmo pause ao mesmo tempo e disparem dois alerts.

### 2. Item equipado que altera atributo reflete no mestre
O `inventory_patch` oficial agora também carrega `statsPatch` quando o jogador equipa/desequipa um item que altera atributo enquanto está usando.

Fluxo:

```txt
Jogador equipa item
  -> atualiza ficha local imediatamente
  -> envia inventory_patch + statsPatch
  -> mestre aplica runtime primeiro
  -> mestre devolve inventory_patch oficial + statsPatch
  -> SQLite/payload em background
```

### 3. Consumível permanente não vira efeito temporário
Consumível com atributo permanente não cria mais efeito ativo temporário. Ele altera diretamente `stats` e notifica o host via `inventory_patch + statsPatch`.

Consumíveis temporários continuam usando efeito vivo com duração.

### 4. Consumo de item em LAN envia um único patch coerente
O consumo agora atualiza:

- inventário após remover quantidade consumida;
- stats permanentes/temporários;
- efeitos temporários quando existirem.

O host recebe tudo como uma única alteração principal, evitando divergência entre mochila, efeito e atributo.

## Arquivos alterados

- `src/app/sheet.tsx`
- `src/app/lan-session.tsx`
