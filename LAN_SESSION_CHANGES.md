# Sessao LAN - melhorias aplicadas

## Entrada de jogadores

- A tela `Sessao LAN` agora tem a acao de jogador `ENTRAR EM SESSAO EXISTENTE`.
- A tela de entrada do jogador possui scanner de QR com `expo-camera`.
- Ao escolher/criar uma ficha, o jogador tenta avisar o mestre via `POST /join` usando a URL LAN do QR.
- Quando a entrada chega ao mestre, o jogador e salvo em `lan_session_players`, o payload da mesa e sincronizado e um evento `player_joined` e registrado.
- O mestre agora consulta jogadores e eventos pelo `joinUrl` ativo, entao jogadores aparecem no painel sem depender do fallback local.

## Relay LAN para Expo

Foi criado um relay local em Node para ambientes onde o modulo nativo `LanSessionModule` nao existe. Ele funciona como o ponto LAN da mesa:

```bash
npm run lan-relay
```

Depois, em outro terminal:

```bash
npx expo start
```

Com o relay ligado, o QR passa a carregar uma URL real da rede:

```text
http://192.168.x.x:43116/session/lan_...
```

Se o IP automatico do Expo nao bater com o IP da sua rede, inicie o app com:

```bash
EXPO_PUBLIC_LAN_RELAY_URL=http://SEU_IP_NA_REDE:43116 npx expo start
```

O fallback com dados embutidos no QR continua existindo, mas ele e apenas copia local. Para o jogador aparecer no mestre, use o relay ou um build nativo com servidor LAN real.

## Banco de dados

Foram adicionados campos estruturados para evitar depender apenas de texto livre:

- `items.effect_json`
- `items.duration_value`
- `items.duration_unit`
- `spells.effect_json`
- `spells.duration_value`
- `spells.duration_unit`
- `lan_session_players.temp_hp`
- `lan_session_players.pending_character_snapshot`

As migracoes tambem foram adicionadas para bancos ja existentes.

## Personagem vinculado a sessao

- Ao entrar em uma sessao com uma ficha, o app salva o vinculo dessa ficha com a sessao.
- Se o jogador sair e escanear a mesma sessao de novo, ele entra direto com a ficha vinculada.
- A tela inicial mostra o vinculo como `nome - sessao nome_da_sessao`.
- Personagens vinculados a outra sessao ficam ocultos na selecao de entrada por QR.
- Para reutilizar uma ficha em outra sessao, segure o card na tela inicial e use `Desvincular da Sessao`.
- O mestre pode usar `Kick` no card do jogador. Na proxima entrada, o jogador volta a poder selecionar/criar ficha para aquela sessao.

## Revisao de ficha ao retomar

- Quando um jogador volta por uma sessao pausada com a ficha local alterada, o mestre recebe uma pendencia no card do jogador.
- A pendencia mostra diferencas como HP, XP, moedas, atributos e inventario.
- `Aceitar ficha` atualiza o estado da sessao com a ficha local do jogador.
- `Manter sessao` descarta a alteracao local e preserva o estado anterior da mesa.
- O payload da sessao e reenviado ao relay sempre que o mestre aceita, recusa, aplica efeitos, muda HP/moedas ou avanca o tempo.
- Alteracoes feitas pelo mestre durante a sessao ativa nao geram pendencia de revisao.

## Painel do mestre

- Cards de jogadores foram compactados para mostrar HP, XP, moedas e quantidade de efeitos.
- `Mais info` abre atributos, inventario, moedas detalhadas, XP e efeitos ativos.
- O mestre pode distribuir um valor de XP para toda a party de uma vez.
- A aplicacao de efeitos agora parte de magias/skills e itens cadastrados na base, com ajuste manual de alvo, valor e duracao antes de aplicar.
- Buffs/efeitos enviados por jogadores aparecem no historico do mestre com opcoes de aceitar ou recusar.

## Rolagem na sessao

- Ao usar uma magia na sessao e tocar em `Rolar virtual`, o app dispara o componente de dado correspondente a formula, por exemplo `2d8`.
- Em efeitos de jogador como `Visao no Escuro`, o log do mestre registra que o jogador usou a magia/efeito.

## Criador do mestre

- Magias/skills agora salvam os efeitos em `effect_json`.
- Magias/skills agora salvam duracao estruturada em `duration_value` e `duration_unit`.
- Itens agora salvam efeitos em `effect_json`.
- Itens com efeitos temporarios salvam duracao estruturada quando informado.
- O criador de item agora aceita `PV_TEMP` para efeitos de vida temporaria.

## Efeitos da sessao

- Efeitos de atributos, PV temporario, HP e customizados usam uma estrutura comum em `effects_json`.
- Ao avancar turno, minuto, hora, descanso curto ou descanso longo, a sessao reduz a duracao dos efeitos ativos.
- Quando um efeito chega a zero, ele e removido e um evento `effect_expired` e registrado.
- O mestre ve o historico da sessao com entradas e efeitos encerrados.
- PV temporario e mostrado no painel do mestre e removido quando o efeito associado expira.

## Fluxo esperado

1. O mestre abre `Sessao LAN`.
2. O mestre toca em `INICIAR SESSAO LAN`.
3. O QR deve exibir uma URL LAN ativa.
4. O jogador abre `Sessao LAN` e toca em `ENTRAR EM SESSAO EXISTENTE`.
5. O jogador escaneia o QR, escolhe/cria a ficha e entra.
6. A ficha aparece no painel do mestre quando o `POST /join` chega ao servidor LAN.
7. O mestre aplica efeitos ou recebe efeitos enviados por jogadores.
8. Ao avancar o tempo da sessao, efeitos expirados aparecem no historico.
