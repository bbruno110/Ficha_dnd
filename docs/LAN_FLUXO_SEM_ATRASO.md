# LAN multiplayer sem atraso perceptível

## Regra central

O app tem três fluxos separados:

1. `offline_singleplayer`: a ficha altera SQLite/local diretamente.
2. `lan_master_authoritative`: o mestre altera runtime do host, envia evento direto por socket, e persiste SQLite em segundo plano.
3. `lan_player_client`: o jogador recebe evento por socket, atualiza UI imediatamente, e persiste SQLite em segundo plano.

## O que nunca deve acontecer no multiplayer

- UI esperar `reloadSessionState` para mostrar HP, efeito, inventário, pausa ou encerramento.
- UI esperar SQLite para mostrar evento recebido pelo socket.
- Jogador aplicar snapshot estrutural como estado vivo de ficha.
- Resync ser usado como caminho normal de atualização.
- Pausa gerar loop de polling/resync.

## Autoridade

### Mestre pode aplicar diretamente

- HP/vida máxima/vida temporária.
- XP.
- moedas.
- atributos permanentes ou temporários.
- itens novos ou aumento de quantidade.
- efeitos/condições/buffs/debuffs.
- ciclo de vida da sessão: pausar, continuar, encerrar.

### Jogador pode fazer sem aprovação

- equipar/desequipar item próprio.
- consumir item próprio.
- dropar/arremessar item próprio.
- doar item para outro jogador.
- propor/aceitar/recusar troca.
- converter moedas sem criar valor.
- conjurar habilidade/magia que usa recurso próprio.

### Jogador precisa pedir ao mestre

- aumentar moeda.
- criar item novo ou aumentar quantidade.
- ganhar XP.
- ganhar HP/vida temporária manualmente.
- alterar atributo manualmente.

## Rede

- `event_commit` pelo socket é o caminho principal.
- Polling é fallback a cada vários segundos.
- `session_ended` e `session_patch` são eventos críticos e não podem ser bloqueados por `old_seq`.
- Eventos críticos são roteados por jogador quando possível.
- Snapshot é bootstrap/recovery, não atualização viva.
