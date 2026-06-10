# LAN v35 - XP por solicitação, level up autônomo e salvamento rápido

## Objetivo
Corrigir três regressões da v34:

1. Jogador não pode conceder XP diretamente a si mesmo.
2. Level up, depois que o XP oficial já foi recebido, pertence ao jogador e não deve virar revisão para o mestre.
3. O modal do mestre ao enviar XP não pode ficar preso em "SALVANDO...".

## Regras finais

### XP
- Jogador pede XP via `resource_request`.
- O mestre aceita ou recusa.
- Ao aceitar, o host aplica o XP no roster oficial e envia `player_patch` para o jogador.
- A ficha do jogador só muda o XP quando recebe o `player_patch` oficial.

### Level up
- Quando o jogador recebe XP oficial suficiente, a ficha abre a opção de subir de nível.
- O jogador salva o level up sem aprovação do mestre.
- O `reviewSnapshot` de level up é autoaceito pelo host quando:
  - o nível novo é maior que o anterior;
  - o XP conhecido autoriza o nível;
  - não há troca de raça, inventário ou moedas.

### Mestre enviando XP
- O modal fecha antes do broadcast/persistência completar.
- O patch de XP continua sendo enviado e persistido normalmente.
- Isso evita o botão ficar visualmente preso em "SALVANDO..." quando o SQLite/socket estiver lento.

## Arquivos alterados
- `src/app/sheet.tsx`
- `src/app/lan-session.tsx`
- `src/services/lanSession.ts`
