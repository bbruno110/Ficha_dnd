import { selectedContentFromSession } from '../../network/lanRepository';
import { LanOfficialEventMessage, LanSessionConfig, LanSessionRecord } from '../../types/lan';

export const LAN_TRADE_TIMEOUT_MS = 5 * 60 * 1000;

export function makeSessionConfig(session: LanSessionRecord): LanSessionConfig {
  return {
    sessionId: session.id,
    sessionName: session.name,
    allowExistingCharacter: Boolean(session.allow_existing_character),
    syncCustomContent: Boolean(session.sync_custom_content),
    selectedContent: selectedContentFromSession(session),
  };
}

export function makeCommandId() {
  return `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function numberFromPayload(payload: Record<string, unknown> | undefined, key: string, fallback = 0) {
  const value = Number(payload?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function shouldIncludeAvatarInSnapshot(reason: string) {
  return /avatar|created|linked|edited|master-start|join/i.test(reason);
}

export function makeTradeExpiresAt(now = Date.now()) {
  return new Date(now + LAN_TRADE_TIMEOUT_MS).toISOString();
}

export function getTradeExpiresAt(event: Pick<LanOfficialEventMessage, 'at' | 'payload'>) {
  const payloadExpiresAt = String((event.payload as any)?.expiresAt || '');
  const parsedPayloadDate = payloadExpiresAt ? Date.parse(payloadExpiresAt) : NaN;
  if (Number.isFinite(parsedPayloadDate)) return parsedPayloadDate;

  const parsedEventDate = Date.parse(event.at || '');
  return Number.isFinite(parsedEventDate) ? parsedEventDate + LAN_TRADE_TIMEOUT_MS : Date.now() + LAN_TRADE_TIMEOUT_MS;
}

export function isTradeEventExpired(event: Pick<LanOfficialEventMessage, 'at' | 'payload'>, now = Date.now()) {
  return getTradeExpiresAt(event) <= now;
}

export function parseJsonValue<T = any>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function normalizeEquipment(value: unknown) {
  const parsed = parseJsonValue<any>(value, {});
  if (Array.isArray(parsed)) return { bag: parsed, slots: {} };
  return {
    bag: Array.isArray(parsed?.bag) ? parsed.bag : [],
    slots: parsed?.slots || {},
  };
}

export function addItemToEquipment(equipmentValue: unknown, item: Record<string, unknown>, quantity: number) {
  const equipment = normalizeEquipment(equipmentValue);
  const itemName = String(item.name || item.itemName || 'Item');
  const qty = Math.max(1, quantity);
  const bag = [...equipment.bag];
  const existingIndex = bag.findIndex((entry: any) => String(entry.name || entry.itemName) === itemName);
  if (existingIndex >= 0) {
    bag[existingIndex] = { ...bag[existingIndex], qty: Number(bag[existingIndex].qty || 1) + qty };
  } else {
    bag.push({ ...item, name: itemName, qty });
  }
  return { ...equipment, bag };
}

export function removeItemFromEquipment(equipmentValue: unknown, itemNameValue: string, quantity: number) {
  const equipment = normalizeEquipment(equipmentValue);
  const itemName = String(itemNameValue || 'Item');
  const qty = Math.max(1, quantity);
  const bag = [...equipment.bag];
  const existingIndex = bag.findIndex((entry: any) => String(entry.name || entry.itemName) === itemName);
  if (existingIndex < 0) return { ok: false, equipment, available: 0 };

  const available = Number(bag[existingIndex].qty || 1);
  if (available < qty) return { ok: false, equipment, available };

  const nextQty = available - qty;
  if (nextQty <= 0) bag.splice(existingIndex, 1);
  else bag[existingIndex] = { ...bag[existingIndex], qty: nextQty };
  return { ok: true, equipment: { ...equipment, bag }, available };
}

export function cloneTransferItem(item: Record<string, unknown>, quantity: number) {
  const { qty: _qty, quantity: _quantity, ...itemWithoutQuantity } = item as Record<string, unknown>;
  return {
    ...itemWithoutQuantity,
    name: String(item.name || item.itemName || 'Item'),
    qty: Math.max(1, quantity),
  };
}

export function normalizeItemName(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeStats(value: unknown): Record<string, any> {
  const stats = parseJsonValue<Record<string, any>>(value, {});
  return {
    ...stats,
    temp_mods: { ...(stats.temp_mods || {}) },
    timed_effects: Array.isArray(stats.timed_effects) ? [...stats.timed_effects] : [],
  };
}

export function removeTimedEffect(statsValue: unknown, effectId: string, hpTemp = 0) {
  const stats = normalizeStats(statsValue);
  const effect = stats.timed_effects.find((entry: any) => String(entry.id) === String(effectId));
  if (!effect) return { stats, hpTemp, removed: null as any };

  if (effect.kind === 'attribute' && effect.stat) {
    const nextValue = Number(stats.temp_mods?.[effect.stat] || 0) - Number(effect.amount || 0);
    if (nextValue === 0) delete stats.temp_mods[effect.stat];
    else stats.temp_mods[effect.stat] = nextValue;
  }

  let nextHpTemp = hpTemp;
  if (effect.kind === 'temp_hp') {
    nextHpTemp = Math.max(0, hpTemp - Math.abs(Number(effect.amount || 0)));
  }

  stats.timed_effects = stats.timed_effects.filter((entry: any) => String(entry.id) !== String(effectId));
  return { stats, hpTemp: nextHpTemp, removed: effect };
}

export function clearTempHpEffects(statsValue: unknown) {
  const stats = normalizeStats(statsValue);
  stats.timed_effects = stats.timed_effects.filter((entry: any) => entry.kind !== 'temp_hp');
  return stats;
}

export function consumeTempHpEffects(statsValue: unknown, absorbedDamage: number) {
  const stats = normalizeStats(statsValue);
  let remainingDamage = Math.max(0, Number(absorbedDamage || 0));
  if (remainingDamage <= 0) return stats;

  const remainingEffects: any[] = [];
  for (const effect of stats.timed_effects) {
    if (effect?.kind !== 'temp_hp' || remainingDamage <= 0) {
      remainingEffects.push(effect);
      continue;
    }

    const effectAmount = Math.max(0, Number(effect.amount || 0));
    if (effectAmount <= remainingDamage) {
      remainingDamage -= effectAmount;
      continue;
    }

    const nextAmount = effectAmount - remainingDamage;
    remainingDamage = 0;
    remainingEffects.push({
      ...effect,
      amount: nextAmount,
      label: `PV temporario +${nextAmount}`,
    });
  }

  stats.timed_effects = remainingEffects;
  return stats;
}

export function progressTimedEffects(
  statsValue: unknown,
  hpTempValue: number,
  progress: { turns?: number; minutes?: number; restType?: 'short_rest' | 'long_rest' }
) {
  const stats = normalizeStats(statsValue);
  let hpTemp = Math.max(0, Number(hpTempValue || 0));
  const expired: any[] = [];
  const remaining: any[] = [];
  let changed = false;

  const removeSideEffects = (effect: any) => {
    if (effect.kind === 'attribute' && effect.stat) {
      const nextValue = Number(stats.temp_mods?.[effect.stat] || 0) - Number(effect.amount || 0);
      if (nextValue === 0) delete stats.temp_mods[effect.stat];
      else stats.temp_mods[effect.stat] = nextValue;
    }

    if (effect.kind === 'temp_hp') {
      hpTemp = Math.max(0, hpTemp - Math.abs(Number(effect.amount || 0)));
    }
  };

  for (const effect of stats.timed_effects) {
    const nextEffect = { ...effect };
    const unit = String(nextEffect.durationUnit || nextEffect.duration_unit || '');
    let remove = false;

    if (progress.restType) {
      remove = unit === progress.restType || (progress.restType === 'long_rest' && unit === 'short_rest');
    }

    if (!remove && progress.turns && (unit === 'turn' || unit === 'round')) {
      nextEffect.durationValue = Math.max(0, Number(nextEffect.durationValue || 1) - progress.turns);
      changed = true;
      remove = nextEffect.durationValue <= 0;
    }

    if (!remove && progress.minutes && unit === 'minute') {
      nextEffect.durationValue = Math.max(0, Number(nextEffect.durationValue || 1) - progress.minutes);
      changed = true;
      remove = nextEffect.durationValue <= 0;
    }

    if (!remove && progress.minutes && unit === 'hour') {
      const hours = Math.floor(progress.minutes / 60);
      if (hours > 0) {
        nextEffect.durationValue = Math.max(0, Number(nextEffect.durationValue || 1) - hours);
        changed = true;
        remove = nextEffect.durationValue <= 0;
      }
    }

    if (remove) {
      changed = true;
      expired.push(nextEffect);
      removeSideEffects(nextEffect);
    } else {
      remaining.push(nextEffect);
    }
  }

  stats.timed_effects = remaining;
  return { stats, hpTemp, expired, changed };
}
