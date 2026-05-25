# Sessao LAN - melhorias aplicadas

## Atualizacao SQL/LAN v2

- Foi adicionado `src/database/migration_dnd_v2.ts` com migracao idempotente para bancos ja instalados.
- `initializeDatabase(db)` agora liga `PRAGMA foreign_keys = ON` e executa `migrateDatabaseV2(db)` depois da criacao/seed base.
- A migracao cria e atualiza `lan_effect_catalog`, incluindo status, cores, icones, regras (`rules_json`), testes de remocao e prioridade visual.
- Foram adicionadas as tabelas `lan_session_pending_requests` e `lan_session_trades` para pedidos ao mestre e trocas entre jogadores.
- `lan_sessions` recebeu metadados de transporte e autoridade: `transport_mode`, `host_ip`, `host_port`, `protocol_version`, `current_seq` e `is_master`.
- `lan_session_events` recebeu `seq`, `from_key`, `to_key`, `client_msg_id` e `processed`; eventos salvos localmente agora recebem `seq` incremental.
- `lan_session_players` recebeu `character_name`, `is_active`, `is_connected`, `last_ack_seq`, `revision_seq` e `kicked_at`.
- `characters`, `races`, `classes` e `subclasses` receberam campos para `effect_json`/efeitos ativos quando aplicavel.
- Magias e itens base ganham exemplos de `effect_json` estruturado apenas quando o campo ainda esta vazio, sem sobrescrever conteudo customizado.

## Entrada de jogadores

- A tela `Sessao LAN` agora tem a acao de jogador `ENTRAR EM SESSAO EXISTENTE`.
- A tela de entrada do jogador possui scanner de QR com `expo-camera`.
- Ao escolher/criar uma ficha, o jogador avisa o mestre pelo socket TCP persistente da URL LAN do QR.
- Quando a entrada chega ao mestre, o jogador e salvo em `lan_session_players`, o payload da mesa e sincronizado e um evento `player_joined` e registrado.
- O mestre agora consulta jogadores e eventos pelo `joinUrl` ativo, entao jogadores aparecem no painel sem depender do fallback local.

## Multiplayer local por socket TCP

As sessoes novas usam transporte TCP local, com o app do mestre como host da mesa:

```text
tcp://192.168.x.x:43115/lan_...
```

O protocolo envia quadros JSON por linha (`\n`) em uma conexao persistente:

- `hello`: jogador solicita o snapshot atual da mesa.
- `session_snapshot`: mestre envia catalogo, jogadores, estado e historico recente.
- `join`: jogador envia ficha para aparecer no painel do mestre.
- `event`: jogador/mestre envia evento de sessao, magia, recurso, efeito ou inventario.
- `payload_update`: mestre publica o novo estado da mesa para os clientes conectados.

O transporte padrao de sessoes novas e TCP direto. O app nao usa mais HTTP/relay como fallback; se o build nao conseguir abrir `tcp://`, a sessao avisa que o socket nativo esta indisponivel.

Importante: socket TCP depende do modulo nativo `react-native-tcp-socket`. Use um dev build/native build (`npx expo run:android` ou EAS Development Build). O Expo Go nao embute esse modulo e, nesse ambiente, a tela mostra o alerta de socket indisponivel em vez de ficar presa em `INICIANDO...`.

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
- O payload da sessao e republicado pelo socket TCP sempre que o mestre aceita, recusa, aplica efeitos, muda HP/moedas ou avanca o tempo.
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
6. A ficha aparece no painel do mestre quando o quadro TCP `join` chega ao host LAN.
7. O mestre aplica efeitos ou recebe efeitos enviados por jogadores.
8. Ao avancar o tempo da sessao, efeitos expirados aparecem no historico.
