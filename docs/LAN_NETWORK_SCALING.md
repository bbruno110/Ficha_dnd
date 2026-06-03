# LAN multiplayer - arquitetura para 10+ celulares

## Regra de autoridade

O celular do Mestre é o servidor autoritativo da mesa. Jogadores mantêm uma conexão TCP persistente com o host.

## Ciclo de vida da sessão

- `active`: campanha acontecendo. Eventos vivos são processados normalmente.
- `paused`: campanha não acabou, mas a mesa parou por hoje. Jogadores ficam vinculados e em leitura. A rede só deve aceitar eventos críticos (`session_patch`, `session_ended`, `player_kicked`) e heartbeat reduzido.
- `ended`: campanha finalizada. O host envia `session_ended`, desativa jogadores/bindings e a ficha do jogador volta ao modo offline.

## Roteamento de eventos

- Eventos privados (`player_patch`, `effect_patch`, `inventory_patch`) vão somente para o jogador alvo.
- Trocas e envio de item vão para os participantes da ação.
- Eventos globais (`session_patch`, `session_ended`, `timeline_event`) vão para todos.
- Eventos `toKey = master` ficam no mestre e não são retransmitidos para todos os jogadores.

## Escalabilidade

Para 10+ celulares, evitar broadcast desnecessário. O host mantém um registro de conexões por `playerKey` e uma fila por socket, serializando os envios.

## Resync

Resync é fallback, não caminho principal. Deve ocorrer somente por reconexão, gap real de seq/revision ou retorno do app do background. O fluxo normal deve ser: socket recebe `event_commit` -> UI atualiza -> SQLite persiste em segundo plano -> ACK.
