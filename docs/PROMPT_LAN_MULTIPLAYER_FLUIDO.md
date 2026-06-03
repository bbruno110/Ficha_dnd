# Prompt técnico — Refatoração LAN multiplayer fluida

Aja como desenvolvedor React Native + TypeScript sênior. O projeto é um app Expo/React Native de ficha D&D com modo LAN local. O Mestre é o servidor/host autoritativo e os jogadores são clientes TCP.

## Objetivo

Refatorar o modo multiplayer para funcionar de forma fluida com 1 mestre e 10+ celulares jogadores, evitando atrasos perceptíveis, replay de eventos antigos, duplicidade de histórico e travamento de sessão pausada/encerrada.

## Regra de autoridade

### Mestre/Host

O Mestre administra eventos oficiais da mesa:

- criar sessão/mesa;
- pausar campanha;
- continuar campanha;
- encerrar campanha definitivamente;
- dar XP;
- alterar vida atual, vida máxima e vida temporária;
- aplicar atributos permanentes ou temporários;
- entregar itens novos ou aumentar quantidade de itens;
- entregar moedas;
- aplicar efeitos/condições, como cegueira, lentidão, paralisia, bônus/debuff;
- resolver/aplicar efeitos com salvaguarda ou teste de atributo;
- ver histórico da sessão.

### Jogador

O jogador pode controlar somente o que é dele:

- equipar/desequipar itens próprios;
- consumir, dropar, arremessar ou doar itens próprios;
- propor troca entre jogadores da mesma sessão;
- aceitar/recusar/contraofertar trocas;
- reduzir quantidade de itens próprios;
- converter moedas próprias, usando a regra da mesa: 1 ouro = 20 pratas;
- solicitar ao mestre XP, vida, moeda, atributo ou criação/aumento de recurso;
- ao ganhar XP suficiente, escolher subir de nível;
- usar habilidades/magias em si ou em outros jogadores;
- habilidades podem causar dano, cura, efeitos fixos ou efeitos com teste/salvaguarda.

O jogador não pode criar recurso novo sem aprovação do Mestre:

- não pode mudar 10 moedas para 11;
- não pode criar item novo;
- não pode aumentar quantidade de item;
- não pode aplicar atributo/XP/vida positiva oficial sem autorização do Mestre, exceto por habilidade/magia resolvida pelo fluxo oficial.

## Ciclo de vida da sessão

### Pausar campanha

Pausar significa que a campanha ainda não acabou. Exemplo: está tarde e o grupo continuará outro dia.

Regras:

- sessão permanece salva;
- status vira `paused`;
- `active` continua `1`;
- jogadores continuam vinculados;
- fichas dos jogadores ficam read-only;
- socket pode continuar vivo somente para eventos críticos;
- jogadores precisam receber `session_patch` imediatamente;
- botão do Mestre deve virar `Continuar` imediatamente;
- não deve haver polling/resync agressivo nem flood de logs.

### Continuar campanha

Continuar significa voltar de uma pausa.

Regras:

- status volta para `active`;
- mesmos jogadores/vínculos continuam;
- fichas deixam de ser read-only;
- socket volta a aceitar eventos vivos normais;
- botão do Mestre volta para `Pausar`.

### Encerrar campanha

Encerrar significa que a campanha finalizou definitivamente.

Regras:

- enviar `session_ended` para todos os jogadores;
- `session_ended` é evento terminal e deve furar qualquer bloqueio por `old_seq`, pausa ou snapshot antigo;
- status vira `ended`;
- `active` vira `0`;
- todos os jogadores da sessão ficam desconectados/inativos;
- todos os bindings locais da sessão são desativados;
- jogador limpa `lanInfo`, `lanSessionStatus`, trades e runtime LAN;
- ficha volta para modo offline/singleplayer;
- sessão encerrada não aparece em sessões ativas/retomáveis.

## Rede e performance

O socket TCP deve ser o caminho principal. Polling/resync é fallback.

### Evento recebido por socket

Quando o jogador recebe `event_commit`:

1. validar sessão/alvo;
2. aplicar UI/memória imediatamente;
3. persistir SQLite depois;
4. enviar ACK;
5. não esperar reload/payload completo.

### Eventos críticos

Devem ter prioridade na fila por socket:

- `session_ended`;
- `session_patch`;
- `player_kicked`;
- `player_patch`;
- `effect_patch`;
- `inventory_patch`;
- `pending_save_patch`.

### Payload

`payload_update` e `session_snapshot` são cache estrutural. Não devem sobrescrever HP, XP, moedas, inventário ou efeitos vivos.

### Resync

Resync não deve fazer replay de histórico antigo. Deve enviar checkpoint atual seguro.

## Testes obrigatórios

1. Mestre cria mesa, dois jogadores entram.
2. Mestre dá +1 HP em um jogador. Deve atualizar quase instantâneo.
3. Mestre aplica PV temporário por 1 turno. Ao passar turno, some no mestre e no jogador rapidamente.
4. Mestre aplica FOR +1 temporário por 1 turno. Ao passar turno, some no mestre e no jogador rapidamente.
5. Jogador reduz moeda. Não pede aprovação.
6. Jogador tenta aumentar moeda. Pede aprovação.
7. Jogador converte 1 ouro para 20 pratas. Não pede aprovação.
8. Jogador arremessa item. Histórico aparece uma vez.
9. Jogador propõe troca. Outro jogador recebe e pode aceitar/recusar.
10. Mestre pausa. Jogador fica read-only; botão vira Continuar; sem flood de log.
11. Mestre continua. Jogador volta ao modo ativo.
12. Mestre encerra. Jogador desvincula e volta ao modo offline.
