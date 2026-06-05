# LAN V29 - autoridade unica para HP/PV temp/inventario

Correcoes aplicadas apos teste com 1 mestre + 3 jogadores.

## Problemas atacados

- HP voltando ao passar turno.
- PV temporario divergindo apos dano/passagem de turno.
- Envio de item mostrava mensagem, mas nao removia da origem nem chegava no destino.
- Troca entre jogadores nao concluia o inventario.
- Host travava com varios `reloadSessionState` simultaneos.

## Causa principal

Os eventos `player_patch` sao snapshots absolutos. Quando varios patches chegavam quase juntos, a aplicacao no jogador podia terminar fora de ordem. Um patch mais antigo podia sobrescrever o mais novo.

Alem disso, no mestre, a passagem de turno e a reconstrucao de efeitos aumentavam `revision_seq` no SQLite. Se um patch de HP ainda estava persistindo em paralelo, o reload do SQLite podia voltar com uma revisao maior, mas com HP antigo. Isso fazia a vida parecer voltar.

## Ajustes

- `useLanRealtimePlayerPatches.ts`: fila serial de aplicacao de eventos por seq/revision. HP, XP, moedas, PV temp e inventario nao aplicam mais em paralelo.
- `sheet.tsx`: guarda contra `player_patch` absoluto antigo; patch com revision/seq atrasado e ignorado.
- `lanSessionRuntimeStore.ts`: durante sessao viva, runtime do mestre preserva campos vivos contra snapshot/reload estrutural do SQLite.
- `lan-session.tsx`: `reloadSessionState` agora e travado/debounced para nao iniciar varios reloads simultaneos.
- `lanSession.ts`: envio/troca de item e executado uma unica vez pelo host ativo; cache stale do host nao rejeita automaticamente a acao do jogador.
- `lanSession.ts`: remocao de item em envio/troca aceita remocao parcial no snapshot oficial para evitar item reaparecer por divergencia de quantidade/cache.
- `sheet.tsx`: atualizacoes otimistas de inventario e efeitos tambem atualizam `characterRef`, evitando a UI voltar para estado antigo.

## Fluxo esperado

### Envio direto

1. Jogador A envia item para jogador B.
2. UI de A remove item de forma otimista.
3. Host processa `send_item_request` uma vez.
4. Host grava snapshots oficiais dos dois inventarios.
5. Host envia `inventory_patch` para A e B.

### Troca

1. A cria proposta para B.
2. B responde com item ou sem contraoferta.
3. A aceita.
4. Host processa `trade_accept` uma vez.
5. Host envia `inventory_patch` oficial para os dois participantes.

