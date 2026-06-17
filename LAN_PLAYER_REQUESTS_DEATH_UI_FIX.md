# LAN Player Requests, Party Panel and Death UI Fix

## Ajustes aplicados

- Jogador em sessão LAN não aplica mais diretamente pela própria ficha:
  - dano;
  - cura;
  - XP;
  - moedas;
  - buffs/atributos temporários.
- Essas ações agora enviam `PLAYER_REQUEST_*` para o mestre aprovar.
- Aumento de quantidade de item continua bloqueado para o jogador, mas agora aparece no painel do mestre como solicitação pendente.
- Mestre ganhou painel de solicitações pendentes com aprovar/recusar.
- Aprovar converte a solicitação em evento oficial do mestre:
  - HP -> `MASTER_APPLY_HP`;
  - XP -> `MASTER_APPLY_XP`;
  - moedas -> `MASTER_APPLY_COINS`;
  - atributo/buff -> `MASTER_APPLY_ATTRIBUTE`;
  - aumento de item -> `MASTER_APPLY_ITEM`.
- Recusar registra `COMMAND_REJECTED` na sessão.

## Sincronização para jogadores

- Jogadores agora aplicam eventos de outros personagens nos snapshots locais.
- Isso permite que o quadro “Sessão LAN” mostre em tempo real a vida e nível dos demais jogadores.
- A ficha local do jogador só é alterada quando o evento é realmente direcionado ao dispositivo/ficha dele.
- Snapshots recebidos no `SESSION_SNAPSHOT` agora também são persistidos em `lan_character_snapshots`.

## UI da ficha do jogador

- Adicionado quadro `SESSÃO LAN` na aba Status da ficha do jogador.
- O quadro mostra:
  - vida do próprio jogador;
  - vida dos demais jogadores;
  - nível dos jogadores;
  - efeitos apenas do próprio jogador.
- Outros jogadores não exibem seus efeitos para o jogador local.
- Vida temporária aparece no formato `10/10 +2`.
- Quando a vida chega a zero, o valor é substituído por uma caveira.
- Quando o próprio jogador chega a zero PV, a tela fica escurecida com caveira central e texto `você morreu`.
- PV temporário zerado remove o efeito visual de PV temporário da ficha.
