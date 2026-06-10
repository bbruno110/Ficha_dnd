# LAN v92 — Sincronização definitiva pós-level-up, efeitos em lote e modal de condições

## Objetivo

Corrigir a perda aparente de sincronização entre ficha privada do jogador e card público da sessão LAN, especialmente após level-up, troca de tela/reentrada e aplicação de muitos efeitos/condições.

## Correções principais

### 1. Ficha privada e card público passam a usar a mesma projeção viva

- O jogador projeta o próprio card público a partir do `characterRef` vivo.
- HP, HP máximo, PV temporário, XP, moedas, nível e efeitos públicos são sincronizados em uma única projeção.
- Payload/snapshot antigo não sobrescreve números vivos logo após um evento recente.
- Ao retornar para a ficha, a UI não depende mais de fechar/abrir para refletir o estado vivo.

### 2. Level-up não bloqueia em SQLite

- O mestre não consulta mais tabela de progressão durante o evento vivo de level-up.
- O patch de progressão é aplicado primeiro no runtime em memória.
- O mestre envia um `player_patch` autoritativo de eco para o jogador após aceitar o level-up.
- Esse eco confirma HP atual, HP máximo, PV temporário, XP e moedas, reduzindo a sensação de perda de conexão.

### 3. Efeitos/condições são aplicados em lote

- Ao aplicar várias condições de uma vez, o mestre envia um único `effect_patch` por jogador com todos os efeitos no array `add`.
- Isso reduz fan-out e evita filas longas em mesas com 5, 10 ou mais celulares.
- A persistência SQLite roda em background; a UI e o socket não esperam o banco para atualizar.

### 4. Modal de condições redesenhado

- Modal agora usa painel central compatível com o padrão visual do app.
- Fecha ao tocar fora ou no X.
- Lista rolável com nome, duração e origem do efeito.
- No mestre, cada efeito no modal mantém botão de lixeira.

### 5. Cards públicos compactos

- Cards exibem resumo: `Sangramento, Cego...mais`.
- A lista completa fica no modal.
- Evita texto e vida saindo do card quando há muitos efeitos.

## Arquivos alterados

- `src/app/sheet.tsx`
- `src/app/lan-session.tsx`
- `src/styles/globalStyles.ts`

## Validação local possível no sandbox

- Parser TypeScript nos arquivos alterados: OK.
- `npm run lint` completo não foi executado porque o ZIP não contém `node_modules`/Expo CLI no sandbox.

## Testes recomendados

1. Entrar na sessão como jogador.
2. Aplicar dano/cura rapidamente pelo mestre.
3. Aplicar 4–10 condições de uma vez.
4. Abrir modal de condições no jogador e no mestre.
5. Remover efeitos pela lixeira no mestre.
6. Avançar turno/hora e verificar remoção automática.
7. Distribuir XP, subir nível, voltar para a ficha e aplicar dano/cura sem reentrar na sessão.
8. Repetir level-up mais de uma vez.
