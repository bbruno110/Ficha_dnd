# LAN v91 — card público compacto, modal de efeitos e runtime vivo em escala

## Problema corrigido

Testes com mestre/jogador mostraram que, ao aplicar muitos efeitos/condições e PV temporário, o card público podia divergir da ficha privada e o texto de efeitos/vida escapava do card. Também havia reloads SQLite concorrendo com eventos vivos, o que ficaria pior em mesas com 5, 10 ou dezenas de aparelhos.

## Ajustes principais

- O card público da ficha do jogador agora é atualizado pela mesma projeção viva usada pela ficha privada.
- `effect_patch` atualiza imediatamente os efeitos públicos do próprio jogador, sem esperar snapshot.
- `player_patch`/`effect_patch` continuam sendo a fonte autoritativa de HP, HP máximo, PV temporário, XP e efeitos.
- O resumo de efeitos no card fica compacto: `Sangramento, Cego...mais`.
- Ao tocar no jogador/card com efeitos, abre um modal rolável com todos os efeitos públicos.
- O modal se atualiza em tempo real enquanto efeitos aparecem ou somem.
- O mestre também ganhou modal rolável de efeitos no painel dos jogadores, com remoção pela lixeira dentro do modal.
- `reloadSessionState` agora descarta resultados iniciados antes de um evento vivo, impedindo snapshot antigo de sobrescrever runtime novo.
- O cooldown de reload SQLite do mestre subiu para 9s, reduzindo gargalo em mesas com muitos jogadores.
- `syncLanSessionPayload` silencioso não aplica payload durante lock vivo, evitando flicker entre card/ficha.

## Escala

Para produção com muitos aparelhos, a UI não renderiza mais a lista completa de efeitos dentro do card. O card exibe só resumo curto, e a lista completa fica sob demanda no modal. Isso reduz layout quebrado, recomposição visual e custo de renderização em cada evento.

## Arquivos alterados

- `src/app/lan-session.tsx`
- `src/app/sheet.tsx`
- `docs/LAN_V91_PUBLIC_CARD_EFFECT_MODAL_SCALE_FIX.md`
