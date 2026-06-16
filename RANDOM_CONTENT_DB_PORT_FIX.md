# Correção — conteúdo aleatório do create.tsx no banco

## Objetivo

Garantir que os textos usados pelo gerador aleatório de personagem não fiquem fixos dentro de `src/app/create.tsx`.

O conteúdo de nomes, títulos, arquétipos, histórias, traços, ideais, vínculos, defeitos, aliados, características extras, idiomas/proficiências extras, conectores de história por classe e regras de idioma por raça agora é lido do SQLite.

## Tabelas usadas

- `random_name_parts`
  - nomes masculinos;
  - nomes femininos;
  - títulos genéricos;
  - títulos por classe;
  - variação por gênero.

- `random_lore_archetypes`
  - arquétipo narrativo;
  - classes permitidas para aquele arquétipo.

- `random_lore_entries`
  - `traits`;
  - `ideals`;
  - `bonds`;
  - `flaws`;
  - `backstory`;
  - `allies`;
  - `features`;
  - `extraLanguages`.

- `random_lore_connectors`
  - frases que conectam a história sorteada com a classe escolhida.
  - exemplo: `O destino e a dureza da vida acabaram forjando minhas habilidades como {classe}.`

- `random_race_language_rules`
  - idioma base por raça.
  - exemplo: `Elfo -> Comum, Élfico`.

- `bg3_companions`
  - recebeu as colunas `languages` e `origin_traits` para remover o dicionário fixo que estava no `create.tsx`.

## Arquivos alterados

- `src/app/create.tsx`
- `src/database/init.ts`
- `src/database/randomContentSeed.ts`

## Observação importante

Se o app já estava instalado no celular com banco antigo, o `initDatabase` cria as novas tabelas e roda o seed com `INSERT OR IGNORE`.

Se algum conteúdo base antigo já estiver diferente no banco local, o app preserva dados existentes e só adiciona o que estiver faltando.
