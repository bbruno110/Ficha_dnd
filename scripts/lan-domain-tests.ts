import {
  parseUsableDiceFormula,
  parseUsableDiceFormulaWithContext,
  rollParsedDiceFormula,
} from '../src/services/combat/diceFormulaService';
import {
  advanceEffectsByUnit,
  normalizeDomainEffect,
} from '../src/services/lan/lanEffectDomain';
import {
  consumeItemAtomically,
  equipItemAtomically,
} from '../src/services/lan/lanInventoryDomain';
import {
  applyEventToProjection,
  applySnapshotToProjection,
  createSessionProjection,
} from '../src/services/lan/lanProjectionEngine';

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}. Esperado: ${String(expected)}. Recebido: ${String(actual)}.`);
  }
}

function assertDeepEqual<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}. Esperado: ${JSON.stringify(expected)}. Recebido: ${JSON.stringify(actual)}.`);
  }
}

function event(overrides: Record<string, any>) {
  return {
    id: overrides.id || `event_${Math.random()}`,
    sessionId: 's1',
    type: 'player_patch',
    fromKey: 'master',
    fromName: 'Mestre',
    toKey: 'p1',
    toName: 'Jogador',
    createdAt: new Date(0).toISOString(),
    ...overrides,
  } as any;
}

function baseState() {
  return {
    status: 'active',
    currentTurn: 1,
    elapsedMinutes: 0,
    players: [{
      id: 1,
      sessionId: 's1',
      remoteKey: 'p1',
      playerName: 'Jogador',
      characterId: 1,
      sourceCharacterId: 1,
      characterName: 'Nyx',
      level: 1,
      className: 'Barbaro',
      race: 'Drow',
      hpCurrent: 9,
      hpMax: 14,
      tempHp: 0,
      xp: 0,
      gp: 10,
      sp: 0,
      cp: 0,
      stats: { FOR: '15', DES: '15', CON: '14', INT: '8', SAB: '12', CAR: '11' },
      equipment: {
        bag: [
          { id: 'potion', name: 'Pocao de Cura', qty: 2, damage: 'Cura 2d4+2' },
          { id: 'armor', name: 'Armadura de Couro +1', qty: 1, effect_json: '[{"type":"stat","target":"CA","value":1}]' },
        ],
        slots: {},
      },
      effects: [],
      revisionSeq: 0,
    }],
  } as any;
}

const parsedPotion = parseUsableDiceFormula('Cura 2d4+2');
if (!parsedPotion) throw new Error('Parser nao reconheceu Cura 2d4+2.');
assertEqual(parsedPotion.formula, '2d4+2', 'parser extrai 2d4+2 de texto de cura');
assertEqual(parsedPotion.count, 2, '2d4 rola dois dados');
assertEqual(parsedPotion.sides, 4, '2d4 usa d4');
assertEqual(parsedPotion.modifier, 2, '2d4+2 soma modificador fixo');

const parsedAttr = parseUsableDiceFormulaWithContext('1d6+CON', { CON: 2 });
if (!parsedAttr) throw new Error('Parser nao reconheceu 1d6+CON.');
assertEqual(parsedAttr.formula, '1d6+2', 'parser resolve modificador de atributo');
assertEqual(rollParsedDiceFormula(parsedAttr, () => 0).total, 3, '1d6+CON soma dado e modificador');

const rolledOnce = rollParsedDiceFormula(parsedPotion, (() => {
  const values = [0.1, 0.6];
  return () => values.shift() ?? 0;
})());
assertDeepEqual(rolledOnce.rolls, [1, 3], 'rolagem virtual usa exatamente dois d4');
assertEqual(rolledOnce.total, 6, '2d4+2 nao vira 2+2+2 fixo');

const consumeTwoToOne = consumeItemAtomically({ equipment: baseState().players[0].equipment, bagIndex: 0, qty: 1 });
assertEqual(consumeTwoToOne.equipmentAfter.bag.find((item) => item.id === 'potion')?.qty, 1, 'consumir qty 2 vira 1');
const consumeOneToZero = consumeItemAtomically({ equipment: consumeTwoToOne.equipmentAfter, bagIndex: 0, qty: 1 });
assertEqual(Boolean(consumeOneToZero.equipmentAfter.bag.find((item) => item.id === 'potion')), false, 'consumir qty 1 remove item');

let projection = createSessionProjection('s1', baseState());
let result = applyEventToProjection(projection, event({
  id: 'fx_1',
  type: 'effect_patch',
  entityType: 'effect',
  entityId: 'p1',
  entityRevision: 10,
  effectPatch: {
    targetKey: 'p1',
    add: [{ id: 'strength_1', name: 'FOR temporario', target: 'FOR', value: 2, kind: 'stat', remaining: 1, unit: 'turn' }],
    update: [],
    remove: [],
  },
}));
assertEqual(result.applied, true, 'effect_patch aplica em dominio de efeito');
projection = result.projection;

result = applyEventToProjection(projection, event({
  id: 'hp_1',
  type: 'player_patch',
  entityType: 'player',
  entityId: 'p1',
  entityRevision: 1,
  numberPatch: { hpCurrent: 8, hpMax: 14, tempHp: 0 },
}));
assertEqual(result.applied, true, 'effectRevision nao bloqueia playerRevision menor');
assertEqual(result.projection.players.p1.hpCurrent, 8, 'dano/cura altera HP real');
projection = result.projection;

result = applyEventToProjection(projection, event({
  id: 'hp_1',
  type: 'player_patch',
  entityType: 'player',
  entityId: 'p1',
  entityRevision: 1,
  numberPatch: { hpCurrent: 2 },
}));
assertEqual(result.applied, false, 'eventId duplicado nao reaplica cura/dano/rolagem');

result = applySnapshotToProjection(projection, {
  ...baseState(),
  players: [{ ...baseState().players[0], hpCurrent: 14, revisionSeq: 0 }],
}, 0);
assertEqual(result.projection.players.p1.hpCurrent, 8, 'snapshot antigo nao sobrescreve HP vivo');

const tempEffect = normalizeDomainEffect({
  id: 'for_1',
  targetKey: 'p1',
  name: 'FOR +2',
  target: 'FOR',
  value: 2,
  kind: 'stat',
  remaining: 1,
  unit: 'turn',
});
const advanced = advanceEffectsByUnit([tempEffect], 'turn');
assertEqual(advanced.activeEffects.length, 0, 'efeito temporario expira ao passar turno');
assertEqual(advanced.expiredEffects.length, 1, 'efeito expirado fica identificado');

const equip1 = equipItemAtomically({
  equipment: baseState().players[0].equipment,
  stats: baseState().players[0].stats,
  slot: 'armor',
  itemToEquip: baseState().players[0].equipment.bag[1],
});
const equip2 = equipItemAtomically({
  equipment: equip1.equipmentAfter,
  stats: equip1.statsAfter,
  slot: 'armor',
  itemToEquip: equip1.equipmentAfter.slots.armor,
});
assertEqual(equip1.statsAfter.equip_mods.CA, 1, 'equipamento aplica bonus uma vez');
assertEqual(equip2.statsAfter.equip_mods.CA, 1, 'equipamento nao duplica bonus ao repetir');
assertEqual(Boolean(equip1.equipmentAfter.slots.armor), true, 'equipar nao produz slot intermediario vazio');

console.log('LAN domain tests passed');
