# LAN V44 - Runtime autoritativo rápido

Objetivo: corrigir atraso e perda de sincronia em ações rápidas de React Native/TypeScript.

## Problemas corrigidos

1. O jogador reduzia moedas rapidamente e a UI local ficava correta, mas o mestre recebia tarde.
2. Eventos antigos de moeda voltavam depois e podiam sobrescrever o estado mais novo.
3. Eventos `event_propose` eram tratados pelo transporte como commit e podiam ser reenviados/broadcast antes do host autorizar.
4. O mestre enviava item, atualizava localmente, mas o jogador podia ignorar o `inventory_patch` por revisão antiga.
5. Equipar/desequipar no jogador podia demorar para aparecer no mestre por depender do ciclo de poll/reload.

## Correções

- `event_propose` agora é apenas comando de entrada para o host. O transporte não faz broadcast como commit antes da validação.
- Moeda autônoma usa `opSeq` local monotônico. O host ignora comandos antigos e aplica apenas o estado mais novo.
- Redução/conversão de moeda atualiza o runtime do mestre imediatamente e persiste SQLite em segundo plano.
- O patch oficial de moeda contém somente `gp/sp/cp`, evitando que HP/PV/XP velhos sejam carregados junto.
- `inventory_patch` oficial usa revisão monotônica baseada no runtime e no SQLite, evitando que jogador ignore item enviado pelo mestre.
- Ao conceder item, `sessionStateRef` também é atualizado, não apenas o estado visual React.
- Checkpoints/replays frios não reenviam `coin_self_patch_request`, pois isso é comando transitório, não estado vivo.

## Regra de autoridade

- Jogador pode reduzir/converter moeda própria: autônomo.
- Jogador não pode aumentar moeda própria: segue para aprovação do mestre.
- Mestre continua podendo conceder moeda e item oficialmente.
- Equipar/desequipar item próprio é autônomo e deve refletir no mestre.
