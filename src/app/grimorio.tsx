import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatEffectSummary } from '../types/effects';

type SectionKey = 'spells' | 'items' | 'races' | 'classes' | 'subclasses' | 'kits' | 'conditions';

type CatalogEntry = {
  id: string;
  numericId: number;
  section: SectionKey;
  name: string;
  subtitle: string;
  description?: string;
  creator: string;
  tags: string[];
  filterKeys: string[];
  searchText: string;
  raw: Record<string, any>;
  effects?: Record<string, any>[];
};

const SECTIONS: { key: SectionKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'spells', label: 'Magias/Skills', icon: 'sparkles-outline' },
  { key: 'items', label: 'Itens', icon: 'bag-outline' },
  { key: 'races', label: 'Raças', icon: 'people-outline' },
  { key: 'classes', label: 'Classes', icon: 'shield-half-outline' },
  { key: 'subclasses', label: 'Subclasses', icon: 'git-branch-outline' },
  { key: 'kits', label: 'Kits', icon: 'cube-outline' },
  { key: 'conditions', label: 'Efeitos', icon: 'color-wand-outline' },
];

const PAGE_SIZES = [10, 20, 50, 100];

const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  level: 'Nivel',
  category: 'Categoria',
  classes: 'Classes',
  casting_time: 'Tempo de uso',
  casting_time_value: 'Quantidade de acoes',
  casting_time_unit: 'Unidade da acao',
  range: 'Alcance',
  range_value: 'Valor do alcance',
  range_unit: 'Unidade do alcance',
  range_shape: 'Forma do alcance',
  components: 'Componentes',
  duration: 'Duracao',
  duration_value: 'Valor da duracao',
  duration_unit: 'Unidade da duracao',
  damage_dice: 'Dado de dano',
  damage_type: 'Tipo de dano',
  saving_throw: 'Teste de resistencia',
  description: 'Descricao',
  class_level_required: 'Nivel/classe requerida',
  weight: 'Peso',
  damage: 'Dano',
  properties: 'Propriedades',
  descricao: 'Descricao',
  is_consumable: 'Consumivel',
  stat_bonuses: 'Bonus de atributos',
  speed: 'Deslocamento',
  features: 'Habilidades',
  recommended_stats: 'Atributos sugeridos',
  starting_equipment: 'Equipamento inicial',
  starting_gold: 'Ouro inicial',
  hit_dice: 'Dado de vida',
  saves: 'Resistencias',
  subclass_level: 'Nivel da subclasse',
  is_caster: 'Usa magia',
  class_name: 'Classe',
  level_required: 'Nivel requerido',
  bonus_skills: 'Pericias extras',
  target_name: 'Alvo',
  target_type: 'Tipo de alvo',
  items: 'Itens',
  color: 'Cor',
  trigger: 'Disparo',
  effect_kind: 'Tipo de efeito',
  effect_type: 'Efeito',
  condition_name: 'Condicao',
  value_mode: 'Modo do valor',
  dice_count: 'Quantidade de dados',
  dice_sides: 'Faces do dado',
  dice_bonus: 'Bonus do dado',
  fixed_value: 'Valor fixo',
  chance_percent: 'Chance',
  target: 'Alvo do efeito',
  stacking: 'Acumulacao',
  notes: 'Notas',
  metadata: 'Metadados',
  created_at: 'Criado em',
};

const HIDDEN_DETAIL_KEYS = new Set(['id', 'criador', 'sort_order', 'source_table', 'source_id', 'source_name']);

const TECHNICAL_DERIVED_KEYS = new Set([
  'description',
  'descricao',
  'casting_time_value',
  'casting_time_unit',
  'range_value',
  'range_unit',
  'range_shape',
  'duration_value',
  'duration_unit',
]);

const DURATION_LABELS: Record<string, string> = {
  instant: 'Instantaneo',
  turn: 'Turno',
  round: 'Turno',
  minute: 'Minuto',
  hour: 'Hora',
  day: 'Dia',
  short_rest: 'Descanso curto',
  long_rest: 'Descanso longo',
  permanent: 'Permanente',
};

const STAT_LABELS: Record<string, string> = {
  str: 'FOR',
  dex: 'DES',
  con: 'CON',
  int: 'INT',
  wis: 'SAB',
  cha: 'CAR',
  forca: 'FOR',
  for: 'FOR',
  destreza: 'DES',
  des: 'DES',
  constituicao: 'CON',
  inteligencia: 'INT',
  sabedoria: 'SAB',
  sab: 'SAB',
  carisma: 'CAR',
  car: 'CAR',
  save_for: 'FOR',
  save_des: 'DES',
  save_con: 'CON',
  save_int: 'INT',
  save_sab: 'SAB',
  save_car: 'CAR',
};

const SHEET_TITLES: Record<SectionKey, string> = {
  spells: 'Ficha da magia/skill',
  items: 'Ficha do item',
  races: 'Ficha da raca',
  classes: 'Ficha da classe',
  subclasses: 'Ficha da subclasse',
  kits: 'Ficha do kit',
  conditions: 'Ficha do efeito',
};

const FIELD_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  name: 'bookmark-outline',
  level: 'sparkles-outline',
  category: 'library-outline',
  classes: 'shield-outline',
  casting_time: 'hourglass-outline',
  range: 'locate-outline',
  components: 'git-compare-outline',
  duration: 'timer-outline',
  damage: 'flash-outline',
  damage_dice: 'flash-outline',
  damage_type: 'flame-outline',
  saving_throw: 'shield-checkmark-outline',
  description: 'reader-outline',
  weight: 'barbell-outline',
  properties: 'pricetags-outline',
  descricao: 'reader-outline',
  stat_bonuses: 'stats-chart-outline',
  recommended_stats: 'stats-chart-outline',
  starting_equipment: 'bag-handle-outline',
  saves: 'shield-outline',
  features: 'sparkles-outline',
  items: 'cube-outline',
};

function safeJson(value: unknown, fallback: any = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function splitCsv(value?: string | null) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function creatorLabel(value?: string | null) {
  if (value === 'proprio') return 'Custom';
  if (value === 'importado') return 'Importado';
  return 'Base';
}

function compactText(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function featureNames(features?: string | null) {
  const parsed = safeJson(features, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(item => typeof item === 'string' ? item : item?.name)
    .filter(Boolean);
}

function itemListText(items?: unknown) {
  const parsed = safeJson(items, []);
  if (!Array.isArray(parsed)) return '-';
  return parsed.map(item => `${Number(item.qty || 1)}x ${item.name || 'Item'}`).join(', ');
}

function itemList(items?: unknown) {
  const parsed = safeJson(items, []);
  return Array.isArray(parsed) ? parsed : [];
}

function durationText(raw: Record<string, any>) {
  const unit = raw.duration_unit;
  const value = raw.duration_value;
  if (!unit && raw.duration) return String(raw.duration);
  if (!unit) return '-';
  const label = DURATION_LABELS[String(unit)] || String(unit);
  if (unit === 'instant' || unit === 'permanent' || unit === 'short_rest' || unit === 'long_rest') return label;
  return `${value || 1} ${label.toLowerCase()}(s)`;
}

function statBonusText(value: unknown) {
  const parsed = safeJson(value, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return compactText(value);
  const parts = Object.entries(parsed)
    .filter(([, amount]) => Number(amount) !== 0)
    .map(([stat, amount]) => `${STAT_LABELS[stat.toLowerCase()] || stat.toUpperCase()} ${Number(amount) > 0 ? '+' : ''}${amount}`);
  return parts.length ? parts.join(' / ') : '-';
}

function savesText(value: unknown) {
  const parsed = safeJson(value, value);
  if (Array.isArray(parsed)) {
    return parsed.map(item => STAT_LABELS[String(item).toLowerCase()] || String(item).toUpperCase()).join(', ');
  }
  return compactText(value);
}

function booleanText(value: unknown) {
  return Number(value) ? 'Sim' : 'Nao';
}

function prettyList(value: unknown) {
  return splitCsv(compactText(value)).join(', ') || '-';
}

function formatDetailValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'is_consumable' || key === 'is_caster') return booleanText(value);
  if (key === 'items' || key === 'starting_equipment') return itemListText(value);
  if (key === 'features') {
    const names = featureNames(compactText(value));
    return names.length ? names.join(', ') : '-';
  }
  if (key === 'stat_bonuses' || key === 'recommended_stats') return statBonusText(value);
  if (key === 'saves') return savesText(value);
  if (key === 'properties' || key === 'classes' || key === 'components') return prettyList(value);
  if (key === 'duration_unit') return DURATION_LABELS[String(value)] || compactText(value);
  if (key === 'chance_percent') return `${Number(value)}%`;
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function shouldShowDetailRow(key: string, value: unknown) {
  if (HIDDEN_DETAIL_KEYS.has(key) || TECHNICAL_DERIVED_KEYS.has(key)) return false;
  const formatted = formatDetailValue(key, value).trim();
  return formatted !== '-' && formatted !== '[]' && formatted !== '{}';
}

function firstFilled(...values: unknown[]) {
  const found = values.find(value => value !== null && value !== undefined && value !== '');
  return found === undefined ? '-' : String(found);
}

export default function GrimoireScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();

  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [activeSection, setActiveSection] = useState<SectionKey>('spells');
  const [search, setSearch] = useState('');
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(0);
  const [detailEntry, setDetailEntry] = useState<CatalogEntry | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const buildEntries = useCallback((rows: {
    items: any[];
    spells: any[];
    races: any[];
    classes: any[];
    subclasses: any[];
    kits: any[];
    conditions: any[];
    effects: any[];
  }) => {
    const effectsBySource = rows.effects.reduce<Record<string, any[]>>((acc, effect) => {
      const key = `${effect.source_table}:${effect.source_id}`;
      acc[key] = [...(acc[key] || []), effect];
      return acc;
    }, {});

    const makeSearch = (...parts: unknown[]) => parts.map(compactText).join(' ').toLowerCase();

    const spellEntries: CatalogEntry[] = rows.spells.map(spell => {
      const tags = [
        creatorLabel(spell.criador),
        spell.category || 'Magia',
        spell.level,
        spell.damage_type && spell.damage_type !== 'Nenhum' ? spell.damage_type : '',
        spell.duration_unit || spell.duration,
        ...splitCsv(spell.classes),
      ].filter(Boolean);
      return {
        id: `spells-${spell.id}`,
        numericId: Number(spell.id),
        section: 'spells',
        name: spell.name,
        subtitle: `${spell.category || 'Magia'} / ${spell.level} / ${spell.classes || 'Sem classe'}`,
        description: spell.description,
        creator: creatorLabel(spell.criador),
        tags,
        filterKeys: tags,
        searchText: makeSearch(spell.name, spell.category, spell.level, spell.classes, spell.description, spell.damage_dice, spell.damage_type, spell.duration),
        raw: spell,
        effects: effectsBySource[`spells:${spell.id}`] || [],
      };
    });

    const itemEntries: CatalogEntry[] = rows.items.map(item => {
      const tags = [
        creatorLabel(item.criador),
        item.category || 'Item',
        Number(item.is_consumable) ? 'Consumível' : '',
        item.damage_type && item.damage_type !== '-' ? item.damage_type : '',
        ...splitCsv(item.properties),
      ].filter(Boolean);
      return {
        id: `items-${item.id}`,
        numericId: Number(item.id),
        section: 'items',
        name: item.name,
        subtitle: `${item.category || 'Item'} / ${item.weight ?? 0}kg${item.damage && item.damage !== '-' ? ` / ${item.damage}` : ''}`,
        description: item.descricao,
        creator: creatorLabel(item.criador),
        tags,
        filterKeys: tags,
        searchText: makeSearch(item.name, item.category, item.properties, item.damage, item.damage_type, item.descricao),
        raw: item,
        effects: effectsBySource[`items:${item.id}`] || [],
      };
    });

    const raceEntries: CatalogEntry[] = rows.races.map(race => {
      const features = featureNames(race.features);
      const tags = [creatorLabel(race.criador), `Deslocamento ${race.speed}`, ...features].filter(Boolean);
      return {
        id: `races-${race.id}`,
        numericId: Number(race.id),
        section: 'races',
        name: race.name,
        subtitle: `Raça / ${race.speed}`,
        description: features.length > 0 ? features.join(', ') : 'Sem habilidades cadastradas.',
        creator: creatorLabel(race.criador),
        tags,
        filterKeys: tags,
        searchText: makeSearch(race.name, race.speed, race.stat_bonuses, features.join(' ')),
        raw: race,
      };
    });

    const classEntries: CatalogEntry[] = rows.classes.map(cls => {
      const features = featureNames(cls.features);
      const tags = [
        creatorLabel(cls.criador),
        Number(cls.is_caster) ? 'Conjurador' : 'Marcial',
        `d${cls.hit_dice}`,
        `Subclasse nv. ${cls.subclass_level}`,
        ...features,
      ].filter(Boolean);
      return {
        id: `classes-${cls.id}`,
        numericId: Number(cls.id),
        section: 'classes',
        name: cls.name,
        subtitle: `Classe / d${cls.hit_dice} / ${Number(cls.is_caster) ? 'Conjurador' : 'Não conjurador'}`,
        description: features.length > 0 ? features.join(', ') : 'Sem habilidades cadastradas.',
        creator: creatorLabel(cls.criador),
        tags,
        filterKeys: tags,
        searchText: makeSearch(cls.name, cls.hit_dice, cls.saves, cls.features, cls.starting_equipment),
        raw: cls,
      };
    });

    const subclassEntries: CatalogEntry[] = rows.subclasses.map(sub => {
      const features = featureNames(sub.features);
      const tags = [
        creatorLabel(sub.criador),
        ...splitCsv(sub.class_name),
        `Nível ${sub.level_required}`,
        Number(sub.bonus_skills || 0) > 0 ? `+${sub.bonus_skills} perícias` : '',
        ...features,
      ].filter(Boolean);
      return {
        id: `subclasses-${sub.id}`,
        numericId: Number(sub.id),
        section: 'subclasses',
        name: sub.name,
        subtitle: `${sub.class_name} / Nível ${sub.level_required}`,
        description: features.length > 0 ? features.join(', ') : 'Sem habilidades cadastradas.',
        creator: creatorLabel(sub.criador),
        tags,
        filterKeys: tags,
        searchText: makeSearch(sub.name, sub.class_name, sub.level_required, sub.features),
        raw: sub,
      };
    });

    const kitEntries: CatalogEntry[] = rows.kits.map(kit => {
      const tags = [creatorLabel(kit.criador), kit.target_name, kit.target_type].filter(Boolean);
      return {
        id: `kits-${kit.id}`,
        numericId: Number(kit.id),
        section: 'kits',
        name: kit.name,
        subtitle: `${kit.target_name} / ${kit.target_type}`,
        description: itemListText(kit.items),
        creator: creatorLabel(kit.criador),
        tags,
        filterKeys: tags,
        searchText: makeSearch(kit.name, kit.target_name, kit.target_type, kit.items),
        raw: kit,
      };
    });

    const conditionEntries: CatalogEntry[] = rows.conditions.map(condition => {
      const tags = [creatorLabel(condition.criador), condition.color].filter(Boolean);
      return {
        id: `conditions-${condition.id}`,
        numericId: Number(condition.id),
        section: 'conditions',
        name: condition.name,
        subtitle: `Efeito / ${condition.color}`,
        description: condition.description || 'Sem descrição.',
        creator: creatorLabel(condition.criador),
        tags,
        filterKeys: tags,
        searchText: makeSearch(condition.name, condition.description, condition.color),
        raw: condition,
      };
    });

    return [...spellEntries, ...itemEntries, ...raceEntries, ...classEntries, ...subclassEntries, ...kitEntries, ...conditionEntries];
  }, []);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const [items, spells, races, classes, subclasses, kits, conditions, effects] = await Promise.all([
        db.getAllAsync<any>('SELECT * FROM items ORDER BY name ASC'),
        db.getAllAsync<any>('SELECT * FROM spells ORDER BY category ASC, level ASC, name ASC'),
        db.getAllAsync<any>('SELECT * FROM races ORDER BY name ASC'),
        db.getAllAsync<any>('SELECT * FROM classes ORDER BY name ASC'),
        db.getAllAsync<any>('SELECT * FROM subclasses ORDER BY class_name ASC, level_required ASC, name ASC'),
        db.getAllAsync<any>('SELECT * FROM starting_kits ORDER BY target_name ASC, name ASC'),
        db.getAllAsync<any>('SELECT * FROM condition_effects ORDER BY name ASC'),
        db.getAllAsync<any>('SELECT * FROM effects ORDER BY source_table ASC, source_id ASC, sort_order ASC'),
      ]);
      setEntries(buildEntries({ items, spells, races, classes, subclasses, kits, conditions, effects }));
    } finally {
      setLoading(false);
    }
  }, [buildEntries, db]);

  React.useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const sectionEntries = useMemo(() => entries.filter(entry => entry.section === activeSection), [activeSection, entries]);

  const availableFilters = useMemo(() => {
    const counts = new Map<string, number>();
    sectionEntries.forEach(entry => {
      Array.from(new Set(entry.filterKeys)).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 80)
      .map(([label, count]) => ({ label, count }));
  }, [sectionEntries]);

  const filteredAvailableFilters = useMemo(() => {
    const normalized = filterSearch.trim().toLowerCase();
    if (!normalized) return availableFilters;
    return availableFilters.filter(filter => filter.label.toLowerCase().includes(normalized));
  }, [availableFilters, filterSearch]);

  const filteredEntries = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return sectionEntries.filter(entry => {
      if (normalizedSearch && !entry.searchText.includes(normalizedSearch)) return false;
      return selectedFilters.every(filter => entry.filterKeys.includes(filter));
    });
  }, [search, sectionEntries, selectedFilters]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const pageEntries = filteredEntries.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const activeSectionMeta = SECTIONS.find(section => section.key === activeSection) || SECTIONS[0];

  const selectSection = (section: SectionKey) => {
    setActiveSection(section);
    setSelectedFilters([]);
    setSearch('');
    setFilterSearch('');
    setPage(0);
  };

  const toggleFilter = (filter: string) => {
    setSelectedFilters(prev => prev.includes(filter) ? prev.filter(item => item !== filter) : [...prev, filter]);
    setPage(0);
  };

  const renderEntry = ({ item }: { item: CatalogEntry }) => {
    const primaryTags = item.tags.slice(0, 4);
    return (
      <TouchableOpacity style={styles.entryCard} activeOpacity={0.82} onPress={() => setDetailEntry(item)}>
        <View style={styles.entryHeader}>
          <View style={[styles.entryIcon, item.creator !== 'Base' && styles.entryIconCustom]}>
            <Ionicons name={activeSectionMeta.icon} size={18} color={item.creator === 'Base' ? '#00bfff' : '#00fa9a'} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.entryName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.entrySub} numberOfLines={1}>{item.subtitle}</Text>
          </View>
          <View style={[styles.creatorBadge, item.creator !== 'Base' && styles.creatorBadgeCustom]}>
            <Text style={[styles.creatorBadgeText, item.creator !== 'Base' && styles.creatorBadgeTextCustom]}>{item.creator}</Text>
          </View>
        </View>
        <Text style={styles.entryDescription} numberOfLines={2}>{item.description || 'Sem descrição cadastrada.'}</Text>
        <View style={styles.tagWrap}>
          {primaryTags.map(tag => (
            <View key={tag} style={styles.tagPill}>
              <Text style={styles.tagText} numberOfLines={1}>{tag}</Text>
            </View>
          ))}
          {item.tags.length > primaryTags.length && <Text style={styles.moreTagsText}>+{item.tags.length - primaryTags.length}</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  const renderMetric = (
    label: string,
    value: unknown,
    icon: keyof typeof Ionicons.glyphMap = 'ellipse-outline',
    wide = false
  ) => (
    <View style={[styles.metricBox, wide && styles.metricBoxWide]}>
      <View style={[styles.metricIcon, wide && styles.metricIconWide]}>
        <Ionicons name={icon} size={26} color="#65f3ff" />
      </View>
      <View style={[styles.metricTextWrap, wide && styles.metricTextWrapWide]}>
        <Text style={[styles.metricLabel, wide && styles.metricTextWide]}>{label}</Text>
        <Text style={[styles.metricValue, wide && styles.metricTextWide]} numberOfLines={2}>{compactText(value)}</Text>
      </View>
    </View>
  );

  const renderVisualChips = (title: string, values: unknown[]) => {
    const chips = values.map(compactText).filter(value => value && value !== '-');
    if (!chips.length) return null;
    return (
      <>
        {renderSheetSectionTitle(title, 'sparkles-outline')}
        <View style={styles.visualChips}>
          {chips.map(value => (
            <View key={value} style={styles.visualChip}>
              <Text style={styles.visualChipText}>{value}</Text>
            </View>
          ))}
        </View>
      </>
    );
  };

  const renderSheetSectionTitle = (title: string, icon: keyof typeof Ionicons.glyphMap) => (
    <View style={styles.sheetSectionTitleRow}>
      <Ionicons name={icon} size={18} color="#62dcff" />
      <Text style={styles.detailSectionTitle}>{title}</Text>
    </View>
  );

  const renderSheetHero = (entry: CatalogEntry) => {
    const raw = entry.raw;
    const features = featureNames(raw.features).slice(0, 2);
    const sectionIcon = SECTIONS.find(section => section.key === entry.section)?.icon || 'book-outline';
    const metaBySection: Record<SectionKey, string> = {
      spells: `${raw.category || 'Magia'}  •  ${raw.level || 'Nivel 1'}`,
      items: `${raw.category || 'Item'}  •  ${Number(raw.is_consumable) ? 'Consumivel' : 'Equipavel/uso livre'}`,
      races: `Raca  •  Deslocamento ${raw.speed || '-'}`,
      classes: `Classe  •  d${raw.hit_dice || '-'}  •  ${Number(raw.is_caster) ? 'Conjurador' : 'Nao conjurador'}`,
      subclasses: `${raw.class_name || 'Classe'}  •  Nivel ${raw.level_required || '-'}`,
      kits: `${raw.target_name || 'Alvo'}  •  ${raw.target_type || 'Kit'}`,
      conditions: `Efeito  •  ${raw.color || '#F4A84D'}`,
    };
    const sublineBySection: Record<SectionKey, string> = {
      spells: raw.classes || '',
      items: [raw.damage && raw.damage !== '-' ? raw.damage : '', raw.damage_type && raw.damage_type !== '-' ? raw.damage_type : '', raw.properties].filter(Boolean).join(' • '),
      races: statBonusText(raw.stat_bonuses),
      classes: features.join(' • '),
      subclasses: features.join(' • '),
      kits: itemListText(raw.items),
      conditions: raw.description || '',
    };

    return (
      <LinearGradient colors={['rgba(20,48,91,0.98)', 'rgba(4,18,43,0.98)']} style={styles.sheetHero}>
        <View style={styles.sheetGrip} />
        <TouchableOpacity style={styles.sheetCloseButton} onPress={() => setDetailEntry(null)}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>
        <View style={styles.sheetHeroGlow} />
        <View style={styles.sheetHeroRow}>
          <View style={styles.sheetEmblem}>
            <View style={styles.sheetEmblemInner}>
              <Ionicons name={sectionIcon} size={28} color="#65f3ff" />
            </View>
          </View>
          <View style={styles.sheetHeroText}>
            <Text style={styles.sheetEyebrow}>{SHEET_TITLES[entry.section]}</Text>
            <Text style={styles.sheetTitle} numberOfLines={3}>{entry.name}</Text>
            <Text style={styles.sheetMeta}>{metaBySection[entry.section]}</Text>
            {sublineBySection[entry.section] ? <Text style={styles.sheetSubline} numberOfLines={2}>{sublineBySection[entry.section]}</Text> : null}
          </View>
        </View>
        <View style={styles.sheetSummaryBox}>
          <Text style={styles.sheetSummaryLabel}>O que faz</Text>
          <Text style={styles.sheetSummaryText}>{entry.description || 'Sem descricao cadastrada.'}</Text>
        </View>
      </LinearGradient>
    );
  };

  const renderFeatureCards = (title: string, features: string[]) => {
    if (!features.length) return null;
    return (
      <>
        {renderSheetSectionTitle(title, 'sparkles-outline')}
        <View style={styles.featureGrid}>
          {features.map(feature => (
            <View key={feature} style={styles.featureCard}>
              <View style={styles.featureIcon}>
                <Ionicons name="sparkles-outline" size={20} color="#65f3ff" />
              </View>
              <Text style={styles.featureName}>{feature}</Text>
            </View>
          ))}
        </View>
      </>
    );
  };

  const renderStatBoxes = (title: string, value: unknown) => {
    const parsed = safeJson(value, null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const stats = Object.entries(parsed);
    if (!stats.length) return null;
    return (
      <>
        {renderSheetSectionTitle(title, 'stats-chart-outline')}
        <View style={styles.statBoxGrid}>
          {stats.map(([stat, amount]) => (
            <View key={stat} style={styles.statBox}>
              <Text style={styles.statBoxLabel}>{STAT_LABELS[stat.toLowerCase()] || stat.toUpperCase()}</Text>
              <Text style={styles.statBoxValue}>{Number(amount) > 0 ? '+' : ''}{String(amount)}</Text>
            </View>
          ))}
        </View>
      </>
    );
  };

  const renderItemRows = (title: string, value: unknown) => {
    const items = itemList(value);
    if (!items.length) return null;
    return (
      <>
        {renderSheetSectionTitle(title, 'bag-handle-outline')}
        <View style={styles.itemCardGrid}>
          {items.map((item, index) => (
            <View key={`${item.name || 'item'}-${index}`} style={styles.itemMiniCard}>
              <Ionicons name="cube-outline" size={18} color="#65f3ff" />
              <Text style={styles.itemMiniText}>{Number(item.qty || 1)}x {item.name || 'Item'}</Text>
            </View>
          ))}
        </View>
      </>
    );
  };

  const renderDetailHighlights = (entry: CatalogEntry) => {
    const raw = entry.raw;

    if (entry.section === 'items') {
      return (
        <View style={styles.heroPanel}>
          <View style={styles.metricGrid}>
            {renderMetric('Categoria', raw.category || 'Item', 'bag-outline')}
            {renderMetric('Peso', `${raw.weight ?? 0} kg`, 'barbell-outline')}
            {renderMetric('Dano', raw.damage && raw.damage !== '-' ? raw.damage : 'Sem dano', 'flash-outline')}
            {renderMetric('Consumivel', booleanText(raw.is_consumable), 'flask-outline')}
          </View>
          {renderVisualChips('Propriedades', splitCsv(raw.properties))}
          {raw.damage_type && raw.damage_type !== '-' ? renderVisualChips('Tipo de dano', [raw.damage_type]) : null}
        </View>
      );
    }

    if (entry.section === 'spells') {
      return (
        <View style={styles.heroPanel}>
          <View style={styles.metricGrid}>
            {renderMetric('Nivel', raw.level, 'trending-up-outline')}
            {renderMetric('Tempo', firstFilled(raw.casting_time, `${raw.casting_time_value || 1} ${raw.casting_time_unit || 'acao'}`), 'hourglass-outline')}
            {renderMetric('Alcance', firstFilled(raw.range, `${raw.range_value || 0} ${raw.range_unit || ''}`), 'locate-outline')}
            {renderMetric('Duracao', durationText(raw), 'timer-outline')}
          </View>
          {renderVisualChips('Classes que usam', splitCsv(raw.classes))}
          {renderVisualChips('Componentes e regras', [raw.components, raw.saving_throw, raw.damage_dice, raw.damage_type].filter(Boolean))}
        </View>
      );
    }

    if (entry.section === 'races') {
      return (
        <View style={styles.heroPanel}>
          <View style={styles.metricGrid}>
            {renderMetric('Deslocamento', raw.speed, 'walk-outline')}
            {renderMetric('Bonus', statBonusText(raw.stat_bonuses), 'stats-chart-outline')}
          </View>
          {renderFeatureCards('Habilidades raciais', featureNames(raw.features))}
        </View>
      );
    }

    if (entry.section === 'classes') {
      return (
        <View style={styles.heroPanel}>
          <View style={styles.metricGrid}>
            {renderMetric('Dado de vida', `d${raw.hit_dice}`, 'heart-outline')}
            {renderMetric('Ouro inicial', raw.starting_gold, 'cash-outline')}
            {renderMetric('Magias', booleanText(raw.is_caster), 'sparkles-outline')}
            {renderMetric('Subclasse', `Nivel ${raw.subclass_level}`, 'git-branch-outline')}
          </View>
          {renderVisualChips('Resistencias', splitCsv(savesText(raw.saves)))}
          {renderFeatureCards('Habilidades de classe', featureNames(raw.features))}
          {renderStatBoxes('Atributos sugeridos', raw.recommended_stats)}
          {renderItemRows('Equipamento inicial', raw.starting_equipment)}
        </View>
      );
    }

    if (entry.section === 'subclasses') {
      return (
        <View style={styles.heroPanel}>
          <View style={styles.metricGrid}>
            {renderMetric('Classe', raw.class_name, 'shield-half-outline')}
            {renderMetric('Nivel requerido', raw.level_required, 'trending-up-outline')}
            {renderMetric('Pericias extras', raw.bonus_skills || 0, 'school-outline', true)}
          </View>
          {renderFeatureCards('Habilidades da subclasse', featureNames(raw.features))}
        </View>
      );
    }

    if (entry.section === 'kits') {
      const items = itemList(raw.items);
      return (
        <View style={styles.heroPanel}>
          <View style={styles.metricGrid}>
            {renderMetric('Destino', raw.target_name, 'person-outline')}
            {renderMetric('Tipo', raw.target_type, 'pricetag-outline')}
            {renderMetric('Itens', items.length, 'cube-outline', true)}
          </View>
          {renderItemRows('Itens do kit', raw.items)}
        </View>
      );
    }

    if (entry.section === 'conditions') {
      return (
        <View style={styles.heroPanel}>
          <View style={styles.conditionHero}>
            <View style={[styles.colorPreviewLarge, { backgroundColor: raw.color || '#F4A84D' }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.conditionHeroTitle}>Marcador visual</Text>
              <Text style={styles.conditionHeroSub}>{raw.color || '#F4A84D'}</Text>
            </View>
          </View>
        </View>
      );
    }

    return null;
  };

  const renderDetailModal = () => {
    if (!detailEntry) return null;
    const raw = detailEntry.raw;
    const detailRows = Object.entries(raw).filter(([key, value]) => shouldShowDetailRow(key, value));

    return (
      <Modal visible transparent animationType="slide" onRequestClose={() => setDetailEntry(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.detailCard, { marginTop: Math.max(insets.top + 6, 20) }]}>
            <ScrollView
              style={styles.detailBody}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              nestedScrollEnabled
              contentContainerStyle={[styles.detailScroll, { paddingBottom: Math.max(insets.bottom + 52, 72) }]}
            >
              {renderSheetHero(detailEntry)}

              {renderDetailHighlights(detailEntry)}

              {detailEntry.effects && detailEntry.effects.length > 0 && (
                <>
                  {renderSheetSectionTitle('Efeitos ao usar/equipar', 'flash-outline')}
                  {detailEntry.effects.map(effect => (
                    <View key={effect.id} style={styles.effectBox}>
                      <Text style={styles.effectText}>{formatEffectSummary(effect as any)}</Text>
                      {effect.notes ? <Text style={styles.effectSub}>{effect.notes}</Text> : null}
                    </View>
                  ))}
                </>
              )}

              <View style={styles.technicalCard}>
                <View style={styles.technicalTitleWrap}>
                  <View style={styles.technicalLine} />
                  <Text style={styles.technicalTitle}>Ficha tecnica</Text>
                  <View style={styles.technicalLine} />
                </View>
              {detailRows.map(([key, value]) => (
                <View key={key} style={styles.detailRow}>
                  <View style={styles.detailKeyWrap}>
                    <Ionicons name={FIELD_ICONS[key] || 'ellipse-outline'} size={16} color="#3ac8e8" />
                    <Text style={styles.detailKey}>{FIELD_LABELS[key] || key}</Text>
                  </View>
                  <Text style={styles.detailValue}>{formatDetailValue(key, value)}</Text>
                </View>
              ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  const renderFiltersModal = () => (
    <Modal visible={filtersOpen} transparent animationType="slide" onRequestClose={() => setFiltersOpen(false)}>
      <View style={styles.filterModalOverlay}>
        <View style={[styles.filterModalCard, { paddingBottom: Math.max(insets.bottom + 16, 28) }]}>
          <View style={styles.filterModalHeader}>
            <View>
              <Text style={styles.filterModalTitle}>Filtros de {activeSectionMeta.label}</Text>
              <Text style={styles.filterModalSub}>{selectedFilters.length} selecionado(s)</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={() => setFiltersOpen(false)}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={18} color="rgba(255,255,255,0.42)" />
            <TextInput
              style={styles.searchInput}
              value={filterSearch}
              onChangeText={setFilterSearch}
              placeholder="Buscar filtro..."
              placeholderTextColor="rgba(255,255,255,0.35)"
            />
            {filterSearch ? (
              <TouchableOpacity onPress={() => setFilterSearch('')}>
                <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.45)" />
              </TouchableOpacity>
            ) : null}
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.filterModalChips}>
            {filteredAvailableFilters.map(filter => {
              const active = selectedFilters.includes(filter.label);
              return (
                <TouchableOpacity key={filter.label} style={[styles.filterChip, styles.filterModalChip, active && styles.filterChipActive]} onPress={() => toggleFilter(filter.label)}>
                  <Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} size={15} color={active ? '#00fa9a' : 'rgba(255,255,255,0.45)'} />
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{filter.label}</Text>
                  <Text style={[styles.filterChipCount, active && styles.filterChipTextActive]}>{filter.count}</Text>
                </TouchableOpacity>
              );
            })}
            {filteredAvailableFilters.length === 0 ? <Text style={styles.emptyText}>Nenhum filtro encontrado.</Text> : null}
          </ScrollView>

          <View style={styles.filterModalFooter}>
            <TouchableOpacity
              style={[styles.filterFooterButton, selectedFilters.length === 0 && styles.pagerButtonDisabled]}
              disabled={selectedFilters.length === 0}
              onPress={() => {
                setSelectedFilters([]);
                setFilterSearch('');
                setPage(0);
              }}
            >
              <Text style={styles.filterFooterSecondary}>Limpar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.filterFooterButton, styles.filterFooterPrimary]} onPress={() => setFiltersOpen(false)}>
              <Text style={styles.filterFooterPrimaryText}>Aplicar filtros</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  return (
    <LinearGradient colors={['#102b56', '#02112b']} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={28} color="#fff" />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.topBarTitle}>GRIMÓRIO</Text>
          <Text style={styles.topBarSub}>Banco completo de conteúdo</Text>
        </View>
        <TouchableOpacity onPress={loadCatalog}>
          <Ionicons name="refresh" size={24} color="#00bfff" />
        </TouchableOpacity>
      </View>

      <View style={styles.sectionTabs}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sectionTabsContent}>
          {SECTIONS.map(section => {
            const active = activeSection === section.key;
            const count = entries.filter(entry => entry.section === section.key).length;
            return (
              <TouchableOpacity key={section.key} style={[styles.sectionTab, active && styles.sectionTabActive]} onPress={() => selectSection(section.key)}>
                <Ionicons name={section.icon} size={16} color={active ? '#02112b' : '#00bfff'} />
                <Text style={[styles.sectionTabText, active && styles.sectionTabTextActive]}>{section.label}</Text>
                <Text style={[styles.sectionTabCount, active && styles.sectionTabTextActive]}>{count}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.filtersPanel}>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color="rgba(255,255,255,0.42)" />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={value => {
              setSearch(value);
              setPage(0);
            }}
            placeholder={`Buscar em ${activeSectionMeta.label.toLowerCase()}...`}
            placeholderTextColor="rgba(255,255,255,0.35)"
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.45)" />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.filterHeader}>
          <Text style={styles.filterLabel}>Filtros múltiplos</Text>
          <TouchableOpacity style={styles.openFiltersButton} onPress={() => setFiltersOpen(true)}>
            <Ionicons name="options-outline" size={16} color="#02112b" />
            <Text style={styles.openFiltersText}>Selecionar filtros</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.selectedFiltersBox}>
          {selectedFilters.length > 0 ? (
            <>
              {selectedFilters.slice(0, 8).map(filter => (
                <TouchableOpacity key={filter} style={styles.selectedFilterChip} onPress={() => toggleFilter(filter)}>
                  <Text style={styles.selectedFilterText}>{filter}</Text>
                  <Ionicons name="close" size={13} color="#00fa9a" />
                </TouchableOpacity>
              ))}
              {selectedFilters.length > 8 ? <Text style={styles.moreTagsText}>+{selectedFilters.length - 8} filtros</Text> : null}
            </>
          ) : (
            <Text style={styles.noFiltersText}>Nenhum filtro aplicado. Combine origem, categoria, classe, dano e outros marcadores.</Text>
          )}
          {selectedFilters.length > 0 && (
            <TouchableOpacity onPress={() => {
              setSelectedFilters([]);
              setPage(0);
            }}>
              <Text style={styles.clearText}>Limpar ({selectedFilters.length})</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.paginationBar}>
          <Text style={styles.resultText}>{filteredEntries.length} resultado(s)</Text>
          <View style={styles.pageSizeRow}>
            {PAGE_SIZES.map(size => (
              <TouchableOpacity
                key={size}
                style={[styles.pageSizeChip, pageSize === size && styles.pageSizeChipActive]}
                onPress={() => {
                  setPageSize(size);
                  setPage(0);
                }}
              >
                <Text style={[styles.pageSizeText, pageSize === size && styles.pageSizeTextActive]}>{size}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <FlatList
        style={styles.list}
        data={pageEntries}
        keyExtractor={item => item.id}
        renderItem={renderEntry}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<Text style={styles.emptyText}>{loading ? 'Carregando grimório...' : 'Nenhum conteúdo encontrado com esses filtros.'}</Text>}
      />

      <View style={[styles.bottomPager, { marginBottom: Math.max(insets.bottom, 12) }]}>
        <TouchableOpacity style={[styles.pagerButton, currentPage === 0 && styles.pagerButtonDisabled]} disabled={currentPage === 0} onPress={() => setPage(Math.max(0, currentPage - 1))}>
          <Ionicons name="chevron-back" size={18} color="#00bfff" />
          <Text style={styles.pagerButtonText}>Anterior</Text>
        </TouchableOpacity>
        <Text style={styles.pageText}>Pag. {currentPage + 1} / {totalPages}</Text>
        <TouchableOpacity style={[styles.pagerButton, currentPage >= totalPages - 1 && styles.pagerButtonDisabled]} disabled={currentPage >= totalPages - 1} onPress={() => setPage(Math.min(totalPages - 1, currentPage + 1))}>
          <Text style={styles.pagerButtonText}>Próxima</Text>
          <Ionicons name="chevron-forward" size={18} color="#00bfff" />
        </TouchableOpacity>
      </View>

      {renderDetailModal()}
      {renderFiltersModal()}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { paddingTop: 50, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, backgroundColor: 'rgba(0,0,0,0.3)' },
  topBarTitle: { color: '#00fa9a', fontSize: 17, fontWeight: 'bold', letterSpacing: 1 },
  topBarSub: { color: 'rgba(255,255,255,0.52)', fontSize: 11, marginTop: 2 },
  sectionTabs: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  sectionTabsContent: { gap: 8, paddingHorizontal: 14 },
  sectionTab: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  sectionTabActive: { backgroundColor: '#00bfff', borderColor: '#00bfff' },
  sectionTabText: { color: '#00bfff', fontSize: 12, fontWeight: 'bold' },
  sectionTabTextActive: { color: '#02112b' },
  sectionTabCount: { color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: 'bold' },
  filtersPanel: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, backgroundColor: 'rgba(0,0,0,0.14)' },
  searchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  searchInput: { flex: 1, color: '#fff', fontSize: 14, paddingVertical: 10 },
  filterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, marginBottom: 7 },
  filterLabel: { color: 'rgba(255,255,255,0.48)', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
  clearText: { color: '#ff7474', fontSize: 11, fontWeight: 'bold' },
  openFiltersButton: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#00bfff' },
  openFiltersText: { color: '#02112b', fontSize: 11, fontWeight: 'bold' },
  selectedFiltersBox: { minHeight: 42, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7, padding: 10, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  selectedFilterChip: { maxWidth: '100%', minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(0,250,154,0.1)', borderWidth: 1, borderColor: 'rgba(0,250,154,0.26)' },
  selectedFilterText: { color: '#00fa9a', fontSize: 10, fontWeight: 'bold' },
  noFiltersText: { flex: 1, color: 'rgba(255,255,255,0.42)', fontSize: 11, lineHeight: 16 },
  filterChip: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' },
  filterChipActive: { backgroundColor: 'rgba(0,250,154,0.12)', borderColor: 'rgba(0,250,154,0.42)' },
  filterChipText: { color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: 'bold' },
  filterChipTextActive: { color: '#00fa9a' },
  filterChipCount: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 'bold' },
  paginationBar: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10 },
  resultText: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 'bold' },
  pageSizeRow: { flexDirection: 'row', gap: 6 },
  pageSizeChip: { minWidth: 34, minHeight: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' },
  pageSizeChipActive: { backgroundColor: 'rgba(0,191,255,0.14)', borderColor: 'rgba(0,191,255,0.38)' },
  pageSizeText: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: 'bold' },
  pageSizeTextActive: { color: '#00bfff' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 16 },
  entryCard: { borderRadius: 14, padding: 12, marginBottom: 10, backgroundColor: 'rgba(255,255,255,0.055)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' },
  entryHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 9 },
  entryIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,191,255,0.1)', borderWidth: 1, borderColor: 'rgba(0,191,255,0.28)' },
  entryIconCustom: { backgroundColor: 'rgba(0,250,154,0.1)', borderColor: 'rgba(0,250,154,0.3)' },
  entryName: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  entrySub: { color: 'rgba(255,255,255,0.48)', fontSize: 11, marginTop: 3 },
  creatorBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(0,191,255,0.1)', borderWidth: 1, borderColor: 'rgba(0,191,255,0.25)' },
  creatorBadgeCustom: { backgroundColor: 'rgba(0,250,154,0.12)', borderColor: 'rgba(0,250,154,0.34)' },
  creatorBadgeText: { color: '#00bfff', fontSize: 9, fontWeight: 'bold' },
  creatorBadgeTextCustom: { color: '#00fa9a' },
  entryDescription: { color: 'rgba(255,255,255,0.68)', fontSize: 12, lineHeight: 18, marginBottom: 10 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagPill: { maxWidth: '100%', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  tagText: { color: 'rgba(255,255,255,0.58)', fontSize: 10, fontWeight: 'bold' },
  tagPillStrong: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(0,191,255,0.1)', borderWidth: 1, borderColor: 'rgba(0,191,255,0.22)' },
  tagTextStrong: { color: '#00bfff', fontSize: 10, fontWeight: 'bold' },
  moreTagsText: { color: 'rgba(255,255,255,0.38)', fontSize: 10, fontWeight: 'bold', alignSelf: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginTop: 60, fontSize: 13 },
  bottomPager: { marginHorizontal: 14, marginTop: 2, minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 8, borderRadius: 16, backgroundColor: 'rgba(2,17,43,0.96)', borderWidth: 1, borderColor: 'rgba(0,191,255,0.18)' },
  pagerButton: { flex: 1, minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12, backgroundColor: 'rgba(0,191,255,0.08)', borderWidth: 1, borderColor: 'rgba(0,191,255,0.24)' },
  pagerButtonDisabled: { opacity: 0.35 },
  pagerButtonText: { color: '#00bfff', fontSize: 11, fontWeight: 'bold' },
  pageText: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: 'bold', minWidth: 76, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.84)', justifyContent: 'flex-end' },
  detailCard: { flex: 1, width: '100%', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', backgroundColor: '#061a37', borderWidth: 1, borderColor: 'rgba(76,177,255,0.3)', borderBottomWidth: 0 },
  detailHeader: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, backgroundColor: 'rgba(0,0,0,0.24)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  closeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)' },
  sheetHero: { marginBottom: 10, paddingHorizontal: 16, paddingTop: 28, paddingBottom: 16, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(88,207,255,0.2)' },
  sheetGrip: { position: 'absolute', top: 9, alignSelf: 'center', width: 52, height: 5, borderRadius: 99, backgroundColor: 'rgba(176,206,255,0.42)' },
  sheetCloseButton: { position: 'absolute', top: 18, right: 14, zIndex: 4, width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  sheetHeroGlow: { position: 'absolute', right: -55, top: -60, width: 210, height: 210, borderRadius: 140, backgroundColor: 'rgba(0,191,255,0.07)' },
  sheetHeroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingRight: 36 },
  sheetEmblem: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.24)', borderWidth: 2, borderColor: 'rgba(80,235,255,0.52)' },
  sheetEmblemInner: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.055)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)' },
  sheetHeroText: { flex: 1, minWidth: 0 },
  sheetEyebrow: { color: '#00fa9a', fontSize: 10, fontWeight: 'bold', letterSpacing: 1, marginBottom: 3, textTransform: 'uppercase' },
  sheetTitle: { color: '#f7fbff', fontSize: 26, fontWeight: 'bold', letterSpacing: 0, lineHeight: 30 },
  sheetMeta: { color: '#65d9ff', fontSize: 13, marginTop: 5, fontWeight: 'bold', lineHeight: 18 },
  sheetSubline: { color: 'rgba(255,255,255,0.62)', fontSize: 12, lineHeight: 17, marginTop: 5 },
  sheetSummaryBox: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  sheetSummaryLabel: { color: '#65f3ff', fontSize: 10, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  sheetSummaryText: { color: 'rgba(255,255,255,0.86)', fontSize: 13, lineHeight: 19 },
  detailTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  detailSub: { color: 'rgba(255,255,255,0.52)', fontSize: 12, marginTop: 4 },
  detailBody: { flex: 1 },
  detailScroll: { paddingHorizontal: 14, paddingTop: 10 },
  sheetSectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, marginBottom: 9, paddingHorizontal: 2 },
  detailSectionTitle: { flexShrink: 1, color: 'rgba(222,239,255,0.8)', fontSize: 12, fontWeight: 'bold', letterSpacing: 1.2, textTransform: 'uppercase' },
  detailDescription: { color: 'rgba(255,255,255,0.76)', fontSize: 13, lineHeight: 20 },
  effectBox: { borderRadius: 12, padding: 11, marginBottom: 8, backgroundColor: 'rgba(0,250,154,0.08)', borderWidth: 1, borderColor: 'rgba(0,250,154,0.2)' },
  effectText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  effectSub: { color: 'rgba(255,255,255,0.48)', fontSize: 11, marginTop: 4 },
  heroPanel: { marginTop: 2, paddingHorizontal: 2, paddingBottom: 4 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricBox: { width: '48.7%', minHeight: 98, padding: 10, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.045)', borderWidth: 1, borderColor: 'rgba(94,180,255,0.18)' },
  metricBoxWide: { width: '100%', minHeight: 76, flexDirection: 'row', justifyContent: 'flex-start', paddingHorizontal: 14 },
  metricIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 8, backgroundColor: 'rgba(0,191,255,0.1)' },
  metricIconWide: { marginBottom: 0, marginRight: 12 },
  metricTextWrap: { alignItems: 'center', maxWidth: '100%' },
  metricTextWrapWide: { flex: 1, alignItems: 'flex-start' },
  metricTextWide: { textAlign: 'left' },
  metricLabel: { color: 'rgba(218,234,255,0.58)', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'center' },
  metricValue: { color: '#fff', fontSize: 17, fontWeight: 'bold', marginTop: 5, lineHeight: 21, textAlign: 'center' },
  visualChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  visualChip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 10, backgroundColor: 'rgba(0,191,255,0.08)', borderWidth: 1, borderColor: 'rgba(0,214,255,0.38)' },
  visualChipText: { color: '#8de4ff', fontSize: 12, fontWeight: 'bold' },
  featureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  featureCard: { width: '48.7%', minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 10, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.052)', borderWidth: 1, borderColor: 'rgba(94,180,255,0.18)' },
  featureIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(0,191,255,0.09)', borderWidth: 1, borderColor: 'rgba(0,214,255,0.28)' },
  featureName: { flex: 1, color: '#eef7ff', fontSize: 12, fontWeight: 'bold', lineHeight: 16 },
  statBoxGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statBox: { width: '31%', minHeight: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(94,180,255,0.18)' },
  statBoxLabel: { color: 'rgba(255,255,255,0.68)', fontSize: 12, fontWeight: 'bold' },
  statBoxValue: { color: '#9ae9ff', fontSize: 17, fontWeight: 'bold', marginTop: 4 },
  itemCardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  itemMiniCard: { width: '48%', minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.052)', borderWidth: 1, borderColor: 'rgba(94,180,255,0.16)' },
  itemMiniText: { flex: 1, color: 'rgba(255,255,255,0.82)', fontSize: 12, fontWeight: 'bold', lineHeight: 16 },
  kitItemRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, marginBottom: 7, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  kitItemQty: { color: '#00fa9a', fontSize: 12, fontWeight: 'bold', minWidth: 34 },
  kitItemName: { color: '#fff', fontSize: 12, fontWeight: 'bold', flex: 1 },
  conditionHero: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  colorPreviewLarge: { width: 58, height: 58, borderRadius: 18, borderWidth: 2, borderColor: 'rgba(255,255,255,0.28)' },
  conditionHeroTitle: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  conditionHeroSub: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 4 },
  technicalCard: { marginTop: 20, borderRadius: 15, paddingHorizontal: 12, paddingTop: 13, paddingBottom: 4, backgroundColor: 'rgba(255,255,255,0.035)', borderWidth: 1, borderColor: 'rgba(94,180,255,0.18)' },
  technicalTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  technicalLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.16)' },
  technicalTitle: { color: 'rgba(222,239,255,0.78)', fontSize: 12, fontWeight: 'bold', letterSpacing: 1.4, textTransform: 'uppercase' },
  detailRow: { minHeight: 46, flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.055)' },
  detailKeyWrap: { width: '43%', flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingRight: 2 },
  detailKey: { flex: 1, color: 'rgba(220,236,255,0.55)', fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 14 },
  detailValue: { flex: 1, color: 'rgba(255,255,255,0.86)', fontSize: 13, lineHeight: 18, paddingTop: 0 },
  filterModalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.78)' },
  filterModalCard: { width: '100%', maxHeight: '82%', paddingHorizontal: 14, paddingTop: 14, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#102b56', borderWidth: 1, borderBottomWidth: 0, borderColor: 'rgba(0,191,255,0.32)' },
  filterModalHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  filterModalTitle: { color: '#fff', fontSize: 17, fontWeight: 'bold' },
  filterModalSub: { color: 'rgba(255,255,255,0.48)', fontSize: 11, marginTop: 3 },
  filterModalChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 12, paddingBottom: 16 },
  filterModalChip: { maxWidth: '100%' },
  filterModalFooter: { flexDirection: 'row', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  filterFooterButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  filterFooterPrimary: { backgroundColor: '#00fa9a', borderColor: '#00fa9a' },
  filterFooterSecondary: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 'bold' },
  filterFooterPrimaryText: { color: '#02112b', fontSize: 12, fontWeight: 'bold' },
});
