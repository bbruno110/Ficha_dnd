# Ajustes LAN e UI

## Sessão LAN

- A entrada da home agora se chama **Sessão LAN**.
- A rota `/lan-session` mantém o nome visual **Sessão LAN**, não “Administração LAN”.
- Navegação para a tela LAN usa trava curta e `router.navigate`, evitando empilhar a mesma tela duas vezes por toque duplicado.
- Os cards internos de criar mesa, entrar como jogador e tracer também usam trava curta de navegação.

## Moedas

- O layout de moedas da tela LAN foi separado em bloco próprio com campos PO/PP/PC e botão de aplicar em linha separada.
- Isso evita quebra/espremimento visual em telas menores.

## Itens consumíveis

- Removida a opção duplicada **Usar efeito** do modal de item da mochila.
- Para item consumível, a ação correta agora é **Consumir**.
- A lógica interna de aplicar efeito ao consumir permanece, mas sem exibir duas opções equivalentes para o usuário.

## Campos numéricos

- Campos numéricos agora usam `selectTextOnFocus`, permitindo substituir o valor atual ao digitar, sem precisar apagar o `0` antes.
- Campos numéricos relevantes foram centralizados para manter o alinhamento mesmo quando ficam vazios.

## Sincronização duplicada

- O consumo de item foi consolidado em uma única atualização de banco quando remove quantidade do inventário e aplica efeitos na ficha.
- Antes, esse fluxo podia gerar duas atualizações quase simultâneas e dois broadcasts LAN no tracer.
