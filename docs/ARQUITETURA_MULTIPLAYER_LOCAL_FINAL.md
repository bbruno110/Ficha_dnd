# Arquitetura final do multiplayer local

Objetivo: 1 celular Mestre atua como servidor LAN autoritativo e N celulares jogadores atuam como clientes.

## Separação de fluxos

### OFFLINE_SINGLEPLAYER
- A ficha lê e grava diretamente no SQLite local.
- Não existe joinUrl, sessionId remoto ou vínculo LAN ativo.
- Alterações de HP, XP, moedas, inventário, atributos e efeitos são locais.

### LAN_MASTER_AUTHORITATIVE
- O mestre é a autoridade final da sessão.
- Toda alteração viva da mesa vira evento versionado: `player_patch`, `effect_patch`, `inventory_patch`, `pending_save_patch`, `session_patch`, `session_ended`.
- A UI do mestre atualiza runtime primeiro, envia socket depois e persiste SQLite em segundo plano.
- Snapshot/payload é estrutural; não deve ser usado como mecanismo de tempo real para HP/efeitos/inventário.

### LAN_PLAYER_CLIENT
- O jogador recebe `event_commit` pelo socket e aplica imediatamente na UI.
- ACK é enviado logo após marcar o evento como aplicado.
- SQLite local é persistência em background, não bloqueia a UI.
- Jogador só altera diretamente recursos próprios permitidos: usar/equipar/dropar/enviar/trocar item próprio e converter/reduzir moeda própria.
- Aumentar/criar recurso pede aprovação do mestre.

## Ciclo de vida da sessão

### Pausar
- Campanha ainda não acabou.
- Sessão permanece ativa/retomável.
- Jogadores continuam vinculados.
- Fichas ficam somente leitura.
- Cliente continua ouvindo apenas eventos críticos: `session_patch`, `session_ended`, `player_kicked`.

### Continuar
- Sessão volta para `active`.
- Mesmos jogadores e vínculos são preservados.
- Clientes voltam a aceitar eventos vivos.

### Encerrar
- Campanha finalizada.
- Sessão vira `ended` e `active = 0`.
- Todos os vínculos locais da sessão são desativados.
- Jogadores voltam ao modo offline/singleplayer ou podem entrar em outra mesa.

## Rede

- Socket TCP persistente é caminho principal.
- Polling/resync é fallback, não mecanismo normal de gameplay.
- Payload/snapshot só carrega estrutura e status; nunca deve sobrescrever estado vivo.
- Eventos críticos têm prioridade na fila de envio.
- Logs de heartbeat, polling e SQLite devem ser mínimos durante gameplay.

## Regra de desempenho

Qualquer ação visível deve seguir:

1. Receber/criar evento.
2. Atualizar runtime/UI imediatamente.
3. Enviar socket/ACK.
4. Persistir SQLite em background.
5. Usar resync apenas se houver gap/reconexão.
