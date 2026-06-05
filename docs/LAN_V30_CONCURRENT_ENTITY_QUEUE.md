# LAN v30 - Refatoracao para muitos eventos simultaneos

## Problema tratado

Cenario alvo:

- jogador 3 solicita troca com jogador 1;
- jogador 2 envia item para jogador 5;
- mestre clica 4x em -1 HP no jogador 4;
- jogador 6 solicita XP;
- jogador 7 equipa item;
- jogador 8 consome item com efeito permanente ou temporario;
- tudo acontecendo quase ao mesmo tempo.

Antes, alguns fluxos eram serializados pela tela inteira ou bloqueados por `actionId` duplicado. Em outros pontos, patch de efeito/HP/inventario podia terminar fora de ordem e sobrescrever estado mais novo.

## Mudanca principal

Foi criado `src/services/lan/lanEntityQueue.ts`.

Essa fila usa chaves de entidade:

- `sessionId:player:<playerId|remoteKey>` para HP, XP, moedas, PV temporario e atributos;
- `sessionId:inventory:<remoteKey>` para inventario/equipar/consumir/enviar item;
- `sessionId:session` para passagem de turno, pausa, encerramento e eventos globais;
- pares de troca/envio travam os inventarios dos dois jogadores ao mesmo tempo.

Assim:

- eventos do mesmo jogador entram em ordem;
- eventos de jogadores diferentes podem continuar fluindo;
- troca/envio nao conflita com equipar/consumir do mesmo jogador;
- passagem de turno espera as mutacoes pendentes dos jogadores antes de salvar ticks/efeitos.

## Pontos corrigidos

1. Cliques repetidos de HP
   - `damage:<playerId>` nao bloqueia mais clique repetido.
   - 4 cliques rapidos viram 4 mutacoes enfileiradas para o mesmo jogador.

2. HP/PV temporario
   - persistencia SQLite do patch numerico agora é aguardada na fila.
   - evita patch antigo persistir depois de patch novo e fazer vida voltar.

3. Passagem de turno
   - agora entra na fila de sessao + jogadores ativos.
   - evita aplicar tick de efeito usando HP/PV temporario antigo enquanto dano/cura ainda está sendo persistido.

4. Inventario, envio e troca
   - `send_item_request` e `trade_accept` usam lock dos dois inventarios envolvidos.
   - `entityId` de evento de inventario agora usa participantes reais, nao `master`.
   - item equipado tambem pode ser removido do slot ao enviar/trocar.

5. Cliente jogador
   - `effect_patch` nao é mais aplicado em background.
   - efeitos que mexem em PV temporario/atributo agora terminam antes do proximo patch ser marcado como aplicado.

## Teste recomendado

1. Abrir mesa com 4+ celulares.
2. Entrar com pelo menos 3 jogadores.
3. No mesmo intervalo:
   - mestre clicar 4x em -1 HP no mesmo jogador;
   - outro jogador enviar item;
   - outro jogador equipar item;
   - outro jogador consumir item com PV temporario;
   - passar turno.
4. Verificar:
   - HP final não volta;
   - PV temporario não reaparece após ser consumido por dano;
   - origem perde o item e destino recebe;
   - troca conclui nos dois inventarios;
   - logs devem mostrar `LAN_ENTITY_QUEUE_START` e `LAN_ENTITY_QUEUE_DONE`.
