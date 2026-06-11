export type InventoryItemState = Record<string, any> & {
  name?: string;
  qty?: number;
};

export type InventoryState = {
  bag: InventoryItemState[];
  slots: Record<string, InventoryItemState | null>;
};

export type ConsumeItemAtomicInput = {
  equipment: unknown;
  itemInstanceId?: string | number;
  bagIndex?: number;
  qty?: number;
};

export type ConsumeItemAtomicResult = {
  item: InventoryItemState;
  qty: number;
  equipmentBefore: InventoryState;
  equipmentAfter: InventoryState;
  removed: boolean;
  itemDelta: {
    mode: 'remove';
    item: InventoryItemState;
    qty: number;
    stackKey: string;
  };
};

export type EquipItemAtomicInput = {
  equipment: unknown;
  stats: Record<string, any>;
  slot: string;
  itemToEquip?: InventoryItemState | null;
};

export type EquipItemAtomicResult = {
  equipmentBefore: InventoryState;
  equipmentAfter: InventoryState;
  statsAfter: Record<string, any>;
  unequippedOffHand?: InventoryItemState | null;
};

const DEFAULT_SLOTS: Record<string, null> = {
  helmet: null,
  cloak: null,
  amulet: null,
  armor: null,
  campClothes: null,
  gloves: null,
  boots: null,
  ring1: null,
  ring2: null,
  mainHand: null,
  offHand: null,
  ranged: null,
  lightSource: null,
};

const EQUIP_BONUS_TARGETS = ['CA', 'FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'];

export function normalizeInventoryState(value: unknown): InventoryState {
  const parsed = safeJsonParse<any>(value, {});
  if (Array.isArray(parsed)) return { bag: compactInventoryBag(parsed), slots: { ...DEFAULT_SLOTS } };
  if (!parsed || typeof parsed !== 'object') return { bag: [], slots: { ...DEFAULT_SLOTS } };
  return {
    ...parsed,
    bag: compactInventoryBag(Array.isArray(parsed.bag) ? parsed.bag : []),
    slots: { ...DEFAULT_SLOTS, ...(parsed.slots || {}) },
  };
}

export function consumeItemAtomically(input: ConsumeItemAtomicInput): ConsumeItemAtomicResult {
  const equipmentBefore = normalizeInventoryState(input.equipment);
  const qty = Math.max(1, Math.floor(Number(input.qty || 1) || 1));
  const bagIndex = resolveBagIndex(equipmentBefore.bag, input.itemInstanceId, input.bagIndex);
  if (bagIndex < 0 || !equipmentBefore.bag[bagIndex]) throw new Error('Item nao encontrado no inventario.');

  const item = { ...equipmentBefore.bag[bagIndex] };
  const currentQty = Math.max(0, Math.floor(Number(item.qty || 0) || 0));
  if (currentQty < qty) throw new Error('Quantidade insuficiente para consumir o item.');

  const nextBag = equipmentBefore.bag.map((entry, index) => (
    index === bagIndex ? { ...entry, qty: currentQty - qty } : entry
  )).filter((entry) => Math.max(0, Number(entry.qty || 0) || 0) > 0);

  const equipmentAfter = {
    ...equipmentBefore,
    bag: compactInventoryBag(nextBag),
  };

  return {
    item,
    qty,
    equipmentBefore,
    equipmentAfter,
    removed: currentQty - qty <= 0,
    itemDelta: {
      mode: 'remove',
      item: { ...item, qty },
      qty,
      stackKey: getInventoryStackKey(item),
    },
  };
}

export function equipItemAtomically(input: EquipItemAtomicInput): EquipItemAtomicResult {
  const equipmentBefore = normalizeInventoryState(input.equipment);
  const slot = String(input.slot || '').trim();
  if (!slot) throw new Error('Slot de equipamento invalido.');

  let bag = equipmentBefore.bag.map((item) => ({ ...item }));
  const slots = { ...equipmentBefore.slots };
  const oldItem = slots[slot] ? { ...slots[slot] } as InventoryItemState : null;
  let unequippedOffHand: InventoryItemState | null = null;

  if (input.itemToEquip) {
    const props = String(input.itemToEquip.properties || '').toLowerCase();
    if (slot === 'mainHand' && props.includes('duas')) {
      const offHand = slots.offHand ? { ...slots.offHand } as InventoryItemState : null;
      if (offHand) {
        bag = addItemToBag(bag, { ...offHand, qty: 1 });
        slots.offHand = null;
        unequippedOffHand = offHand;
      }
    }

    if (slot === 'offHand') {
      const mainProps = String(slots.mainHand?.properties || '').toLowerCase();
      if (mainProps.includes('duas')) throw new Error('A arma principal ocupa as duas maos.');
    }
  }

  if (oldItem) bag = addItemToBag(bag, { ...oldItem, qty: 1 });

  if (input.itemToEquip) {
    const wantedKey = getInventoryStackKey(input.itemToEquip);
    const bagIndex = bag.findIndex((entry) => getInventoryStackKey(entry) === wantedKey || entry.name === input.itemToEquip?.name);
    if (bagIndex < 0) throw new Error('Item nao encontrado na mochila.');
    const currentQty = Math.max(0, Number(bag[bagIndex].qty || 0) || 0);
    if (currentQty < 1) throw new Error('Quantidade insuficiente para equipar.');
    bag[bagIndex] = { ...bag[bagIndex], qty: currentQty - 1 };
    bag = bag.filter((entry) => Math.max(0, Number(entry.qty || 0) || 0) > 0);
    slots[slot] = { ...input.itemToEquip, qty: 1 };
  } else {
    slots[slot] = null;
  }

  const equipmentAfter = {
    ...equipmentBefore,
    bag: compactInventoryBag(bag),
    slots,
  };
  const statsAfter = buildStatsWithDerivedEquipMods(input.stats || {}, equipmentAfter);
  return { equipmentBefore, equipmentAfter, statsAfter, unequippedOffHand };
}

export function buildStatsWithDerivedEquipMods(stats: Record<string, any>, equipment: unknown): Record<string, any> {
  const nextStats = { ...(stats || {}) };
  const derived = deriveEquipModsFromEquipment(equipment);
  if (Object.keys(derived).length > 0) nextStats.equip_mods = derived;
  else delete nextStats.equip_mods;
  return nextStats;
}

export function deriveEquipModsFromEquipment(equipment: unknown): Record<string, number> {
  const normalized = normalizeInventoryState(equipment);
  const mods: Record<string, number> = {};
  for (const item of Object.values(normalized.slots)) {
    if (!item) continue;
    const bonuses = getEquipBonusFromItem(item);
    for (const [stat, value] of Object.entries(bonuses)) {
      mods[stat] = (mods[stat] || 0) + Number(value || 0);
    }
  }
  Object.keys(mods).forEach((key) => { if (!mods[key]) delete mods[key]; });
  return mods;
}

export function getInventoryStackKey(item: unknown): string {
  const value = item && typeof item === 'object' ? item as Record<string, unknown> : {};
  return [
    value.inventoryItemId,
    value.inventory_item_id,
    value.itemId,
    value.item_id,
    value.catalogItemId,
    value.catalog_item_id,
    value.sourceItemId,
    value.source_item_id,
    value.id,
    value.name,
    value.damage,
    value.damage_type,
    value.properties,
    value.effect_json,
  ].map((part) => String(part || '').trim().toLowerCase()).join('|');
}

export function extractItemHealingFormula(item: unknown, effects: unknown[] = []): string {
  const list = Array.isArray(effects) ? effects : [];
  for (const effect of list) {
    const entry = effect && typeof effect === 'object' ? effect as Record<string, unknown> : {};
    const kind = String(entry.kind || entry.type || '').toLowerCase();
    const target = String(entry.target || '').toUpperCase();
    if (kind === 'heal' || target === 'HP') {
      const formula = String(entry.healDice || entry.dice || entry.value || '').trim();
      if (formula) return formula;
    }
  }

  const value = item && typeof item === 'object' ? item as Record<string, unknown> : {};
  const text = [value.damage, value.damage_type, value.descricao, value.properties].map((part) => String(part || '')).join(' ');
  if (!/cura|curar|hp|pv/i.test(text)) return '';
  return text.match(/\d*d\d+(?:\s*[+-]\s*(?:\d+|FOR|DES|CON|INT|SAB|CAR))*/i)?.[0] || '';
}

function compactInventoryBag(items: unknown[]): InventoryItemState[] {
  const byKey = new Map<string, InventoryItemState>();
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = { ...(raw as InventoryItemState) };
    const qty = Math.max(0, Number(item.qty ?? 1) || 0);
    if (qty <= 0) continue;
    item.qty = qty;
    const key = getInventoryStackKey(item);
    const existing = byKey.get(key);
    if (existing) existing.qty = Math.max(0, Number(existing.qty || 0) || 0) + qty;
    else byKey.set(key, item);
  }
  return Array.from(byKey.values());
}

function addItemToBag(bag: InventoryItemState[], item: InventoryItemState): InventoryItemState[] {
  const key = getInventoryStackKey(item);
  const index = bag.findIndex((entry) => getInventoryStackKey(entry) === key || entry.name === item.name);
  if (index < 0) return compactInventoryBag([...bag, { ...item, qty: Math.max(1, Number(item.qty || 1) || 1) }]);
  const next = [...bag];
  next[index] = {
    ...next[index],
    qty: Math.max(0, Number(next[index].qty || 0) || 0) + Math.max(1, Number(item.qty || 1) || 1),
  };
  return compactInventoryBag(next);
}

function resolveBagIndex(bag: InventoryItemState[], itemInstanceId?: string | number, bagIndex?: number) {
  const index = Math.floor(Number(bagIndex));
  if (Number.isFinite(index) && index >= 0 && index < bag.length) return index;
  const id = String(itemInstanceId || '').trim();
  if (!id) return -1;
  return bag.findIndex((item) => (
    String(item.id || '') === id ||
    String(item.inventoryItemId || item.inventory_item_id || '') === id ||
    getInventoryStackKey(item) === id
  ));
}

function getEquipBonusFromItem(item: InventoryItemState): Record<string, number> {
  const bonuses: Record<string, number> = {};
  const effects = parseStructuredEffects(item.effect_json || item.effectJson);
  const hasStructuredEquipEffects = effects.some((effect) => {
    const target = String(effect?.target || '').toUpperCase();
    if (!target || target === 'CHOOSE_STAT' || effect?.chooseStat) return false;
    const kind = String(effect?.kind || effect?.type || '').toLowerCase();
    return ['stat', 'attribute', 'atributo'].includes(kind) || EQUIP_BONUS_TARGETS.includes(target);
  });

  if (!hasStructuredEquipEffects) {
    const text = String(item.damage || item.effect || '');
    const lower = text.toLowerCase();
    if (!lower.includes('perm') && !lower.includes('temp')) {
      const statRegex = /(CA|FOR|DES|CON|INT|SAB|CAR)\s*([+-]?\d+)/gi;
      for (const match of text.matchAll(statRegex)) {
        addEquipBonus(bonuses, match[1], parseInt(String(match[2]).replace('+', ''), 10));
      }
    }
  }

  for (const effect of effects) {
    const target = String(effect?.target || '').toUpperCase();
    if (!target || target === 'CHOOSE_STAT' || effect?.chooseStat) continue;
    const kind = String(effect?.kind || effect?.type || '').toLowerCase();
    if (!['stat', 'attribute', 'atributo'].includes(kind) && !EQUIP_BONUS_TARGETS.includes(target)) continue;
    const durationText = String(effect?.durationText || '').toLowerCase();
    const durationUnit = String(effect?.durationUnit || effect?.duration_unit || '').toLowerCase();
    if (durationText.includes('temp') || durationText.includes('perm') || ['turn', 'round', 'minute', 'hour', 'day', 'rest', 'short_rest', 'long_rest', 'permanent'].includes(durationUnit)) continue;
    addEquipBonus(bonuses, target, effect?.value ?? effect?.amount);
  }

  return bonuses;
}

function addEquipBonus(target: Record<string, number>, attrRaw: unknown, rawValue: unknown) {
  const attr = String(attrRaw || '').toUpperCase();
  if (!EQUIP_BONUS_TARGETS.includes(attr)) return;
  const value = Number(rawValue || 0);
  if (!Number.isFinite(value) || value === 0) return;
  target[attr] = (target[attr] || 0) + value;
}

function parseStructuredEffects(value: unknown): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw || raw === '-' || raw.toLowerCase() === 'null') return [];
    try { return parseStructuredEffects(JSON.parse(raw)); } catch { return []; }
  }
  if (typeof value === 'object') {
    const obj = value as any;
    if (Array.isArray(obj.effects)) return parseStructuredEffects(obj.effects);
    if (Array.isArray(obj.effect)) return parseStructuredEffects(obj.effect);
    if (Array.isArray(obj.items)) return parseStructuredEffects(obj.items);
    if (Array.isArray(obj.data)) return parseStructuredEffects(obj.data);
    if (obj.effect_json) return parseStructuredEffects(obj.effect_json);
    if (obj.type || obj.kind || obj.effectType || obj.target || obj.chooseStat || obj.condition) return [obj];
  }
  return [];
}

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
