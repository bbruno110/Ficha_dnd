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
  addItemsToInventory,
  canStackInventoryItem,
  compactInventoryBag,
  consumeItemAtomically,
  equipItemAtomically,
  getInventoryStackKey,
} from '../src/services/lan/lanInventoryDomain';
import { getVisibleEffects } from '../src/services/effects/effectVisualService';
import {
  applyEventToProjection,
  applySnapshotToProjection,
  createSessionProjection,
} from '../src/services/lan/lanProjectionEngine';
import { LanGameEngine } from '../src/services/lan/engine/LanGameEngine';
import {
  applyIncomingLanEvent,
  applyIncomingLegacyLanEvent,
  applyIncomingSnapshot,
  dispatchMasterCommand,
  dispatchPlayerCommand,
  getLanProjection,
  resetLanEngineBridgeForTests,
  subscribeLanProjection,
} from '../src/services/lan/engine/LanEngineBridge';
import { legacyPayloadToLanSnapshot } from '../src/services/lan/engine/LanSnapshotAdapter';
import { selectLanProjectionCharacter } from '../src/hooks/useLanProjection';

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
          { id: 'for_potion', name: 'Pocao de Forca', qty: 1, effect_json: '[{"kind":"stat","target":"FOR","value":2,"remaining":1,"unit":"turn"}]' },
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

const engine = new LanGameEngine();
engine.ensureProjection('s1', baseState());

for (let i = 0; i < 5; i += 1) {
  engine.applyCommand({
    type: 'apply_damage',
    commandId: `damage_${i}`,
    sessionId: 's1',
    actorKey: 'master',
    targetKey: 'p1',
    amount: 1,
  });
}
assertEqual(engine.getProjection('s1')?.players.p1.hpCurrent, 4, 'engine aplica 5 danos rapidos sem rollback');

for (let i = 0; i < 5; i += 1) {
  engine.applyCommand({
    type: 'apply_heal',
    commandId: `heal_${i}`,
    sessionId: 's1',
    actorKey: 'master',
    targetKey: 'p1',
    amount: 1,
  });
}
assertEqual(engine.getProjection('s1')?.players.p1.hpCurrent, 9, 'engine aplica 5 curas rapidas sem travar');

const healClampEngine = new LanGameEngine();
healClampEngine.ensureProjection('s1', baseState());
healClampEngine.applyCommand({
  type: 'apply_heal',
  commandId: 'heal_clamp_1',
  sessionId: 's1',
  actorKey: 'master',
  targetKey: 'p1',
  amount: 999,
});
assertEqual(healClampEngine.getProjection('s1')?.players.p1.hpCurrent, 14, 'cura do engine respeita hpMax');

engine.applyCommand({
  type: 'apply_temp_hp',
  commandId: 'temp_hp_1',
  sessionId: 's1',
  actorKey: 'master',
  targetKey: 'p1',
  amount: 5,
});
engine.applyCommand({
  type: 'apply_effect',
  commandId: 'temp_hp_effect_1',
  sessionId: 's1',
  actorKey: 'master',
  targetKey: 'p1',
  effect: {
    id: 'temp_hp_effect_1',
    name: 'PV temporario',
    kind: 'temp_hp',
    target: 'PV_TEMP',
    value: 5,
    remaining: 1,
    unit: 'turn',
  },
});
assertEqual(engine.getProjection('s1')?.players.p1.tempHp, 5, 'PV temporario entra na projection');
engine.applyCommand({
  type: 'advance_turn',
  commandId: 'advance_temp_hp',
  sessionId: 's1',
  actorKey: 'master',
  unit: 'turn',
});
assertEqual(engine.getProjection('s1')?.players.p1.tempHp, 0, 'passagem de turno expira PV temporario');
assertEqual(engine.getProjection('s1')?.players.p1.activeEffects.some((effect) => effect.effectId === 'temp_hp_effect_1'), false, 'efeito de PV temporario nao fica ativo apos expirar');

const tempHpDurationEngine = new LanGameEngine();
tempHpDurationEngine.ensureProjection('s1', baseState());
const tempHpDuration = tempHpDurationEngine.applyCommand({
  type: 'apply_temp_hp',
  commandId: 'temp_hp_duration_1',
  sessionId: 's1',
  actorKey: 'master',
  targetKey: 'p1',
  amount: 7,
  duration: { value: 1, unit: 'turn' },
});
assertEqual(tempHpDuration.event?.type, 'effect_patch', 'PV temporario com duracao gera effect_patch autoritativo');
assertEqual(tempHpDurationEngine.getProjection('s1')?.players.p1.tempHp, 7, 'PV temporario com duracao entra pelo mesmo evento');
assertEqual(tempHpDurationEngine.getProjection('s1')?.players.p1.activeEffects.some((effect) => effect.effectId === 'temp_hp_duration_1:temp_hp'), true, 'PV temporario com duracao cria efeito ativo');
tempHpDurationEngine.applyCommand({
  type: 'advance_turn',
  commandId: 'advance_temp_hp_duration_1',
  sessionId: 's1',
  actorKey: 'master',
  unit: 'turn',
});
assertEqual(tempHpDurationEngine.getProjection('s1')?.players.p1.tempHp, 0, 'advance_turn expira PV temporario criado pelo comando');
const staleTempDurationSnapshot = tempHpDurationEngine.applySnapshot({
  sessionId: 's1',
  serverSeq: 1,
  state: {
    ...baseState(),
    players: [{ ...baseState().players[0], tempHp: 7, effects: [{ id: 'temp_hp_duration_1:temp_hp', name: 'PV temporario', target: 'PV_TEMP', value: 7, kind: 'temp_hp', remaining: 1, unit: 'turn' }] }],
  },
});
assertEqual(staleTempDurationSnapshot.applied, false, 'snapshot antigo apos efeito expirado nao reativa PV temporario do comando');
assertEqual(tempHpDurationEngine.getProjection('s1')?.players.p1.tempHp, 0, 'snapshot antigo nao reativa PV temporario expirado');

const staleAfterTempHp = engine.applySnapshot({
  sessionId: 's1',
  serverSeq: 1,
  state: {
    ...baseState(),
    players: [{ ...baseState().players[0], tempHp: 5, effects: [{ id: 'temp_hp_effect_1', name: 'PV temporario', target: 'PV_TEMP', value: 5, kind: 'temp_hp', remaining: 1, unit: 'turn' }] }],
  },
});
assertEqual(staleAfterTempHp.applied, false, 'snapshot antigo apos expiracao nao reimporta PV temporario');
assertEqual(engine.getProjection('s1')?.players.p1.tempHp, 0, 'snapshot antigo nao restaura PV temporario');

engine.applyCommand({
  type: 'apply_effect',
  commandId: 'for_1',
  sessionId: 's1',
  actorKey: 'master',
  targetKey: 'p1',
  effect: {
    id: 'for_1',
    name: 'Ajuste de FOR',
    kind: 'stat',
    target: 'FOR',
    value: 2,
    remaining: 1,
    unit: 'turn',
  },
});
assertEqual(engine.getProjection('s1')?.players.p1.effectiveStats.FOR, 17, 'FOR temporario soma na projection');
engine.applyCommand({
  type: 'advance_turn',
  commandId: 'advance_for',
  sessionId: 's1',
  actorKey: 'master',
  unit: 'turn',
});
assertEqual(engine.getProjection('s1')?.players.p1.effectiveStats.FOR, 15, 'FOR volta ao normal ao expirar');

const statAdjustmentEngine = new LanGameEngine();
statAdjustmentEngine.ensureProjection('stat_adjustment_1', baseState());
statAdjustmentEngine.applyCommand({
  type: 'apply_effect',
  commandId: 'permanent_int_1',
  sessionId: 'stat_adjustment_1',
  actorKey: 'master',
  targetKey: 'p1',
  effect: {
    id: 'permanent_int_1',
    name: 'Ajuste permanente de INT',
    kind: 'stat',
    target: 'INT',
    value: 1,
    remaining: 0,
    unit: 'permanent',
    isPermanent: true,
    visibleToPlayer: true,
  },
});
assertEqual(statAdjustmentEngine.getProjection('stat_adjustment_1')?.players.p1.baseStats.INT, 9, 'ajuste permanente de INT +1 altera baseStats INT');
assertEqual(statAdjustmentEngine.getProjection('stat_adjustment_1')?.players.p1.effectiveStats.INT, 9, 'ajuste permanente de INT +1 recalcula effectiveStats INT');
assertEqual(statAdjustmentEngine.getProjection('stat_adjustment_1')?.players.p1.activeEffects.some((effect) => effect.name === 'Ajuste permanente de INT'), false, 'ajuste permanente nao entra em activeEffects');
assertEqual(getVisibleEffects(statAdjustmentEngine.getProjection('stat_adjustment_1')?.players.p1.activeEffects as any).some((effect: any) => effect.name === 'Ajuste permanente de INT'), false, 'ajuste permanente nao aparece como efeito visual');

statAdjustmentEngine.applyCommand({
  type: 'apply_effect',
  commandId: 'legacy_permanent_int_buff_1',
  sessionId: 'stat_adjustment_1',
  actorKey: 'master',
  targetKey: 'p1',
  effect: {
    id: 'legacy_permanent_int_buff_1',
    name: 'Ajuste permanente legado de INT',
    kind: 'buff',
    target: 'INT',
    value: 1,
    remaining: 0,
    unit: 'permanent',
    isPermanent: true,
    visibleToPlayer: true,
    color: '#00fa9a',
  },
});
assertEqual(statAdjustmentEngine.getProjection('stat_adjustment_1')?.players.p1.baseStats.INT, 10, 'ajuste permanente legado/buff tambem altera baseStats INT');
assertEqual(statAdjustmentEngine.getProjection('stat_adjustment_1')?.players.p1.activeEffects.some((effect) => effect.name === 'Ajuste permanente legado de INT'), false, 'ajuste permanente legado/buff nao vira activeEffect');
assertEqual(getVisibleEffects(statAdjustmentEngine.getProjection('stat_adjustment_1')?.players.p1.activeEffects as any).some((effect: any) => effect.name === 'Ajuste permanente legado de INT'), false, 'ajuste permanente legado/buff nao vira efeito visual');

statAdjustmentEngine.applyCommand({
  type: 'apply_effect',
  commandId: 'temporary_int_1',
  sessionId: 'stat_adjustment_1',
  actorKey: 'master',
  targetKey: 'p1',
  effect: {
    id: 'temporary_int_1',
    name: 'Ajuste temporario de INT',
    kind: 'stat',
    target: 'INT',
    value: 1,
    remaining: 1,
    unit: 'turn',
    color: '#00bfff',
  },
});
assertEqual(statAdjustmentEngine.getProjection('stat_adjustment_1')?.players.p1.effectiveStats.INT, 11, 'ajuste temporario de INT soma em effectiveStats');
assertEqual(statAdjustmentEngine.getProjection('stat_adjustment_1')?.players.p1.activeEffects.some((effect) => effect.effectId === 'temporary_int_1'), true, 'ajuste temporario entra em activeEffects');
statAdjustmentEngine.applyCommand({
  type: 'advance_turn',
  commandId: 'advance_temporary_int_1',
  sessionId: 'stat_adjustment_1',
  actorKey: 'master',
  unit: 'turn',
});
assertEqual(statAdjustmentEngine.getProjection('stat_adjustment_1')?.players.p1.activeEffects.some((effect) => effect.effectId === 'temporary_int_1'), false, 'ajuste temporario de INT expira');
assertEqual(statAdjustmentEngine.getProjection('stat_adjustment_1')?.players.p1.baseStats.INT, 10, 'valor permanente continua aplicado apos expirar temporario');
assertEqual(statAdjustmentEngine.getProjection('stat_adjustment_1')?.players.p1.effectiveStats.INT, 10, 'effectiveStats preserva permanente apos expirar temporario');

statAdjustmentEngine.applyCommand({
  type: 'apply_effect',
  commandId: 'paralyzed_1',
  sessionId: 'stat_adjustment_1',
  actorKey: 'master',
  targetKey: 'p1',
  effect: {
    id: 'paralyzed_1',
    name: 'Paralisado',
    kind: 'status',
    target: 'custom',
    value: 0,
    remaining: 3,
    unit: 'turn',
    color: '#6c63ff',
    secondaryColor: '#8be9fd',
  },
});
assertEqual(statAdjustmentEngine.getProjection('stat_adjustment_1')?.players.p1.activeEffects.some((effect) => effect.effectId === 'paralyzed_1'), true, 'condicao Paralisado entra em activeEffects');
assertEqual(getVisibleEffects(statAdjustmentEngine.getProjection('stat_adjustment_1')?.players.p1.activeEffects as any).some((effect: any) => effect.effectId === 'paralyzed_1' && effect.color === '#6c63ff'), true, 'condicao Paralisado mantem dados visuais');
for (let i = 0; i < 3; i += 1) {
  statAdjustmentEngine.applyCommand({
    type: 'advance_turn',
    commandId: `advance_paralyzed_${i}`,
    sessionId: 'stat_adjustment_1',
    actorKey: 'master',
    unit: 'turn',
  });
}
assertEqual(statAdjustmentEngine.getProjection('stat_adjustment_1')?.players.p1.activeEffects.some((effect) => effect.effectId === 'paralyzed_1'), false, 'Paralisado expira e nao volta');

const lifecycleEngine = new LanGameEngine();
lifecycleEngine.ensureProjection('s1', baseState());
lifecycleEngine.applyCommand({
  type: 'pause_session',
  commandId: 'pause_session_1',
  sessionId: 's1',
  actorKey: 'master',
});
assertEqual(lifecycleEngine.getProjection('s1')?.status, 'paused', 'pause_session pausa a projection');
lifecycleEngine.applyCommand({
  type: 'resume_session',
  commandId: 'resume_session_1',
  sessionId: 's1',
  actorKey: 'master',
});
assertEqual(lifecycleEngine.getProjection('s1')?.status, 'active', 'resume_session retoma a projection');
lifecycleEngine.applyCommand({
  type: 'end_session',
  commandId: 'end_session_1',
  sessionId: 's1',
  actorKey: 'master',
});
assertEqual(lifecycleEngine.getProjection('s1')?.status, 'ended', 'end_session encerra a projection');
const oldActiveAfterEnd = lifecycleEngine.applySnapshot({
  sessionId: 's1',
  serverSeq: 1,
  state: baseState(),
});
assertEqual(oldActiveAfterEnd.applied, false, 'snapshot antigo nao reativa sessao encerrada');
assertEqual(lifecycleEngine.getProjection('s1')?.status, 'ended', 'sessao encerrada permanece ended apos snapshot antigo');

engine.applyCommand({
  type: 'apply_damage',
  commandId: 'damage_before_potion',
  sessionId: 's1',
  actorKey: 'master',
  targetKey: 'p1',
  amount: 5,
});
const potionEngine = new LanGameEngine({ projections: [engine.getProjection('s1')!], rng: () => 0 });
const potionResult = potionEngine.applyCommand({
  type: 'consume_item',
  commandId: 'consume_potion_1',
  sessionId: 's1',
  actorKey: 'p1',
  targetKey: 'p1',
  itemInstanceId: 'potion',
  qty: 1,
});
assertEqual(potionResult.applied, true, 'consumo de pocao gera evento de transacao');
assertDeepEqual((potionResult.event?.payload as any).rolls?.[0]?.rolls, [1, 1], 'pocao rola exatamente dois d4 no evento');
assertEqual(potionEngine.getProjection('s1')?.players.p1.hpCurrent, 8, 'pocao cura HP real uma vez');
assertEqual(potionEngine.getProjection('s1')?.players.p1.inventory.bag.find((item) => item.id === 'potion')?.qty, 1, 'pocao reduz quantidade');
const replayPotion = potionEngine.applyAuthoritativeEvent(potionResult.event!);
assertEqual(replayPotion.applied, false, 'replay do mesmo evento nao cura de novo');
assertEqual(potionEngine.getProjection('s1')?.players.p1.hpCurrent, 8, 'replay nao altera HP');

const potionAck = potionEngine.applyAuthoritativeEvent({
  eventId: 'consume_potion_ack_1',
  sessionId: 's1',
  type: 'event_ack',
  aggregateType: 'transaction',
  aggregateId: 'p1',
  aggregateRevision: 999,
  serverSeq: 999,
  createdAt: new Date(0).toISOString(),
  payload: { eventId: potionResult.event?.eventId },
});
assertEqual(potionAck.applied, false, 'ACK duplicado de pocao nao altera projection');
assertEqual(potionEngine.getProjection('s1')?.players.p1.hpCurrent, 8, 'ACK nao cura novamente');

const secondPotion = potionEngine.applyCommand({
  type: 'consume_item',
  commandId: 'consume_potion_2',
  sessionId: 's1',
  actorKey: 'p1',
  targetKey: 'p1',
  itemInstanceId: 'potion',
  qty: 1,
});
assertEqual(secondPotion.applied, true, 'segunda pocao tambem gera transacao');
assertEqual(potionEngine.getProjection('s1')?.players.p1.hpCurrent, 12, 'segunda pocao cura HP real');
assertEqual(Boolean(potionEngine.getProjection('s1')?.players.p1.inventory.bag.find((item) => item.id === 'potion')), false, 'segunda pocao remove item ao zerar quantidade');

const oldPotionSnapshot = potionEngine.applySnapshot({
  sessionId: 's1',
  serverSeq: 1,
  state: baseState(),
});
assertEqual(oldPotionSnapshot.applied, false, 'snapshot antigo apos pocao nao desfaz cura nem item');
assertEqual(Boolean(potionEngine.getProjection('s1')?.players.p1.inventory.bag.find((item) => item.id === 'potion')), false, 'snapshot antigo nao restaura pocao removida');

const equipEngine = new LanGameEngine();
equipEngine.ensureProjection('s1', baseState());
equipEngine.applyCommand({
  type: 'equip_item',
  commandId: 'equip_armor_1',
  sessionId: 's1',
  actorKey: 'p1',
  targetKey: 'p1',
  slot: 'armor',
  itemInstanceId: 'armor',
});
assertEqual(Boolean(equipEngine.getProjection('s1')?.players.p1.inventory.slots.armor), true, 'engine equipa armadura sem estado intermediario');
assertEqual(equipEngine.getProjection('s1')?.players.p1.effectiveStats.CA, 11, 'engine recalcula CA ao equipar armadura');
equipEngine.applyCommand({
  type: 'unequip_item',
  commandId: 'unequip_armor_1',
  sessionId: 's1',
  actorKey: 'p1',
  targetKey: 'p1',
  slot: 'armor',
});
assertEqual(Boolean(equipEngine.getProjection('s1')?.players.p1.inventory.slots.armor), false, 'engine desequipa armadura sem slot intermediario');
assertEqual(Boolean(equipEngine.getProjection('s1')?.players.p1.inventory.bag.find((item) => item.id === 'armor')), true, 'desequipar devolve armadura para bag');
assertEqual(equipEngine.getProjection('s1')?.players.p1.effectiveStats.CA, 10, 'desequipar recalcula CA');
equipEngine.applyCommand({
  type: 'equip_item',
  commandId: 'equip_armor_2',
  sessionId: 's1',
  actorKey: 'p1',
  targetKey: 'p1',
  slot: 'armor',
  itemInstanceId: 'armor',
});
const staleEquipSnapshot = equipEngine.applySnapshot({
  sessionId: 's1',
  serverSeq: 1,
  state: baseState(),
});
assertEqual(staleEquipSnapshot.applied, false, 'snapshot antigo nao remove equipamento');
assertEqual(Boolean(equipEngine.getProjection('s1')?.players.p1.inventory.slots.armor), true, 'projection mantem armadura apos snapshot antigo');

const dardosEngine = new LanGameEngine();
dardosEngine.ensureProjection('s1', baseState());
const dardo = {
  name: '10 Dardos',
  weight: 1.25,
  damage: '1d4',
  damage_type: 'Perfurante',
  properties: 'Arma, Acuidade, Arremesso (6/18m)',
  descricao: 'Pequenos projeteis de arremesso, perfeitos para monges.',
  effect_json: '[]',
};
const singleDardoEngine = new LanGameEngine();
singleDardoEngine.ensureProjection('single_dardo', baseState());
singleDardoEngine.applyCommand({
  type: 'grant_reward',
  commandId: 'grant_single_dardo',
  sessionId: 'single_dardo',
  actorKey: 'master',
  targetKey: 'p1',
  items: [{ ...dardo, id: 'single_dardo_transient', qty: 1 }],
});
const singleDardoStacks = singleDardoEngine.getProjection('single_dardo')?.players.p1.inventory.bag.filter((item) => getInventoryStackKey(item) === getInventoryStackKey(dardo)) || [];
assertEqual(singleDardoStacks.length, 1, 'mestre concede 10 Dardos uma vez e cria um stack');
assertEqual(singleDardoStacks[0]?.qty, 1, 'mestre concede 10 Dardos uma vez com qty 1');
for (let i = 0; i < 5; i += 1) {
  dardosEngine.applyCommand({
    type: 'grant_reward',
    commandId: `grant_dardo_${i}`,
    sessionId: 's1',
    actorKey: 'master',
    targetKey: 'p1',
    items: [{ ...dardo, id: `transient_${i}`, inventoryItemId: `inv_${i}`, qty: 1 }],
    message: 'Mestre entregou 1x 10 Dardos.',
  });
}
const dardosStacks = dardosEngine.getProjection('s1')?.players.p1.inventory.bag.filter((item) => getInventoryStackKey(item) === getInventoryStackKey(dardo)) || [];
assertEqual(dardosStacks.length, 1, 'mestre concede 10 Dardos 5 vezes e vira um unico stack');
assertEqual(dardosStacks[0]?.qty, 5, '10 Dardos soma qty 5 em vez de criar entradas duplicadas');
dardosEngine.applyCommand({
  type: 'grant_reward',
  commandId: 'grant_dardo_stack_reward',
  sessionId: 's1',
  actorKey: 'master',
  targetKey: 'p1',
  items: [{ ...dardo, id: 'reward_transient', qty: 2 }],
});
assertEqual((dardosEngine.getProjection('s1')?.players.p1.inventory.bag.filter((item) => getInventoryStackKey(item) === getInventoryStackKey(dardo)) || [])[0]?.qty, 7, 'grant_reward com item soma stack existente');
const consumeCompactDardo = dardosEngine.applyCommand({
  type: 'consume_item',
  commandId: 'consume_compact_dardo',
  sessionId: 's1',
  actorKey: 'p1',
  targetKey: 'p1',
  itemInstanceId: getInventoryStackKey(dardo),
  qty: 3,
});
assertEqual(consumeCompactDardo.applied, true, 'consumo de item compactado passa pela engine');
assertEqual((dardosEngine.getProjection('s1')?.players.p1.inventory.bag.filter((item) => getInventoryStackKey(item) === getInventoryStackKey(dardo)) || [])[0]?.qty, 4, 'consumo de item ainda reduz qty corretamente apos compactacao');
const dardosQtyMerge = addItemsToInventory({ bag: [{ ...dardo, id: 'dardo_a', qty: 3 }], slots: {} }, [{ ...dardo, id: 'dardo_b', inventoryItemId: 'inv_b', clientMsgId: 'client_b', qty: 2 }]);
const dardosQtyMergeStacks = dardosQtyMerge.bag.filter((item) => getInventoryStackKey(item) === getInventoryStackKey(dardo));
assertEqual(dardosQtyMergeStacks.length, 1, '10 Dardos qty 2 em cima de qty 3 mantem um stack');
assertEqual(dardosQtyMergeStacks[0]?.qty, 5, '10 Dardos qty 2 + qty 3 vira qty 5');
assertEqual(getInventoryStackKey({ ...dardo, id: 'transient_a', inventoryItemId: 'inv_a', clientMsgId: 'msg_a', createdAt: 'ontem' }), getInventoryStackKey({ ...dardo, id: 'transient_b', inventoryItemId: 'inv_b', clientMsgId: 'msg_b', updatedAt: 'hoje' }), 'stack key ignora ids transitorios');
assertEqual(canStackInventoryItem({ ...dardo, id: 'transient_a' }, { ...dardo, id: 'transient_b' }), true, 'canStackInventoryItem aceita ids transitorios diferentes para dardos');
const dardoFire = { ...dardo, effect_json: '[{"kind":"damage","target":"fire","value":1}]' };
assertEqual(canStackInventoryItem(dardo, dardoFire), false, 'stack key separa itens com efeito diferente');
const twoMagicSwords = compactInventoryBag([
  { id: 'sword_a', name: 'Espada Longa +1', type: 'weapon', category: 'weapon', properties: 'Magico', damage: '1d8', effect_json: '[{"kind":"stat","target":"CA","value":1}]', qty: 1 },
  { id: 'sword_b', name: 'Espada Longa +1', type: 'weapon', category: 'weapon', properties: 'Magico', damage: '1d8', effect_json: '[{"kind":"stat","target":"CA","value":1}]', qty: 1 },
]);
assertEqual(twoMagicSwords.length, 2, 'item nao stackavel igual nao e somado indevidamente');

const transferState = baseState();
transferState.players = [
  { ...transferState.players[0], equipment: { bag: [{ ...dardo, id: 'p1_dardo', qty: 2 }], slots: {} } },
  {
    ...transferState.players[0],
    id: 2,
    remoteKey: 'p2',
    characterId: 2,
    sourceCharacterId: 2,
    characterName: 'Alvo',
    equipment: { bag: [{ ...dardo, id: 'p2_dardo', qty: 1 }], slots: {} },
  },
];
const dardosTransferEngine = new LanGameEngine();
dardosTransferEngine.ensureProjection('s1', transferState);
const dardosSendEvent = dardosTransferEngine.applyCommand({
  type: 'send_item',
  commandId: 'send_dardo_1',
  sessionId: 's1',
  actorKey: 'p1',
  fromKey: 'p1',
  toKey: 'p2',
  itemInstanceId: getInventoryStackKey(dardo),
  qty: 1,
});
const p2Dardos = dardosTransferEngine.getProjection('s1')?.players.p2.inventory.bag.filter((item) => getInventoryStackKey(item) === getInventoryStackKey(dardo)) || [];
assertEqual(p2Dardos.length, 1, 'send_item soma ao stack existente do destinatario');
assertEqual(p2Dardos[0]?.qty, 2, 'send_item aumenta qty do stack existente');
const dardosReplaySend = dardosTransferEngine.applyAuthoritativeEvent(dardosSendEvent.event!);
assertEqual(dardosReplaySend.applied, false, 'replay do mesmo send_item nao duplica stack');
assertEqual((dardosTransferEngine.getProjection('s1')?.players.p2.inventory.bag.filter((item) => getInventoryStackKey(item) === getInventoryStackKey(dardo)) || [])[0]?.qty, 2, 'resync duplicado de send_item nao duplica item');
const dardosTradeEvent = dardosTransferEngine.applyCommand({
  type: 'trade_item',
  commandId: 'trade_dardo_1',
  sessionId: 's1',
  actorKey: 'p1',
  fromKey: 'p1',
  toKey: 'p2',
  itemInstanceId: getInventoryStackKey(dardo),
  requestedItemInstanceId: getInventoryStackKey(dardo),
  qty: 1,
  requestedQty: 1,
});
assertEqual((dardosTransferEngine.getProjection('s1')?.players.p1.inventory.bag.filter((item) => getInventoryStackKey(item) === getInventoryStackKey(dardo)) || []).length, 1, 'troca mantem item stackado no jogador origem');
assertEqual((dardosTransferEngine.getProjection('s1')?.players.p2.inventory.bag.filter((item) => getInventoryStackKey(item) === getInventoryStackKey(dardo)) || []).length, 1, 'troca mantem item stackado no jogador destino');
assertEqual(dardosTransferEngine.applyAuthoritativeEvent(dardosTradeEvent.event!).applied, false, 'replay de trade_item nao duplica item');
const dardosBeforeAckInventory = JSON.stringify(dardosTransferEngine.getProjection('s1')?.players.p2.inventory);
dardosTransferEngine.applyAuthoritativeEvent({
  eventId: 'inventory_ack_1',
  sessionId: 's1',
  type: 'event_ack',
  aggregateType: 'inventory',
  aggregateId: 'p2',
  aggregateRevision: 999,
  serverSeq: 999,
  createdAt: new Date(0).toISOString(),
  payload: { inventory: { bag: [{ ...dardo, qty: 99 }], slots: {} } },
});
dardosTransferEngine.applyAuthoritativeEvent({
  eventId: 'inventory_nack_1',
  sessionId: 's1',
  type: 'event_nack',
  aggregateType: 'inventory',
  aggregateId: 'p2',
  aggregateRevision: 1000,
  serverSeq: 1000,
  createdAt: new Date(0).toISOString(),
  payload: { inventory: { bag: [{ ...dardo, qty: 99 }], slots: {} } },
});
dardosTransferEngine.applyAuthoritativeEvent({
  eventId: 'inventory_public_status_1',
  sessionId: 's1',
  type: 'public_status',
  aggregateType: 'inventory',
  aggregateId: 'p2',
  aggregateRevision: 1001,
  serverSeq: 1001,
  createdAt: new Date(0).toISOString(),
  payload: { equipment: { bag: [{ ...dardo, qty: 99 }], slots: {} } },
});
assertEqual(JSON.stringify(dardosTransferEngine.getProjection('s1')?.players.p2.inventory), dardosBeforeAckInventory, 'ACK/NACK/public_status nao alteram inventario');
const staleDardoSnapshot = dardosTransferEngine.applySnapshot({
  sessionId: 's1',
  serverSeq: 1,
  state: transferState,
});
assertEqual(staleDardoSnapshot.applied, false, 'snapshot antigo nao separa stack compactado');
assertEqual((dardosTransferEngine.getProjection('s1')?.players.p2.inventory.bag.filter((item) => getInventoryStackKey(item) === getInventoryStackKey(dardo)) || []).length, 1, 'snapshot antigo nao separa 10 Dardos em linhas duplicadas');

const tempItemEngine = new LanGameEngine();
tempItemEngine.ensureProjection('s1', baseState());
const tempItemConsume = tempItemEngine.applyCommand({
  type: 'consume_item',
  commandId: 'consume_for_potion_1',
  sessionId: 's1',
  actorKey: 'p1',
  targetKey: 'p1',
  itemInstanceId: 'for_potion',
  qty: 1,
});
assertEqual(tempItemConsume.applied, true, 'item com bonus temporario gera transacao');
assertEqual(tempItemEngine.getProjection('s1')?.players.p1.effectiveStats.FOR, 17, 'item temporario aplica bonus de FOR');
assertEqual(Boolean(tempItemEngine.getProjection('s1')?.players.p1.inventory.bag.find((item) => item.id === 'for_potion')), false, 'item temporario consumido sai da bag');
tempItemEngine.applyCommand({
  type: 'advance_turn',
  commandId: 'advance_for_item_1',
  sessionId: 's1',
  actorKey: 'master',
  unit: 'turn',
});
assertEqual(tempItemEngine.getProjection('s1')?.players.p1.effectiveStats.FOR, 15, 'bonus temporario de item expira por turno');
const staleTempItemSnapshot = tempItemEngine.applySnapshot({
  sessionId: 's1',
  serverSeq: 1,
  state: baseState(),
});
assertEqual(staleTempItemSnapshot.applied, false, 'snapshot antigo nao reativa efeito de item expirado');
assertEqual(tempItemEngine.getProjection('s1')?.players.p1.effectiveStats.FOR, 15, 'efeito de item expirado nao volta');

const rebuilt = potionEngine.rebuildFromEvents((potionResult.event ? [potionResult.event] : []));
assertEqual(rebuilt.appliedEventIds.has('consume_potion_1:event'), true, 'reconnect/rebuild aplica evento autoritativo uma vez');

resetLanEngineBridgeForTests();
const bridgeSessionId = 'bridge_1';
const bridgeSnapshot = applyIncomingSnapshot({
  sessionId: bridgeSessionId,
  serverSeq: 1,
  state: baseState(),
});
assertEqual(bridgeSnapshot.applied, true, 'bridge aplica snapshot estrutural inicial');
assertEqual(getLanProjection(bridgeSessionId)?.players.p1.hpCurrent, 9, 'bridge publica projection inicial');

let listenerCalls = 0;
const unsubscribeProjection = subscribeLanProjection(bridgeSessionId, (next) => {
  if (next) listenerCalls += 1;
});
const legacyPlayerPatch = applyIncomingLegacyLanEvent({
  ...event({
    id: 'legacy_hp_1',
    sessionId: bridgeSessionId,
    type: 'player_patch',
    serverSeq: 2,
    entityRevision: 1,
    numberPatch: { hpCurrent: 7, hpMax: 14, tempHp: 0 },
  }),
});
assertEqual(legacyPlayerPatch.applied, true, 'evento legado player_patch entra pelo adapter e vira projection');
assertEqual(getLanProjection(bridgeSessionId)?.players.p1.hpCurrent, 7, 'legacy player_patch altera projection via engine');
const duplicateTransportAndHookPlayerPatch = applyIncomingLegacyLanEvent({
  ...event({
    id: 'legacy_hp_1',
    sessionId: bridgeSessionId,
    type: 'player_patch',
    serverSeq: 2,
    entityRevision: 1,
    numberPatch: { hpCurrent: 3, hpMax: 14, tempHp: 0 },
  }),
});
assertEqual(duplicateTransportAndHookPlayerPatch.applied, false, 'evento duplicado vindo do transporte+hook nao aplica duas vezes');
assertEqual(getLanProjection(bridgeSessionId)?.players.p1.hpCurrent, 7, 'duplicidade transporte+hook nao altera HP novamente');
assertEqual(selectLanProjectionCharacter(getLanProjection(bridgeSessionId), 'p1')?.hpCurrent, 7, 'seletor do hook expõe character da projection');

const effectCountBeforeReconnectEffect = getLanProjection(bridgeSessionId)?.players.p1.activeEffects.length || 0;
applyIncomingLegacyLanEvent({
  ...event({
    id: 'legacy_fx_1',
    sessionId: bridgeSessionId,
    type: 'effect_patch',
    serverSeq: 3,
    entityRevision: 10,
    effectPatch: {
      targetKey: 'p1',
      add: [{ id: 'bridge_for', name: 'FOR bridge', target: 'FOR', value: 2, kind: 'stat', remaining: 1, unit: 'turn' }],
      update: [],
      remove: [],
    },
  }),
});
const afterEffectLegacyPlayerPatch = applyIncomingLegacyLanEvent({
  ...event({
    id: 'legacy_hp_2',
    sessionId: bridgeSessionId,
    type: 'player_patch',
    serverSeq: 4,
    entityRevision: 2,
    numberPatch: { hpCurrent: 6, hpMax: 14, tempHp: 0 },
  }),
});
assertEqual(afterEffectLegacyPlayerPatch.applied, true, 'effect_patch legado nao bloqueia player_patch com revisao menor de player');
assertEqual(getLanProjection(bridgeSessionId)?.players.p1.hpCurrent, 6, 'player revision separada continua aplicando HP');

const beforePublicStatusHp = getLanProjection(bridgeSessionId)?.players.p1.hpCurrent;
const publicStatus = applyIncomingLegacyLanEvent({
  ...event({
    id: 'legacy_public_status',
    sessionId: bridgeSessionId,
    type: 'public_status',
    serverSeq: 5,
    entityRevision: 1781179979051,
    toKey: 'all',
    publicState: { hpCurrent: 1, hpMax: 14, tempHp: 9, level: 1 },
  }),
});
assertEqual(publicStatus.applied, false, 'public_status nao altera gameplay');
assertEqual(getLanProjection(bridgeSessionId)?.players.p1.hpCurrent, beforePublicStatusHp, 'public_status nao altera HP da projection');

const ackResult = applyIncomingLanEvent({
  eventId: 'ack_1',
  sessionId: bridgeSessionId,
  type: 'event_ack',
  aggregateType: 'player',
  aggregateId: 'p1',
  aggregateRevision: 999,
  serverSeq: 6,
  createdAt: new Date(0).toISOString(),
  payload: { eventId: 'legacy_hp_2' },
});
assertEqual(ackResult.applied, false, 'ACK duplicado/transporte nao altera projection');
assertEqual(getLanProjection(bridgeSessionId)?.players.p1.hpCurrent, beforePublicStatusHp, 'ACK nao altera ficha');
const nackResult = applyIncomingLanEvent({
  eventId: 'nack_1',
  sessionId: bridgeSessionId,
  type: 'event_nack',
  aggregateType: 'player',
  aggregateId: 'p1',
  aggregateRevision: 1000,
  serverSeq: 7,
  createdAt: new Date(0).toISOString(),
  payload: { eventId: 'legacy_hp_2', reason: 'teste' },
});
assertEqual(nackResult.applied, false, 'NACK/transporte nao altera projection');
assertEqual(getLanProjection(bridgeSessionId)?.players.p1.hpCurrent, beforePublicStatusHp, 'NACK nao altera ficha');

const staleBridgeSnapshot = applyIncomingSnapshot({
  sessionId: bridgeSessionId,
  serverSeq: 1,
  state: {
    ...baseState(),
    players: [{ ...baseState().players[0], hpCurrent: 14, effects: [{ id: 'bridge_for', name: 'FOR bridge', target: 'FOR', value: 2, kind: 'stat', remaining: 1, unit: 'turn' }] }],
  },
});
assertEqual(staleBridgeSnapshot.applied, false, 'snapshot antigo entra pela bridge e e ignorado pela engine');
assertEqual(getLanProjection(bridgeSessionId)?.players.p1.hpCurrent, beforePublicStatusHp, 'snapshot antigo nao volta HP');
assertEqual(listenerCalls > 0, true, 'subscribeLanProjection recebe projection publicada');
unsubscribeProjection();

const bridgePotion = dispatchMasterCommand({
  type: 'apply_damage',
  commandId: 'bridge_damage',
  sessionId: bridgeSessionId,
  actorKey: 'master',
  targetKey: 'p1',
  amount: 1,
});
assertEqual(bridgePotion.applied, true, 'dispatchMasterCommand usa engine real');
assertEqual(getLanProjection(bridgeSessionId)?.players.p1.hpCurrent, 5, 'dispatchMasterCommand atualiza projection');

const bridgePlayerPotion = dispatchPlayerCommand({
  type: 'consume_item',
  commandId: 'bridge_player_consume_potion',
  sessionId: bridgeSessionId,
  actorKey: 'p1',
  targetKey: 'p1',
  itemInstanceId: 'potion',
  qty: 1,
});
assertEqual(bridgePlayerPotion.applied, true, 'dispatchPlayerCommand(consume_item) usa engine real');
assertEqual((bridgePlayerPotion.event?.payload as any).rolls?.[0]?.rolls?.length, 2, 'dispatchPlayerCommand rola dois d4 para pocao');
assertEqual(getLanProjection(bridgeSessionId)?.players.p1.inventory.bag.find((item) => item.id === 'potion')?.qty, 1, 'dispatchPlayerCommand reduz pocao 2 para 1');
const hpAfterPotion = getLanProjection(bridgeSessionId)?.players.p1.hpCurrent;
if (!bridgePlayerPotion.event) throw new Error('consume_item deveria gerar evento autoritativo para teste de reconnect.');
const duplicatePotionAfterReconnect = applyIncomingLanEvent(bridgePlayerPotion.event);
assertEqual(duplicatePotionAfterReconnect.applied, false, 'pocao consumida antes do lock/reconnect nao cura duas vezes');
assertEqual(getLanProjection(bridgeSessionId)?.players.p1.hpCurrent, hpAfterPotion, 'reconnect nao reaplica cura da pocao');

const bridgePlayerEquip = dispatchPlayerCommand({
  type: 'equip_item',
  commandId: 'bridge_player_equip_armor',
  sessionId: bridgeSessionId,
  actorKey: 'p1',
  targetKey: 'p1',
  slot: 'armor',
  itemInstanceId: 'armor',
});
assertEqual(bridgePlayerEquip.applied, true, 'dispatchPlayerCommand(equip_item) usa engine real');
assertEqual(Boolean(getLanProjection(bridgeSessionId)?.players.p1.inventory.slots.armor), true, 'dispatchPlayerCommand equipa armadura');
applyIncomingLegacyLanEvent({
  ...event({
    id: 'bridge_effect_after_equip',
    sessionId: bridgeSessionId,
    type: 'effect_patch',
    serverSeq: Date.now() + 20,
    entityRevision: 11,
    effectPatch: {
      targetKey: 'p1',
      add: [{ id: 'bridge_reconnect_for', name: 'FOR reconnect', target: 'FOR', value: 2, kind: 'stat', remaining: 1, unit: 'turn' }],
      update: [],
      remove: [],
    },
  }),
});
const effectCountAfterReconnectEffect = getLanProjection(bridgeSessionId)?.players.p1.activeEffects.length || 0;
const hpBeforeReconnectSnapshot = getLanProjection(bridgeSessionId)?.players.p1.hpCurrent;
const staleAfterReconnectSnapshot = applyIncomingSnapshot({
  sessionId: bridgeSessionId,
  serverSeq: 1,
  state: {
    ...baseState(),
    players: [{
      ...baseState().players[0],
      hpCurrent: 14,
      equipment: baseState().players[0].equipment,
      effects: [],
    }],
  },
});
assertEqual(staleAfterReconnectSnapshot.applied, false, 'snapshot antigo apos reconnect nao sobrescreve projection viva');
assertEqual(getLanProjection(bridgeSessionId)?.players.p1.hpCurrent, hpBeforeReconnectSnapshot, 'snapshot antigo apos reconnect nao volta HP');
assertEqual(Boolean(getLanProjection(bridgeSessionId)?.players.p1.inventory.slots.armor), true, 'snapshot antigo apos reconnect nao remove equipamento');
assertEqual(effectCountAfterReconnectEffect > effectCountBeforeReconnectEffect, true, 'efeito de reconnect foi aplicado antes do snapshot antigo');
assertEqual(getLanProjection(bridgeSessionId)?.players.p1.activeEffects.length, effectCountAfterReconnectEffect, 'snapshot antigo apos reconnect nao remove efeito');

dispatchMasterCommand({
  type: 'pause_session',
  commandId: 'bridge_pause',
  sessionId: bridgeSessionId,
  actorKey: 'master',
});
assertEqual(getLanProjection(bridgeSessionId)?.status, 'paused', 'dispatchMasterCommand pausa sessao no bridge');
dispatchMasterCommand({
  type: 'resume_session',
  commandId: 'bridge_resume',
  sessionId: bridgeSessionId,
  actorKey: 'master',
});
assertEqual(getLanProjection(bridgeSessionId)?.status, 'active', 'dispatchMasterCommand retoma sessao no bridge');
dispatchMasterCommand({
  type: 'end_session',
  commandId: 'bridge_end',
  sessionId: bridgeSessionId,
  actorKey: 'master',
});
assertEqual(getLanProjection(bridgeSessionId)?.status, 'ended', 'dispatchMasterCommand encerra sessao no bridge');

const structuralSnapshot = legacyPayloadToLanSnapshot({
  type: 'ficha-dnd-lan-session',
  version: 1,
  createdAt: new Date(0).toISOString(),
  session: { id: 'payload_adapter_1', name: 'Mesa', masterName: 'Mestre', level: 1, allowExisting: true, inviteCode: 'ABC' },
  catalog: {} as any,
  state: baseState(),
  events: [],
});
assertEqual(structuralSnapshot.structural, true, 'legacyPayloadToLanSnapshot cria snapshot estrutural sem versoes confiaveis');

resetLanEngineBridgeForTests();
applyIncomingSnapshot({
  sessionId: 'adapter_live',
  serverSeq: 1,
  state: baseState(),
});
applyIncomingLegacyLanEvent({
  ...event({
    id: 'adapter_damage_1',
    sessionId: 'adapter_live',
    type: 'player_patch',
    serverSeq: 2,
    entityRevision: 1,
    numberPatch: { hpCurrent: 4, hpMax: 14, tempHp: 0 },
  }),
});
applyIncomingLegacyLanEvent({
  ...event({
    id: 'adapter_effect_1',
    sessionId: 'adapter_live',
    type: 'effect_patch',
    serverSeq: 3,
    entityRevision: 1,
    effectPatch: {
      targetKey: 'p1',
      add: [{ id: 'adapter_for', name: 'FOR adapter', target: 'FOR', value: 2, kind: 'stat', remaining: 1, unit: 'turn' }],
      update: [],
      remove: [],
    },
  }),
});
applyIncomingLegacyLanEvent({
  ...event({
    id: 'adapter_remove_effect_1',
    sessionId: 'adapter_live',
    type: 'effect_patch',
    serverSeq: 4,
    entityRevision: 2,
    effectPatch: {
      targetKey: 'p1',
      add: [],
      update: [],
      remove: ['adapter_for'],
    },
  }),
});
const oldPayloadSnapshot = legacyPayloadToLanSnapshot({
  type: 'ficha-dnd-lan-session',
  version: 1,
  createdAt: new Date(0).toISOString(),
  session: { id: 'adapter_live', name: 'Mesa', masterName: 'Mestre', level: 1, allowExisting: true, inviteCode: 'ABC' },
  catalog: {} as any,
  state: {
    ...baseState(),
    players: [{ ...baseState().players[0], hpCurrent: 14, effects: [{ id: 'adapter_for', name: 'FOR adapter', target: 'FOR', value: 2, kind: 'stat', remaining: 1, unit: 'turn' }] }],
  },
  events: [],
}, { source: 'payload_update', structural: true, snapshotSeq: 1 });
const oldPayloadResult = applyIncomingSnapshot(oldPayloadSnapshot);
assertEqual(oldPayloadResult.applied, false, 'snapshot estrutural antigo via adapter nao sobrescreve HP vivo');
assertEqual(getLanProjection('adapter_live')?.players.p1.hpCurrent, 4, 'snapshot estrutural nao volta HP');
assertEqual(getLanProjection('adapter_live')?.players.p1.activeEffects.some((effect) => effect.effectId === 'adapter_for'), false, 'snapshot estrutural nao restaura efeito removido');

resetLanEngineBridgeForTests();
applyIncomingSnapshot({ sessionId: 'adapter_inventory', serverSeq: 1, state: baseState() });
const inventoryPatch = applyIncomingLegacyLanEvent({
  ...event({
    id: 'adapter_inventory_patch_1',
    sessionId: 'adapter_inventory',
    type: 'inventory_patch',
    serverSeq: 2,
    entityRevision: 1,
    inventoryPatch: {
      targetKey: 'p1',
      equipment: equip1.equipmentAfter,
      action: 'replace',
    },
    statsPatch: equip1.statsAfter,
  }),
});
assertEqual(inventoryPatch.applied, true, 'evento legado inventory_patch entra na engine pelo adapter');
assertEqual(Boolean(getLanProjection('adapter_inventory')?.players.p1.inventory.slots.armor), true, 'inventory_patch altera dominio de inventory');
const staleNoArmorSnapshot = applyIncomingSnapshot(legacyPayloadToLanSnapshot({
  type: 'ficha-dnd-lan-session',
  version: 1,
  createdAt: new Date(0).toISOString(),
  session: { id: 'adapter_inventory', name: 'Mesa', masterName: 'Mestre', level: 1, allowExisting: true, inviteCode: 'ABC' },
  catalog: {} as any,
  state: baseState(),
  events: [],
}, { source: 'session_snapshot', structural: true, snapshotSeq: 1 }));
assertEqual(staleNoArmorSnapshot.applied, false, 'snapshot estrutural antigo nao remove equipamento vivo');
assertEqual(Boolean(getLanProjection('adapter_inventory')?.players.p1.inventory.slots.armor), true, 'armadura continua apos snapshot estrutural antigo');

const duplicateResync = applyIncomingLegacyLanEvent({
  ...event({
    id: 'adapter_inventory_patch_1',
    sessionId: 'adapter_inventory',
    type: 'inventory_patch',
    serverSeq: 2,
    entityRevision: 1,
    inventoryPatch: {
      targetKey: 'p1',
      equipment: baseState().players[0].equipment,
      action: 'replace',
    },
  }),
});
assertEqual(duplicateResync.applied, false, 'resync com evento duplicado nao reaplica inventory/consumo/cura');


const economyEngine = new LanGameEngine();
economyEngine.ensureProjection('eco_1', baseState());
const grantXpResult = economyEngine.applyCommand({
  type: 'grant_xp',
  commandId: 'grant_xp_1',
  sessionId: 'eco_1',
  actorKey: 'master',
  targetKey: 'p1',
  amount: 150,
});
assertEqual(economyEngine.getProjection('eco_1')?.players.p1.xp, 150, 'grant_xp passa pela engine');
assertEqual(grantXpResult.event?.type, 'character_transaction', 'grant_xp gera transacao autoritativa');
const replayGrantXp = economyEngine.applyAuthoritativeEvent(grantXpResult.event!);
assertEqual(replayGrantXp.applied, false, 'replay grant_xp nao duplica XP');
assertEqual(economyEngine.getProjection('eco_1')?.players.p1.xp, 150, 'replay grant_xp mantem XP');
const staleXpSnapshotAfterGrant = economyEngine.applySnapshot({
  sessionId: 'eco_1',
  serverSeq: 1,
  state: baseState(),
});
assertEqual(staleXpSnapshotAfterGrant.applied, false, 'snapshot antigo nao reverte XP concedido');
assertEqual(economyEngine.getProjection('eco_1')?.players.p1.xp, 150, 'snapshot antigo nao volta grant_xp');
economyEngine.applyCommand({
  type: 'set_xp',
  commandId: 'set_xp_1',
  sessionId: 'eco_1',
  actorKey: 'master',
  targetKey: 'p1',
  amount: 75,
});
assertEqual(economyEngine.getProjection('eco_1')?.players.p1.xp, 75, 'set_xp passa pela engine');
const addCoinsResult = economyEngine.applyCommand({
  type: 'add_coins',
  commandId: 'add_coins_1',
  sessionId: 'eco_1',
  actorKey: 'master',
  targetKey: 'p1',
  coins: { gp: 2, sp: 3, cp: 4 },
});
assertDeepEqual(economyEngine.getProjection('eco_1')?.players.p1.coins, { gp: 12, sp: 3, cp: 4 }, 'add_coins soma moedas pela engine');
assertEqual(addCoinsResult.event?.type, 'character_transaction', 'add_coins gera transacao autoritativa');
const replayAddCoins = economyEngine.applyAuthoritativeEvent(addCoinsResult.event!);
assertEqual(replayAddCoins.applied, false, 'replay add_coins nao duplica moedas');
assertDeepEqual(economyEngine.getProjection('eco_1')?.players.p1.coins, { gp: 12, sp: 3, cp: 4 }, 'replay add_coins mantem moedas');
const staleCoinSnapshotAfterAdd = economyEngine.applySnapshot({
  sessionId: 'eco_1',
  serverSeq: 1,
  state: baseState(),
});
assertEqual(staleCoinSnapshotAfterAdd.applied, false, 'snapshot antigo nao reverte moedas somadas');
assertDeepEqual(economyEngine.getProjection('eco_1')?.players.p1.coins, { gp: 12, sp: 3, cp: 4 }, 'snapshot antigo nao volta add_coins');
economyEngine.applyCommand({
  type: 'set_coins',
  commandId: 'set_coins_1',
  sessionId: 'eco_1',
  actorKey: 'master',
  targetKey: 'p1',
  coins: { gp: 1, sp: 2, cp: 3 },
});
assertDeepEqual(economyEngine.getProjection('eco_1')?.players.p1.coins, { gp: 1, sp: 2, cp: 3 }, 'set_coins fixa moedas pela engine');
const staleEconomy = economyEngine.applySnapshot({
  sessionId: 'eco_1',
  serverSeq: 1,
  state: baseState(),
});
assertEqual(staleEconomy.applied, false, 'snapshot antigo nao reverte XP/moedas');
assertEqual(economyEngine.getProjection('eco_1')?.players.p1.xp, 75, 'snapshot antigo nao volta XP');
assertDeepEqual(economyEngine.getProjection('eco_1')?.players.p1.coins, { gp: 1, sp: 2, cp: 3 }, 'snapshot antigo nao volta moedas');
const duplicateXpCommand = economyEngine.applyCommand({
  type: 'grant_xp',
  commandId: 'grant_xp_1',
  sessionId: 'eco_1',
  actorKey: 'master',
  targetKey: 'p1',
  amount: 999,
});
assertEqual(duplicateXpCommand.applied, false, 'commandId duplicado nao concede XP duas vezes');

const rewardEngine = new LanGameEngine();
rewardEngine.ensureProjection('reward_1', baseState());
rewardEngine.applyCommand({
  type: 'grant_reward',
  commandId: 'grant_reward_1',
  sessionId: 'reward_1',
  actorKey: 'master',
  targetKey: 'p1',
  xp: 40,
  coins: { gp: 3, sp: 2, cp: 1 },
  message: 'Recompensa concedida.',
});
assertEqual(rewardEngine.getProjection('reward_1')?.players.p1.xp, 40, 'grant_reward aplica XP');
assertDeepEqual(rewardEngine.getProjection('reward_1')?.players.p1.coins, { gp: 13, sp: 2, cp: 1 }, 'grant_reward aplica moedas');

const coinRequestEngine = new LanGameEngine();
coinRequestEngine.ensureProjection('coin_req_1', baseState());
coinRequestEngine.applyCommand({
  type: 'request_reward',
  commandId: 'coin_req_1',
  sessionId: 'coin_req_1',
  actorKey: 'p1',
  targetKey: 'p1',
  requestId: 'coin_req_1',
  coins: { gp: 5 },
  message: 'Jogador pediu 5 PO.',
});
assertDeepEqual(coinRequestEngine.getProjection('coin_req_1')?.players.p1.coins, { gp: 10, sp: 0, cp: 0 }, 'pedido de moeda nao altera imediatamente');
assertEqual(coinRequestEngine.getProjection('coin_req_1')?.trades.coin_req_1?.status, 'pending', 'pedido de moeda fica pendente');
coinRequestEngine.applyCommand({
  type: 'grant_reward',
  commandId: 'coin_accept_1',
  sessionId: 'coin_req_1',
  actorKey: 'master',
  targetKey: 'p1',
  requestId: 'coin_req_1',
  coins: { gp: 5 },
  message: 'Mestre aceitou moeda.',
});
assertDeepEqual(coinRequestEngine.getProjection('coin_req_1')?.players.p1.coins, { gp: 15, sp: 0, cp: 0 }, 'mestre aceita pedido de moeda e aplica moedas');
assertEqual(coinRequestEngine.getProjection('coin_req_1')?.trades.coin_req_1?.status, 'committed', 'pedido de moeda sai da lista pendente apos aceite');

const xpRequestEngine = new LanGameEngine();
xpRequestEngine.ensureProjection('xp_req_1', baseState());
xpRequestEngine.applyCommand({
  type: 'request_reward',
  commandId: 'xp_req_1',
  sessionId: 'xp_req_1',
  actorKey: 'p1',
  targetKey: 'p1',
  requestId: 'xp_req_1',
  xp: 25,
  message: 'Jogador pediu XP.',
});
assertEqual(xpRequestEngine.getProjection('xp_req_1')?.players.p1.xp, 0, 'pedido de XP nao altera imediatamente');
xpRequestEngine.applyCommand({
  type: 'grant_reward',
  commandId: 'xp_accept_1',
  sessionId: 'xp_req_1',
  actorKey: 'master',
  targetKey: 'p1',
  requestId: 'xp_req_1',
  xp: 25,
  message: 'Mestre aceitou XP.',
});
assertEqual(xpRequestEngine.getProjection('xp_req_1')?.players.p1.xp, 25, 'mestre aceita pedido de XP e aplica XP');

const partyXpState = (() => {
  const state = baseState();
  return {
    ...state,
    players: [
      state.players[0],
      {
        ...state.players[0],
        id: 2,
        remoteKey: 'p2',
        characterId: 2,
        sourceCharacterId: 2,
        characterName: 'Borin',
        xp: 10,
      },
    ],
  } as any;
})();
const partyXpEngine = new LanGameEngine();
partyXpEngine.ensureProjection('party_xp_1', partyXpState);
const partyXpP1 = partyXpEngine.applyCommand({
  type: 'grant_xp',
  commandId: 'party_xp_p1',
  sessionId: 'party_xp_1',
  actorKey: 'master',
  targetKey: 'p1',
  amount: 50,
});
const partyXpP2 = partyXpEngine.applyCommand({
  type: 'grant_xp',
  commandId: 'party_xp_p2',
  sessionId: 'party_xp_1',
  actorKey: 'master',
  targetKey: 'p2',
  amount: 50,
});
assertEqual(partyXpEngine.getProjection('party_xp_1')?.players.p1.xp, 50, 'distribuir XP aplica uma vez no jogador 1');
assertEqual(partyXpEngine.getProjection('party_xp_1')?.players.p2.xp, 60, 'distribuir XP aplica uma vez no jogador 2');
partyXpEngine.applyAuthoritativeEvent(partyXpP1.event!);
partyXpEngine.applyAuthoritativeEvent(partyXpP2.event!);
assertEqual(partyXpEngine.getProjection('party_xp_1')?.players.p1.xp, 50, 'resync/replay nao reaplica XP do jogador 1');
assertEqual(partyXpEngine.getProjection('party_xp_1')?.players.p2.xp, 60, 'resync/replay nao reaplica XP do jogador 2');

const beforeTransportXp = partyXpEngine.getProjection('party_xp_1')?.players.p1.xp;
const beforeTransportCoins = partyXpEngine.getProjection('party_xp_1')?.players.p1.coins;
partyXpEngine.applyAuthoritativeEvent({
  eventId: 'economy_ack_1',
  sessionId: 'party_xp_1',
  type: 'event_ack',
  aggregateType: 'player',
  aggregateId: 'p1',
  aggregateRevision: 999,
  serverSeq: 999,
  createdAt: new Date(0).toISOString(),
  payload: {},
});
partyXpEngine.applyAuthoritativeEvent({
  eventId: 'economy_nack_1',
  sessionId: 'party_xp_1',
  type: 'event_nack',
  aggregateType: 'player',
  aggregateId: 'p1',
  aggregateRevision: 1000,
  serverSeq: 1000,
  createdAt: new Date(0).toISOString(),
  payload: {},
});
partyXpEngine.applyAuthoritativeEvent({
  eventId: 'economy_public_status_1',
  sessionId: 'party_xp_1',
  type: 'public_status',
  aggregateType: 'player',
  aggregateId: 'p1',
  aggregateRevision: 1001,
  serverSeq: 1001,
  createdAt: new Date(0).toISOString(),
  payload: { xp: 9999, gp: 9999 },
});
assertEqual(partyXpEngine.getProjection('party_xp_1')?.players.p1.xp, beforeTransportXp, 'ACK/NACK/public_status nao alteram XP');
assertDeepEqual(partyXpEngine.getProjection('party_xp_1')?.players.p1.coins, beforeTransportCoins, 'ACK/NACK/public_status nao alteram moedas');

function twoPlayerState() {
  const state = baseState();
  return {
    ...state,
    players: [
      state.players[0],
      {
        ...state.players[0],
        id: 2,
        remoteKey: 'p2',
        characterId: 2,
        sourceCharacterId: 2,
        characterName: 'Borin',
        hpCurrent: 11,
        equipment: {
          bag: [
            { id: 'rope', name: 'Corda', qty: 1 },
            { id: 'gem', name: 'Gema', qty: 1 },
          ],
          slots: {},
        },
      },
    ],
  } as any;
}

const transferEngine = new LanGameEngine();
transferEngine.ensureProjection('trade_1', twoPlayerState());
const sendEvent = transferEngine.applyCommand({
  type: 'send_item',
  commandId: 'send_item_1',
  sessionId: 'trade_1',
  actorKey: 'p1',
  fromKey: 'p1',
  toKey: 'p2',
  itemInstanceId: 'potion',
  qty: 1,
});
assertEqual(sendEvent.applied, true, 'send_item gera transacao pela engine');
assertEqual(transferEngine.getProjection('trade_1')?.players.p1.inventory.bag.find((item) => item.id === 'potion')?.qty, 1, 'send_item remove somente a quantidade enviada do remetente');
assertEqual(transferEngine.getProjection('trade_1')?.players.p2.inventory.bag.find((item) => item.id === 'potion')?.qty, 1, 'send_item adiciona item ao destino');
const replaySend = transferEngine.applyAuthoritativeEvent(sendEvent.event!);
assertEqual(replaySend.applied, false, 'replay de envio/doacao nao duplica item');
assertEqual(transferEngine.getProjection('trade_1')?.players.p2.inventory.bag.find((item) => item.id === 'potion')?.qty, 1, 'replay de send_item nao duplica destino');

const donateEvent = transferEngine.applyCommand({
  type: 'donate_item',
  commandId: 'donate_item_1',
  sessionId: 'trade_1',
  actorKey: 'p2',
  fromKey: 'p2',
  toKey: 'p1',
  itemInstanceId: 'rope',
  qty: 1,
});
assertEqual(donateEvent.applied, true, 'donate_item passa pela engine');
assertEqual(Boolean(transferEngine.getProjection('trade_1')?.players.p2.inventory.bag.find((item) => item.id === 'rope')), false, 'donate_item remove item do doador');
assertEqual(Boolean(transferEngine.getProjection('trade_1')?.players.p1.inventory.bag.find((item) => item.id === 'rope')), true, 'donate_item adiciona item ao recebedor');

const insufficientDonateEngine = new LanGameEngine();
insufficientDonateEngine.ensureProjection('donate_fail_1', twoPlayerState());
const beforeInsufficientDonate = JSON.stringify(insufficientDonateEngine.getProjection('donate_fail_1')?.players);
try {
  insufficientDonateEngine.applyCommand({
    type: 'donate_item',
    commandId: 'donate_item_fail_1',
    sessionId: 'donate_fail_1',
    actorKey: 'p2',
    fromKey: 'p2',
    toKey: 'p1',
    itemInstanceId: 'rope',
    qty: 99,
  });
  throw new Error('doacao insuficiente deveria falhar');
} catch (error) {
  assertEqual(String(error instanceof Error ? error.message : error).includes('Quantidade insuficiente'), true, 'doacao com quantidade insuficiente falha');
}
assertEqual(JSON.stringify(insufficientDonateEngine.getProjection('donate_fail_1')?.players), beforeInsufficientDonate, 'doacao insuficiente nao altera ninguem');

const tradeEngine = new LanGameEngine();
tradeEngine.ensureProjection('trade_2', twoPlayerState());
const tradeResult = tradeEngine.applyCommand({
  type: 'trade_item',
  commandId: 'trade_item_1',
  sessionId: 'trade_2',
  actorKey: 'p1',
  fromKey: 'p1',
  toKey: 'p2',
  itemInstanceId: 'armor',
  requestedItemInstanceId: 'gem',
  qty: 1,
  requestedQty: 1,
});
assertEqual(tradeResult.applied, true, 'trade_item gera transacao atomica');
assertEqual(Boolean(tradeEngine.getProjection('trade_2')?.players.p1.inventory.bag.find((item) => item.id === 'armor')), false, 'troca remove item ofertado do jogador 1');
assertEqual(Boolean(tradeEngine.getProjection('trade_2')?.players.p2.inventory.bag.find((item) => item.id === 'armor')), true, 'troca adiciona item ofertado ao jogador 2');
assertEqual(Boolean(tradeEngine.getProjection('trade_2')?.players.p2.inventory.bag.find((item) => item.id === 'gem')), false, 'troca remove item pedido do jogador 2');
assertEqual(Boolean(tradeEngine.getProjection('trade_2')?.players.p1.inventory.bag.find((item) => item.id === 'gem')), true, 'troca adiciona item pedido ao jogador 1');

const tradeFailEngine = new LanGameEngine();
tradeFailEngine.ensureProjection('trade_fail_1', twoPlayerState());
const beforeTradeFail = JSON.stringify(tradeFailEngine.getProjection('trade_fail_1')?.players);
try {
  tradeFailEngine.applyCommand({
    type: 'trade_item',
    commandId: 'trade_fail_1',
    sessionId: 'trade_fail_1',
    actorKey: 'p1',
    fromKey: 'p1',
    toKey: 'p2',
    itemInstanceId: 'armor',
    requestedItemInstanceId: 'gem',
    qty: 1,
    requestedQty: 99,
  });
  throw new Error('troca insuficiente deveria falhar');
} catch (error) {
  assertEqual(String(error instanceof Error ? error.message : error).includes('Quantidade insuficiente'), true, 'troca falha atomicamente se um lado nao tem item');
}
assertEqual(JSON.stringify(tradeFailEngine.getProjection('trade_fail_1')?.players), beforeTradeFail, 'troca falha sem alterar nenhum inventario');

const saveEngine = new LanGameEngine();
saveEngine.ensureProjection('save_1', baseState());
const pendingSave = saveEngine.applyCommand({
  type: 'apply_pending_save',
  commandId: 'pending_save_1',
  sessionId: 'save_1',
  actorKey: 'master',
  targetKey: 'p1',
  saveId: 'save_poison_1',
  ability: 'CON',
  dc: 12,
  sourceName: 'Veneno',
});
assertEqual(pendingSave.applied, true, 'pedido de save passa pela engine');
assertEqual(saveEngine.getProjection('save_1')?.pendingSaves.save_poison_1.status, 'pending', 'pedido de save aparece na projection');
const duplicateSave = saveEngine.applyAuthoritativeEvent(pendingSave.event!);
assertEqual(duplicateSave.applied, false, 'pedido de save duplicado nao duplica alerta');
assertEqual(Object.keys(saveEngine.getProjection('save_1')?.pendingSaves || {}).length, 1, 'projection mantem um unico alerta pendente');
saveEngine.applyCommand({
  type: 'apply_effect',
  commandId: 'save_effect_1',
  sessionId: 'save_1',
  actorKey: 'master',
  targetKey: 'p1',
  effect: { id: 'poison_effect_1', name: 'Envenenado', kind: 'status', target: 'custom', value: 0, remaining: 10, unit: 'turn' },
});
const resolveSave = saveEngine.applyCommand({
  type: 'resolve_pending_save',
  commandId: 'resolve_save_1',
  sessionId: 'save_1',
  actorKey: 'master',
  targetKey: 'p1',
  saveId: 'save_poison_1',
  passed: true,
  removeEffectIds: ['poison_effect_1'],
});
assertEqual(resolveSave.applied, true, 'resolucao de save passa pela engine');
assertEqual(saveEngine.getProjection('save_1')?.pendingSaves.save_poison_1.status, 'success', 'resolucao de save remove estado pendente');
assertEqual(saveEngine.getProjection('save_1')?.players.p1.activeEffects.some((effect) => effect.effectId === 'poison_effect_1'), false, 'resolucao de save remove efeito vinculado');
const staleSaveSnapshot = saveEngine.applySnapshot({ sessionId: 'save_1', serverSeq: 1, state: baseState() });
assertEqual(staleSaveSnapshot.applied, false, 'snapshot antigo nao reabre save resolvido');
assertEqual(saveEngine.getProjection('save_1')?.pendingSaves.save_poison_1.status, 'success', 'save resolvido permanece resolvido apos snapshot antigo');

const spellEngine = new LanGameEngine({ rng: () => 0 });
spellEngine.ensureProjection('spell_1', baseState());
spellEngine.applyCommand({ type: 'apply_damage', commandId: 'spell_damage_setup', sessionId: 'spell_1', actorKey: 'master', targetKey: 'p1', amount: 4 });
const spellHeal = spellEngine.applyCommand({
  type: 'use_spell',
  commandId: 'spell_heal_1',
  sessionId: 'spell_1',
  actorKey: 'p1',
  targetKey: 'p1',
  spellName: 'Curar Ferimentos',
  mode: 'heal',
  formula: '1d8+2',
});
assertEqual(spellHeal.applied, true, 'magia de cura passa pela engine');
assertEqual(spellEngine.getProjection('spell_1')?.players.p1.hpCurrent, 8, 'magia de cura altera HP pela projection');
const spellDamage = spellEngine.applyCommand({
  type: 'use_spell',
  commandId: 'spell_damage_1',
  sessionId: 'spell_1',
  actorKey: 'p1',
  targetKey: 'p1',
  spellName: 'Misseis Magicos',
  mode: 'damage',
  amount: 3,
});
assertEqual(spellDamage.applied, true, 'magia de dano passa pela engine');
assertEqual(spellEngine.getProjection('spell_1')?.players.p1.hpCurrent, 5, 'magia de dano altera HP pela projection');
const spellEffect = spellEngine.applyCommand({
  type: 'use_spell',
  commandId: 'spell_effect_1',
  sessionId: 'spell_1',
  actorKey: 'p1',
  targetKey: 'p1',
  spellName: 'Bencao',
  mode: 'effect',
  effects: [{ id: 'bless_1', name: 'Bencao', kind: 'stat', target: 'SAB', value: 1, remaining: 1, unit: 'turn' }],
  save: { enabled: true, id: 'spell_save_1', ability: 'SAB', dc: 10 },
});
assertEqual(spellEffect.applied, true, 'magia com efeito passa pela engine');
assertEqual(spellEngine.getProjection('spell_1')?.players.p1.effectiveStats.SAB, 13, 'magia com efeito altera stats via projection');
assertEqual(spellEngine.getProjection('spell_1')?.pendingSaves.spell_save_1.status, 'pending', 'magia com save cria alerta na projection');
const replaySpellEffect = spellEngine.applyAuthoritativeEvent(spellEffect.event!);
assertEqual(replaySpellEffect.applied, false, 'replay de magia nao duplica efeito/save');
assertEqual(spellEngine.getProjection('spell_1')?.players.p1.activeEffects.filter((effect) => effect.effectId === 'bless_1').length, 1, 'magia com efeito nao duplica alerta/efeito');

const selfEffectEngine = new LanGameEngine();
selfEffectEngine.ensureProjection('self_effect_1', baseState());
selfEffectEngine.applyCommand({
  type: 'apply_self_effect',
  commandId: 'self_effect_cmd_1',
  sessionId: 'self_effect_1',
  actorKey: 'p1',
  targetKey: 'p1',
  effect: { id: 'self_focus_1', name: 'Foco', kind: 'stat', target: 'INT', value: 1, remaining: 1, unit: 'turn' },
});
assertEqual(selfEffectEngine.getProjection('self_effect_1')?.players.p1.effectiveStats.INT, 9, 'apply_self_effect passa pela engine');

console.log('LAN engine/domain tests passed');
