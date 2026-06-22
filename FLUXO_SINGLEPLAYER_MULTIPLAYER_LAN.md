# Fluxos Singleplayer, Mestre e Multiplayer LAN

Este documento descreve os fluxos principais do app Ficha D&D: uso singleplayer, ferramentas do mestre, uso multiplayer LAN, permissões de cada papel e o funcionamento geral do sistema de sincronização.

## 1. Fluxo Singleplayer

O modo singleplayer é o uso normal da ficha, sem sessão LAN ativa vinculada ao personagem.

### O que o jogador faz

1. Cria uma ficha em `Criar`.
2. Abre a ficha pela lista principal.
3. Edita atributos, vida, XP, moedas, inventário, equipamentos, magias, proficiências e demais dados locais.
4. Usa a ficha como fonte principal da verdade no próprio aparelho.

### O que é permitido

- Alterar HP, HP temporário, XP e moedas diretamente.
- Adicionar, remover, consumir, equipar e desequipar itens.
- Atualizar atributos, buffs e campos da ficha.
- Usar itens consumíveis.
- Gerenciar mochila e slots equipados.
- Subir de nível quando XP atinge o valor necessário.
- Acessar rolagem de dados e recursos locais da ficha.

### O que não acontece no singleplayer

- Não existe mestre autorizando ações.
- Não existe sincronização com outros aparelhos.
- Não há histórico LAN oficial.
- Não há painel de grupo com vida dos demais jogadores.
- A ficha não envia comandos `PLAYER_*` nem recebe eventos `MASTER_*`.

## 2. Ferramentas do Mestre

As ferramentas do mestre ficam disponíveis quando o usuário cria ou retoma uma sessão LAN como mestre/host.

### Criar mesa LAN

O mestre configura:

- Nome da sessão.
- Se conteúdo customizado será sincronizado.
- Quais conteúdos customizados entram na mesa.
- Se jogadores podem usar fichas existentes ou precisam criar fichas novas.
- Opcionalmente, uma ficha vinculada ao próprio mestre.

Ao iniciar, o app:

- Gera um código/QR Code da sessão.
- Abre o servidor LAN na porta configurada.
- Salva a sessão localmente.
- Exibe a tela `Sessão LAN` como painel da mesa.

### Controle da sessão

O mestre pode:

- Pausar sessão.
- Retomar sessão pausada.
- Encerrar sessão.
- Ver jogadores conectados e desconectados.
- Ver quais jogadores já vincularam ficha.
- Acompanhar histórico oficial da mesa.

### Ferramentas rápidas de mesa

O mestre pode aplicar ações nos jogadores vinculados:

- Dano.
- Cura.
- HP temporário.
- XP.
- Moedas.
- Alterações de atributo/buff.
- Itens.
- Efeitos.
- Remoção de efeitos.

Também pode controlar tempo de campanha:

- Avançar turno.
- Avançar minutos.
- Avançar horas.
- Aplicar descanso curto.
- Aplicar descanso longo.

### Solicitações pendentes

Quando um jogador tenta fazer algo que precisa de autoridade do mestre, a ação vira solicitação.

O mestre pode aprovar:

- Pedido de HP vira `MASTER_APPLY_HP`.
- Pedido de XP vira `MASTER_APPLY_XP`.
- Pedido de moedas vira `MASTER_APPLY_COINS`.
- Pedido de atributo/buff vira `MASTER_APPLY_ATTRIBUTE`.
- Pedido de aumento de item vira `MASTER_APPLY_ITEM`.

O mestre pode recusar:

- A recusa gera `COMMAND_REJECTED`.
- A ação não altera a ficha do jogador.

### O que o mestre pode fazer

- Criar, pausar, retomar e encerrar a mesa.
- Autorizar ou recusar solicitações.
- Aplicar mudanças diretamente nas fichas vinculadas.
- Distribuir itens e efeitos.
- Avançar tempo, turnos e descansos.
- Ver cards dos jogadores, status de conexão e ficha vinculada.
- Manter o histórico oficial da sessão.

### O que o mestre não deve fazer

- Aplicar ações em jogador sem ficha vinculada.
- Tratar sessão pausada como encerrada.
- Desvincular fichas apenas por pausa.
- Encerrar host imediatamente sem tentar avisar jogadores sobre o encerramento.

## 3. Fluxo Multiplayer LAN

O multiplayer usa uma sessão LAN local. O mestre atua como host autoritativo, e os jogadores conectam usando código ou QR Code.

### Papel do mestre

1. Cria a mesa LAN.
2. Compartilha código ou QR Code.
3. Aguarda jogadores entrarem.
4. Vê cada jogador conectado.
5. Aguarda cada jogador vincular ou criar uma ficha.
6. Usa ferramentas da sessão para conduzir a mesa.
7. Aprova ou recusa solicitações.
8. Pausa, retoma ou encerra a sessão quando necessário.

### Papel do jogador

1. Entra em `Sessão LAN`.
2. Escolhe `Entrar em mesa existente`.
3. Informa código ou escaneia QR Code.
4. Conecta ao host.
5. Vincula uma ficha existente, se o mestre permitir.
6. Ou cria uma nova ficha para aquela mesa, se o mestre exigir.
7. Abre a ficha vinculada.
8. Joga pela ficha em modo multiplayer.

### Vínculo da ficha

- A ficha vinculada fica presa àquela sessão naquele aparelho.
- O vínculo não deve ser trocado durante a mesa.
- A ficha só é desvinculada quando a sessão é encerrada.
- Se a sessão estiver pausada, a ficha continua vinculada e abre em modo multiplayer de leitura.

## 4. O Que o Jogador Pode Fazer no Multiplayer

Com sessão ativa e não pausada, o jogador pode:

- Abrir a ficha vinculada.
- Ver painel `Sessão LAN` na ficha.
- Ver a própria vida e nível.
- Ver vida e nível dos demais jogadores.
- Ver os próprios efeitos ativos.
- Enviar solicitações ao mestre.
- Oferecer troca de item para outro jogador.
- Recusar proposta de troca.
- Responder contraproposta de troca.
- Sincronizar alterações permitidas da ficha com o mestre.

### Ações que viram solicitação

O jogador não aplica diretamente:

- Dano.
- Cura.
- XP.
- Moedas.
- Buffs/atributos temporários.
- Aumento de quantidade de item quando isso exige validação.

Essas ações geram comandos `PLAYER_REQUEST_*` e aguardam aprovação do mestre.

### Inventário e trocas

O jogador pode:

- Oferecer item a outro jogador.
- Fazer contraproposta.
- Confirmar troca quando houver contraproposta.
- Recusar troca.
- Doar item quando permitido pelo fluxo da mesa.
- Registrar ações de inventário que serão sincronizadas como eventos oficiais.

### Tela da ficha no multiplayer

A ficha mostra:

- Badge `LAN` quando está vinculada e ativa.
- Badge `PAUSADA` quando a mesa está pausada.
- Painel de grupo na aba Status.
- Vida dos participantes.
- Nível dos participantes.
- Efeitos próprios.
- Avisos de morte quando HP chega a zero.

## 5. O Que o Jogador Não Pode Fazer no Multiplayer

O jogador não pode:

- Alterar livremente HP, XP, moedas e buffs como no singleplayer.
- Aplicar dano ou cura direto sem passar pelo mestre.
- Alterar ficha vinculada enquanto a sessão está pausada.
- Trocar a ficha vinculada livremente depois de entrar na mesa.
- Continuar vinculado depois que a sessão foi encerrada.
- Enviar comandos de jogo quando a sessão está pausada.

Durante pausa:

- A ficha abre em modo multiplayer.
- A ficha fica em leitura.
- O app mantém comunicação/polling quando possível.
- O jogador aguarda o host retomar ou encerrar.

## 6. Pausar, Retomar e Encerrar Sessão

### Sessão pausada

Pausa não é encerramento.

Quando a sessão está pausada:

- O status da mesa vira `paused`.
- A ficha vinculada continua vinculada.
- O jogador ainda pode abrir a ficha.
- A ficha abre em modo leitura.
- O jogador tenta manter comunicação com o host.
- O jogador aguarda `SESSION_RESUMED` ou `SESSION_CLOSED`.
- O mestre pode retomar ou encerrar.

Comandos permitidos durante pausa:

- `MASTER_RESUME_SESSION`
- `MASTER_END_SESSION`

Outros comandos de jogo são rejeitados enquanto a mesa está pausada.

### Sessão retomada

Quando o mestre retoma:

- O mestre reabre ou mantém o host LAN.
- A sessão volta para `open` no mestre.
- O jogador recebe estado retomado e volta para `connected`.
- A ficha sai do modo leitura.
- Polling e sincronização continuam.

### Sessão encerrada

Encerramento é definitivo para aquela sessão.

Quando o mestre encerra:

- É emitido `SESSION_CLOSED`.
- A sessão local vira `closed`.
- A ficha vinculada é desvinculada.
- O jogador sai da sessão ativa.
- O host pode permanecer aberto por alguns instantes para avisar jogadores.
- Depois de entregar o encerramento, o host temporário fecha.

Somente o encerramento deve limpar `linked_character_id`.

## 7. Sistema Multiplayer LAN

### Visão geral

O sistema LAN é autoritativo pelo mestre:

- Mestre é o host.
- Jogadores são clientes.
- Jogadores enviam comandos e snapshots.
- Mestre valida, aplica e emite eventos oficiais.
- Jogadores recebem eventos e snapshots para atualizar a UI local.

### Dados locais importantes

O app mantém tabelas locais para:

- Identidade do aparelho (`deviceId`).
- Sessões LAN.
- Estado da sessão.
- Jogadores da sessão.
- Snapshots de fichas.
- Histórico de eventos oficiais.
- Logs/tracer de debug.

### Status de sessão

Os status principais são:

- `open`: mesa aberta no mestre.
- `connected`: jogador conectado à mesa.
- `paused`: mesa pausada, vínculo preservado.
- `inactive`: sessão local inativa, sem conexão atual.
- `closed`: sessão encerrada, vínculo removido.

### Comunicação

O sistema usa RPC LAN entre jogador e mestre.

Métodos principais:

- `DISCOVER`: localizar mestre/código.
- `JOIN`: jogador entra na mesa.
- `POLL`: jogador pede eventos novos e estado atual.
- `COMMAND`: jogador ou mestre envia comando.
- `CHARACTER_UPSERT`: sincroniza snapshot de ficha.
- `LEAVE`: jogador informa saída local.

### Eventos oficiais

O mestre transforma comandos em eventos oficiais.

Exemplos:

- `SESSION_STARTED`
- `SESSION_PAUSED`
- `SESSION_RESUMED`
- `SESSION_CLOSED`
- `PLAYER_JOINED`
- `PLAYER_REQUESTED`
- `COMMAND_REJECTED`
- `HP_CHANGED`
- `XP_CHANGED`
- `COINS_CHANGED`
- `ATTRIBUTE_CHANGED`
- `ITEM_ADDED`
- `ITEM_REMOVED`
- `ITEM_TRANSFERRED`
- `ITEM_CONSUMED`
- `ITEM_EQUIPPED`
- `ITEM_UNEQUIPPED`
- `TRADE_OFFERED`
- `TRADE_COUNTERED`
- `TRADE_ACCEPTED`
- `TRADE_DECLINED`
- `EFFECT_APPLIED`
- `EFFECT_EXPIRED`
- `SNAPSHOT_SYNCED`

### Sincronização

O jogador envia:

- `deviceId`
- Nome local do jogador
- Ficha vinculada
- Snapshot da ficha
- Último evento conhecido (`sinceSeq`)

O mestre responde com:

- Estado da sessão.
- Lista de jogadores.
- Eventos recentes ou faltantes.
- Snapshots.
- Conteúdo customizado, quando configurado.

### Reconexão

O app tenta recuperar sessão quando:

- Volta do background.
- O aparelho desbloqueia.
- O polling falha.
- O jogador reabre a ficha vinculada.

No jogador:

- Se a sessão está pausada, ele continua tentando receber sinal do host.
- Se o host retoma, recebe `SESSION_RESUMED`.
- Se o host encerra, recebe `SESSION_CLOSED` e desvincula.

No mestre:

- Sessão pausada não retoma automaticamente como host ativo.
- O mestre precisa retomar manualmente.
- Sessão encerrada abre host temporário apenas para avisar jogadores.

## 8. Regras de Autoridade

### Fonte da verdade

- Singleplayer: ficha local é fonte da verdade.
- Multiplayer: mestre e eventos oficiais são fonte da verdade.

### Regra de ouro

Jogador pode pedir, mestre decide.

Exceções são ações de UI/sincronização que não alteram autoridade da mesa, como abrir ficha, visualizar grupo, receber eventos e manter vínculo durante pausa.

### Quando aplicar localmente

O jogador só altera a própria ficha local quando:

- A ação é permitida no fluxo multiplayer.
- O evento oficial recebido é direcionado ao dispositivo/ficha dele.
- A mesa não está pausada.
- A sessão não está encerrada.

### Quando não aplicar localmente

Não aplicar mudança direta se:

- A mesa está pausada.
- A ação exige aprovação do mestre.
- O evento é para outro dispositivo.
- A sessão foi encerrada.
- A ficha não é a vinculada da sessão.

## 9. Resumo Rápido

Singleplayer:

- Livre, local, sem mestre.

Mestre multiplayer:

- Cria mesa, autoriza ações, aplica mudanças, controla tempo e encerra.

Jogador multiplayer:

- Usa ficha vinculada, solicita mudanças, vê grupo e aguarda eventos oficiais.

Pausa:

- Mantém vínculo.
- Ficha abre em leitura.
- Aguarda retomar ou encerrar.

Encerramento:

- Emite `SESSION_CLOSED`.
- Desvincula ficha.
- Remove sessão ativa do jogador.
