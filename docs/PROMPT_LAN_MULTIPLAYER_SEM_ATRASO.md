Aja como desenvolvedor React Native + TypeScript senior.

Objetivo: refatorar o modo LAN para ser fluido com 1 mestre como servidor e 10+ jogadores.

Regras obrigatorias:

1. Separar fluxos:
   - Offline singleplayer: altera estado local/SQLite direto.
   - LAN Master: mestre e servidor autoritativo; altera runtime primeiro, envia evento por socket, persiste depois.
   - LAN Player: jogador e cliente; recebe event_commit, atualiza UI primeiro, persiste SQLite depois.

2. Proibido no multiplayer:
   - UI esperar reload/payload/snapshot para HP, XP, moedas, efeitos, inventario, pausa ou encerramento.
   - UI esperar SQLite para mostrar evento de socket.
   - resync como caminho normal de atualizacao.
   - snapshot estrutural sobrescrever estado vivo.

3. Autoridade do mestre:
   - dar/remover HP, vida maxima, PV temporario, XP, moedas;
   - aplicar atributos permanentes/temporarios;
   - adicionar item novo ou aumentar quantidade;
   - aplicar efeitos/condicoes;
   - pausar, continuar e encerrar campanha.

4. Autonomia do jogador:
   - equipar/desequipar/consumir/dropar/arremessar item proprio;
   - doar item ou propor troca com jogadores da sessao;
   - aceitar/recusar troca;
   - converter moedas sem criar valor;
   - conjurar habilidades/magias, gerando eventos de dano/cura/efeito/teste.

5. Solicita aprovacao do mestre:
   - aumentar moeda;
   - criar item/aumentar quantidade;
   - ganhar XP;
   - alterar HP/tempHP/atributos manualmente;
   - aplicar efeito manual em si mesmo.

6. Rede:
   - event_commit direto por socket e caminho principal;
   - polling apenas fallback com intervalo alto;
   - fila por socket no host;
   - roteamento por jogador para eventos privados;
   - session_ended/session_patch furam old_seq;
   - ACK nao pode bloquear UI.

7. Pausa/encerramento:
   - Pausar: campanha continua depois; vinculos ficam; ficha leitura; socket aceita session_patch/session_ended/player_kicked.
   - Continuar: volta para active com mesmos vinculos.
   - Encerrar: finalizou; active=0; status=ended; desvincula todas as fichas; limpa runtime; remove da lista.
