# Correção — Fluxo Jogador/Ficha na Sessão LAN

## Problema observado

Ao entrar como jogador na sessão LAN, o aparelho enviava `HELLO` com `characterId: null`. Com isso, o mestre via o jogador conectado, mas sem ficha vinculada, e o fluxo não deixava claro que o jogador precisava escolher/criar a ficha da mesa antes de jogar.

Também havia um problema de UX: mesmo com uma sessão aberta, a tela continuava exibindo as opções de criar mesa LAN e entrar em mesa existente abaixo da sessão ativa.

## Ajustes aplicados

### 1. Jogador precisa vincular/criar ficha antes de jogar

Na tela `Sessão LAN`, quando o aparelho está como jogador:

- Se a sessão ainda não recebeu `WELCOME` do mestre, aparece apenas o aviso de aguardando regras da mesa.
- Se o mestre permite ficha existente, o jogador escolhe uma ficha local.
- Ao escolher a ficha, ela é vinculada à sessão, sincronizada com o mestre e a tela abre diretamente a ficha.
- Se o mestre não permite ficha existente, o jogador recebe a orientação para criar uma ficha nova.
- Ao criar a ficha pelo `create.tsx`, ela é vinculada, sincronizada e aberta automaticamente.

### 2. Ficha vinculada fica fixa para aquela sessão

Quando o jogador já possui uma ficha vinculada na sessão, a tela mostra um card `Minha ficha na sessão`, com botão para abrir a ficha.

A tela não incentiva mais limpar/trocar ficha depois do vínculo, evitando confusão entre jogador, aparelho e personagem da mesa.

### 3. Mestre visualiza melhor os jogadores nas ferramentas

Nas ferramentas rápidas do mestre, os jogadores aparecem como cards com:

- nome do jogador;
- ficha vinculada ou aviso de aguardando ficha;
- status conectado/desconectado;
- seleção do alvo para dano, cura, XP e moedas.

Jogadores sem ficha vinculada aparecem desabilitados para ações de mestre.

### 4. Menu inferior oculto durante sessão aberta

As opções:

- Criar mesa LAN;
- Entrar em mesa existente;
- Tracer / Debug LAN;

não aparecem mais abaixo de uma sessão aberta/conectada.

A central de opções só volta a aparecer quando não existe sessão ativa ou quando a sessão está pausada.

### 5. Eventos de HELLO não duplicam histórico sem necessidade

O mestre agora diferencia:

- primeiro `HELLO`: jogador entrou na sessão;
- novo `HELLO` com ficha: jogador vinculou ficha;
- `HELLO` repetido sem mudança de ficha: não gera evento duplicado desnecessário.

Isso reduz ruído no histórico e no tracer.

## Arquivos alterados

- `src/app/lan-session.tsx`
- `src/app/lan-player-join.tsx`
- `src/contexts/LanSessionContext.tsx`
