# Ajustes — Conteúdo Aleatório no Banco e Bônus por Nível

## 1. create.tsx sem listas fixas de nomes/histórias

A tela `src/app/create.tsx` não mantém mais arrays fixos de nomes aleatórios, títulos, arquétipos, traços, ideais, vínculos, defeitos, histórias, aliados e idiomas.

Agora a geração aleatória consulta o SQLite nas tabelas:

- `random_name_parts`
- `random_lore_archetypes`
- `random_lore_entries`

O seed inicial desses dados fica concentrado em `src/database/randomContentSeed.ts`, chamado pelo `initializeDatabase`, para popular o banco quando o app inicia.

## 2. Novas tabelas SQLite

Foram adicionadas as tabelas:

```sql
random_lore_archetypes
random_lore_entries
random_name_parts
```

Também foram adicionadas as colunas abaixo em `bg3_companions`:

```sql
languages
origin_traits
```

Assim os textos extras dos companheiros BG3 também deixam de ficar dentro do `create.tsx`.

## 3. Ferramentas do Mestre — habilidades/bônus por nível

Na tela `src/app/advanced.tsx`, ao criar:

- Raça
- Classe
- Subclasse

as habilidades passivas, inatas e bônus agora são salvos com nível mínimo de liberação.

Formato salvo no campo `features`:

```json
[
  { "name": "Ataque Extra", "level_required": 5 },
  { "name": "Defesa Sem Armadura", "level_required": 1 }
]
```

O formato antigo continua compatível:

```json
["Defesa Sem Armadura", "Fúria"]
```

## 4. Criação e level up respeitam nível mínimo

A criação de personagem e o level up agora filtram as features pelo nível:

- `create.tsx`: personagem inicial recebe somente features de nível 1.
- `edit.tsx`: personagem recebe/libera features conforme o nível atual de cada classe/subclasse.

## 5. Magias/Truques por classe

A aba `Magia/Skill` já possuía seleção de classe + nível mínimo. Mantive esse comportamento e normalizei o campo de nível para aceitar apenas números positivos.

