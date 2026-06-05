# LAN v28 - correção de travamento por ACK/snapshot e resync frio

Correções aplicadas após os logs de 2026-06-05 10:20/10:23:

- ACK/NACK de evento não envia mais `hello` em socket já aberto.
  - Antes: cada ACK fazia o host responder com `session_snapshot`.
  - Com muitos eventos pendentes, um jogador que reabria a ficha gerava dezenas de snapshots e travava mestre/outros jogadores.
- `getLanTcpClientEvents`/resync não reenvia `hello` em todo polling quando a conexão já está vinculada ao jogador.
- O host não acorda a UI do mestre para cada ACK recebido; ACK fica salvo em memória para debug/retry.
- Resync frio (`lastAppliedSeq <= 0`) não faz replay completo de HP/efeitos/inventário; envia checkpoints autoritativos e apenas eventos de fluxo recentes.
- Fila por socket descarta snapshots/payloads antigos quando chega um payload estrutural mais novo.
- Trace de `session_snapshot`/`payload_update` foi limitado para não congestionar o tracer.
- Passagem de turno agora gera `session_patch` com `currentTurn`/`elapsedMinutes`, em vez de depender de payload estrutural.
- Rebind ao focar a ficha não força reconexão sem necessidade.
- Timeout do join aumentou para evitar falso timeout quando o banco está ocupado.
