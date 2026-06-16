# Correção LAN — Cards por Jogador, Navegação e Sincronização da Ficha

## Problemas corrigidos

1. Ao iniciar uma mesa pela tela de Sessão LAN, a navegação podia empilhar/reabrir outra tela de Sessão LAN, exigindo vários `goBack()`.
2. Eventos do mestre como dano, cura, XP e moedas eram recebidos pelo jogador e gravados no banco, mas a ficha aberta não recarregava visualmente no momento certo.
3. A área de ações rápidas do mestre ainda estava genérica, com seleção de alvo separada, em vez de um card operacional por jogador.
4. O mestre não tinha uma visualização clara, por jogador, da vida, XP, moedas, atributos, itens da mochila e itens equipados.

## Ajustes implementados

### 1. Navegação sem empilhamento duplicado

As telas `lan-master-setup.tsx` e `lan-player-join.tsx` agora usam um retorno seguro para `/lan-session`:

- usa `router.dismissTo('/lan-session')` quando disponível;
- se não existir, usa `router.back()`;
- se não houver tela anterior, usa `router.replace('/lan-session')`.

Isso evita abrir várias instâncias de Sessão LAN na pilha de navegação.

### 2. Revisionamento LAN para forçar atualização visual

O contexto LAN agora mantém `lanRevision` e incrementa essa revisão quando:

- evento LAN oficial chega;
- snapshot de sessão chega;
- ficha é sincronizada;
- personagem é vinculado;
- cards do mestre recebem atualização de snapshot.

A ficha multiplayer recebe `externalRevision={lanRevision}` e recarrega os dados do SQLite quando a revisão muda.

### 3. Cards completos por jogador

A tela `lan-session.tsx` agora mostra cards verticais por jogador com:

- nome do jogador;
- nome da ficha vinculada;
- status conectado/desconectado;
- nível, raça e classe;
- vida atual/máxima com barra visual;
- XP;
- moedas PO/PP/PC;
- atributos FOR, DES, CON, INT, SAB e CAR;
- itens equipados no momento;
- prévia dos itens na mochila;
- botão para abrir a ficha;
- ações rápidas próprias daquele jogador.

### 4. Ações rápidas dentro do card do jogador

Cada card tem seu próprio campo de valor para:

- dano;
- cura;
- XP.

Também possui campos próprios para moedas:

- PO;
- PP;
- PC.

Assim o mestre não precisa selecionar um jogador em uma área separada. A ação já nasce vinculada ao card correto.

### 5. Sincronização de snapshot do jogador

Quando o mestre aplica dano/cura/XP/moedas, o evento oficial atualiza:

- o banco local do jogador, quando o alvo é o aparelho dele;
- o snapshot usado no card do mestre;
- a revisão LAN para a ficha aberta recarregar.

## Arquivos alterados

- `src/app/lan-session.tsx`
- `src/app/lan-master-setup.tsx`
- `src/app/lan-player-join.tsx`
- `src/contexts/LanSessionContext.tsx`

## Observação de teste

Os logs mostravam que `HP_CHANGED`, `XP_CHANGED` e `COINS_CHANGED` chegavam no jogador e geravam `UPDATE` no banco. O problema principal era a tela não reagir/recarregar corretamente ao evento recebido.
