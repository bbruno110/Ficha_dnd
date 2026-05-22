# Multiplayer LAN TCP - D&D

Este documento resume a atualizacao da sessao LAN, o que mudou no banco/efeitos e como rodar o app com multiplayer local em tempo real.

## Resumo

A sessao LAN nova agora usa socket TCP local, com o app do mestre como host oficial da mesa.

```text
Mestre abre a sessao
-> app cria um servidor TCP no celular do mestre
-> QR gera uma URL tcp://IP_DA_REDE:43115/lan_...
-> jogadores conectam nessa URL pela mesma rede Wi-Fi
-> mestre e jogadores trocam mensagens persistentes por socket
```

O fluxo novo nao depende de HTTP polling para sessoes novas. O caminho HTTP/relay antigo ficou apenas como compatibilidade para links antigos.

## Arquivos principais

- `src/services/lanTcpTransport.ts`: servidor TCP do mestre e cliente TCP dos jogadores.
- `src/services/lanSession.ts`: integra TCP com sessao LAN, eventos, join, payload e persistencia.
- `src/app/lan-session.tsx`: tela do mestre, inicio/retomada da sessao e alerta de build sem TCP.
- `src/app/sessionJoin.tsx`: entrada do jogador por QR/manual, agora aceitando `tcp://`.
- `src/database/migration_dnd_v2.ts`: migracao v2 para efeitos, condicoes, eventos com `seq`, pedidos e trocas.
- `LAN_SESSION_CHANGES.md`: changelog tecnico da atualizacao.

## Dependencias adicionadas

- `react-native-tcp-socket`: socket TCP nativo.
- `expo-network`: leitura do IP local do aparelho host.

Essas dependencias ja estao no `package.json`. Em uma instalacao limpa, rode:

```bash
npm install
```

## Importante sobre Expo Go

Socket TCP precisa de modulo nativo. Por isso, o multiplayer TCP nao funciona no Expo Go.

Use uma destas opcoes:

- Dev build local: `npx expo run:android`
- Build de desenvolvimento EAS: `eas build --profile development --platform android`
- Build nativo instalado no aparelho

Se rodar no Expo Go, a tela pode criar a sessao localmente, mas vai avisar que o socket TCP esta indisponivel. Isso evita o problema de ficar preso indefinidamente em `INICIANDO...`.

## Como rodar em desenvolvimento local

1. Instale as dependencias:

```bash
npm install
```

2. Conecte um aparelho Android por USB ou deixe o emulador pronto:

```bash
adb devices
```

3. Gere e instale o dev build nativo:

```bash
npx expo run:android
```

4. Abra o app no celular do mestre.

5. Garanta que mestre e jogadores estao na mesma rede Wi-Fi.

6. No celular do mestre:

```text
Sessao LAN -> configurar mesa -> INICIAR SESSAO LAN
```

7. O QR/convite deve conter uma URL neste formato:

```text
tcp://192.168.x.x:43115/lan_...
```

8. No celular do jogador:

```text
Sessao LAN -> ENTRAR EM SESSAO EXISTENTE -> escanear QR
```

9. O jogador escolhe/cria a ficha. O mestre deve ver a ficha aparecer no painel da sessao.

## Como rodar em dois aparelhos

Para teste real, instale o mesmo dev/native build em todos os aparelhos.

```bash
npx expo run:android
```

Depois, mantenha todos na mesma rede Wi-Fi. O celular do mestre precisa continuar com o app aberto durante a sessao, porque ele e o host TCP.

Se o Android ou Windows pedir permissao de rede/firewall durante testes, permita acesso na rede privada/local.

## Protocolo TCP

O protocolo envia JSON por linha, separado por `\n`.

Mensagens usadas:

- `hello`: jogador solicita snapshot atual.
- `session_snapshot`: mestre envia catalogo, jogadores, estado e historico recente.
- `join`: jogador envia ficha para entrar na mesa.
- `event`: jogador ou mestre envia evento da sessao.
- `payload_update`: mestre publica estado atualizado para clientes conectados.

Exemplo de URL:

```text
tcp://192.168.0.25:43115/lan_abcd1234
```

Porta padrao:

```text
43115
```

## Banco e efeitos

A migracao v2 prepara o banco para efeitos e sessao LAN mais robustos:

- `effect_json` em magias, itens e bases customizadas quando aplicavel.
- `lan_effect_catalog` com condicoes/status, regras, icones, cores e prioridade visual.
- `active_effects_json` e `temp_hp` nos personagens.
- eventos LAN com `seq`, origem, destino, `client_msg_id` e status de processamento.
- tabelas para pedidos pendentes e trocas entre jogadores.
- metadados de transporte em `lan_sessions`, incluindo modo, host, porta e versao de protocolo.

## Ferramentas do mestre

O mestre pode usar o painel da sessao para:

- iniciar/retomar/pausar/finalizar mesa;
- aceitar jogadores;
- aplicar HP, XP e moedas;
- aplicar efeitos vindos de magias, habilidades ou itens cadastrados;
- acompanhar efeitos ativos e expiracao por turno/tempo/descanso;
- receber eventos enviados por jogadores;
- registrar historico oficial da sessao.

Sobre condicoes, testes de resistencia e concentracao:

- O banco e o protocolo ja aceitam efeitos estruturados via `effect_json`.
- Condicoes podem ser representadas pelo catalogo LAN e aplicadas como efeitos/status.
- Testes de resistencia e concentracao podem ser descritos nas regras do efeito/catalogo.
- A automacao completa depende da UI expor esses campos e do fluxo de combate aplicar essas regras. Se o controle nao aparecer na tela do criador, a base ja esta preparada, mas ainda falta o componente visual correspondente.

## Solucao de problemas

### Fica muito tempo em `INICIANDO...`

Agora o start tem timeout. Se nao abrir o TCP, a tela deve mostrar alerta de socket indisponivel.

Causas comuns:

- voce esta usando Expo Go;
- build nativo nao foi regenerado depois de instalar `react-native-tcp-socket`;
- celular sem IP Wi-Fi valido;
- modulo nativo nao foi linkado no build instalado.

Solucao:

```bash
npx expo run:android
```

Depois abra novamente a sessao LAN.

### QR nao mostra `tcp://`

A sessao nao conseguiu abrir o servidor TCP.

Confira:

- app em dev/native build;
- aparelho do mestre conectado ao Wi-Fi;
- build reinstalado depois do `npm install`;
- sem outro processo usando a porta `43115`.

### Jogador nao aparece no mestre

Confira:

- os dois aparelhos estao na mesma rede Wi-Fi;
- o QR tem `tcp://IP:43115/lan_...`;
- o app do mestre continua aberto;
- nao ha isolamento de clientes no roteador;
- firewall/rede privada nao bloqueou conexoes locais.

### Funciona no mestre, mas jogador nao conecta

Alguns roteadores bloqueiam comunicacao entre celulares na mesma rede, especialmente rede de convidados. Use a rede principal ou desative isolamento/AP isolation.

## Verificacoes feitas

Depois da implementacao:

```bash
npx tsc --noEmit
npm run lint
```

Resultado:

- TypeScript passou.
- Lint passou sem erros, mantendo apenas avisos antigos ja existentes no projeto.

## Comandos uteis

Rodar app em dev build Android:

```bash
npx expo run:android
```

Iniciar Metro:

```bash
npx expo start
```

Checar TypeScript:

```bash
npx tsc --noEmit
```

Rodar lint:

```bash
npm run lint
```

Build Android de desenvolvimento via EAS:

```bash
eas build --profile development --platform android
```

## Estado atual

O multiplayer local foi migrado para socket TCP para sessoes novas. O mestre e o host da mesa, jogadores entram via `tcp://`, e os dados da sessao sao sincronizados por conexao persistente.

O proximo passo natural e completar a UI avancada para criar efeitos mecanicos mais ricos, como resistencia automatica, CD, atributo do teste, concentracao e condicoes predefinidas diretamente no criador.
