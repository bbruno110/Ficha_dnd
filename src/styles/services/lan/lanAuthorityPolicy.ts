import type { LanSessionEventType } from '../lanSession';

export type LanRuntimeFlow = 'offline_singleplayer' | 'lan_master_authoritative' | 'lan_player_client';

export type LanResourceKind =
  | 'hp'
  | 'temp_hp'
  | 'xp'
  | 'coins'
  | 'stats'
  | 'inventory'
  | 'effects'
  | 'spells'
  | 'session_lifecycle';

export const MASTER_AUTHORITATIVE_RESOURCES = new Set<LanResourceKind>([
  'hp',
  'temp_hp',
  'xp',
  'coins',
  'stats',
  'inventory',
  'effects',
  'session_lifecycle',
]);

export const PLAYER_SELF_MANAGED_RESOURCES = new Set<LanResourceKind>([
  'inventory',
  'spells',
  'coins',
]);

export const LAN_CRITICAL_EVENT_TYPES = new Set<LanSessionEventType>([
  'session_ended',
  'session_patch',
  'player_kicked',
  'player_patch',
  'effect_patch',
  'inventory_patch',
  'pending_save_patch',
]);

export function isLanCriticalEventType(type: LanSessionEventType) {
  return LAN_CRITICAL_EVENT_TYPES.has(type);
}

export function canPlayerMutateResourceDirectly(resource: LanResourceKind, operation: 'increase' | 'decrease' | 'convert' | 'use' | 'equip' | 'drop' | 'send' | 'trade' | 'cast') {
  if (!PLAYER_SELF_MANAGED_RESOURCES.has(resource)) return false;

  if (resource === 'coins') {
    return operation === 'decrease' || operation === 'convert' || operation === 'send' || operation === 'trade';
  }

  if (resource === 'inventory') {
    return operation === 'decrease' || operation === 'use' || operation === 'equip' || operation === 'drop' || operation === 'send' || operation === 'trade';
  }

  if (resource === 'spells') {
    return operation === 'cast';
  }

  return false;
}

export function mustPlayerAskMaster(resource: LanResourceKind, operation: 'increase' | 'decrease' | 'convert' | 'use' | 'equip' | 'drop' | 'send' | 'trade' | 'cast') {
  if (resource === 'hp' || resource === 'temp_hp' || resource === 'xp' || resource === 'stats' || resource === 'effects') return true;
  if (resource === 'coins' && operation === 'increase') return true;
  if (resource === 'inventory' && operation === 'increase') return true;
  return !canPlayerMutateResourceDirectly(resource, operation);
}
