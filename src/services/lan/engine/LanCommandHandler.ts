import {
  parseUsableDiceFormulaWithContext,
  rollParsedDiceFormula,
} from '../../combat/diceFormulaService';
import { normalizeDomainEffect } from './LanEffectRules';
import {
  addItemsToInventory,
  buildStatsWithDerivedEquipMods,
  consumeItemAtomically,
  equipItemAtomically,
  extractItemHealingFormula,
  getInventoryStackKey,
} from './LanInventoryRules';
import { advanceProjectionTurn } from './LanReducer';
import type {
  CharacterTransactionEvent,
  EffectPatch,
  EquipItemCommand,
  InventoryPatch,
  LanAuthoritativeEvent,
  LanCommand,
  LanCoinState,
  LanPendingSaveProjection,
  LanTradeProjection,
  PlayerPatch,
  SessionProjection,
  UnequipItemCommand,
} from './LanTypes';

export type LanCommandContext = {
  now?: () => string;
  nextEventId?: () => string;
  nextServerSeq: () => number;
  rng?: () => number;
};

export function commandToAuthoritativeEvent(
  projection: SessionProjection,
  command: LanCommand,
  context: LanCommandContext,
): LanAuthoritativeEvent {
  if (projection.appliedCommandIds.has(command.commandId)) {
    throw new Error('Comando duplicado.');
  }
  if (command.sessionId !== projection.sessionId) throw new Error('Comando de outra sessao.');

  const createdAt = context.now?.() || new Date().toISOString();
  const eventId = context.nextEventId?.() || `${command.commandId}:event`;
  const serverSeq = context.nextServerSeq();

  if (command.type === 'apply_damage' || command.type === 'apply_heal' || command.type === 'apply_temp_hp') {
    const target = getTarget(projection, command.targetKey);
    const amount = Math.max(0, Math.floor(Number(command.amount || 0) || 0));
    const patch: PlayerPatch = {};
    if (command.type === 'apply_damage') {
      const absorbed = Math.min(target.tempHp, amount);
      patch.tempHp = target.tempHp - absorbed;
      patch.hpCurrent = Math.max(0, target.hpCurrent - (amount - absorbed));
    } else if (command.type === 'apply_heal') {
      patch.hpCurrent = Math.min(target.hpMax, target.hpCurrent + amount);
    } else {
      patch.tempHp = Math.max(target.tempHp, amount);
      const durationValue = Math.max(0, Math.floor(Number(command.duration?.value || 0) || 0));
      if (durationValue > 0 && command.duration?.unit && command.duration.unit !== 'manual') {
        const effect = normalizeDomainEffect({
          id: `${command.commandId}:temp_hp`,
          name: 'PV temporario',
          kind: 'temp_hp',
          target: 'PV_TEMP',
          value: patch.tempHp,
          remaining: durationValue,
          unit: command.duration.unit,
          sourceType: 'manual',
          sourceId: command.commandId,
        }, { targetKey: command.targetKey });
        return makeEvent({
          projection,
          commandId: command.commandId,
          eventId,
          sessionId: command.sessionId,
          type: 'effect_patch',
          aggregateType: 'effect',
          aggregateId: command.targetKey,
          serverSeq,
          createdAt,
          payload: {
            targetKey: command.targetKey,
            add: [effect],
            update: [],
            remove: [],
            numberPatch: patch,
          },
        });
      }
    }
    return makeEvent({
      projection,
      commandId: command.commandId,
      eventId,
      sessionId: command.sessionId,
      type: 'player_patch',
      aggregateType: 'player',
      aggregateId: command.targetKey,
      serverSeq,
      createdAt,
      payload: { targetKey: command.targetKey, patch },
    });
  }

  if (command.type === 'apply_effect') {
    getTarget(projection, command.targetKey);
    const effect = normalizeDomainEffect(command.effect, { targetKey: command.targetKey });
    return makeEvent({
      projection,
      commandId: command.commandId,
      eventId,
      sessionId: command.sessionId,
      type: 'effect_patch',
      aggregateType: 'effect',
      aggregateId: command.targetKey,
      serverSeq,
      createdAt,
      payload: { targetKey: command.targetKey, add: [effect], update: [], remove: [] } satisfies EffectPatch,
    });
  }

  if (command.type === 'remove_effect') {
    getTarget(projection, command.targetKey);
    return makeEvent({
      projection,
      commandId: command.commandId,
      eventId,
      sessionId: command.sessionId,
      type: 'effect_patch',
      aggregateType: 'effect',
      aggregateId: command.targetKey,
      serverSeq,
      createdAt,
      payload: { targetKey: command.targetKey, add: [], update: [], remove: [command.effectId] } satisfies EffectPatch,
    });
  }

  if (command.type === 'advance_turn') {
    const advanced = advanceProjectionTurn(projection, command.unit);
    return makeEvent({
      projection,
      commandId: command.commandId,
      eventId,
      sessionId: command.sessionId,
      type: 'session_patch',
      aggregateType: 'session',
      aggregateId: command.sessionId,
      serverSeq,
      createdAt,
      payload: {
        currentTurn: advanced.projection.currentTurn,
        elapsedMinutes: advanced.projection.elapsedMinutes,
        updatedEffectsByTarget: advanced.updatedEffectsByTarget,
        expiredByTarget: advanced.expiredByTarget,
        tempHpByTarget: advanced.tempHpByTarget,
      },
    });
  }

  if (command.type === 'pause_session' || command.type === 'resume_session' || command.type === 'end_session') {
    const status = command.type === 'pause_session' ? 'paused' : command.type === 'resume_session' ? 'active' : 'ended';
    return makeEvent({
      projection,
      commandId: command.commandId,
      eventId,
      sessionId: command.sessionId,
      type: status === 'ended' ? 'session_ended' : 'session_patch',
      aggregateType: 'session',
      aggregateId: command.sessionId,
      serverSeq,
      createdAt,
      payload: { status },
    });
  }


  if (command.type === 'grant_xp' || command.type === 'set_xp') {
    const target = getTarget(projection, command.targetKey);
    const amount = Math.max(0, Math.floor(Number(command.amount ?? command.xp ?? 0) || 0));
    const xp = command.type === 'grant_xp' ? target.xp + amount : amount;
    return makePlayerTransactionEvent(projection, command, {
      eventId,
      serverSeq,
      createdAt,
      patch: { xp },
      message: command.reason || `${target.name}: XP atualizado pelo mestre.`,
    });
  }

  if (command.type === 'add_coins' || command.type === 'set_coins') {
    const target = getTarget(projection, command.targetKey);
    const incoming = normalizeCoins({ ...command.coins, gp: command.gp ?? command.coins?.gp, sp: command.sp ?? command.coins?.sp, cp: command.cp ?? command.coins?.cp });
    const coins = command.type === 'add_coins'
      ? { gp: target.coins.gp + incoming.gp, sp: target.coins.sp + incoming.sp, cp: target.coins.cp + incoming.cp }
      : incoming;
    return makePlayerTransactionEvent(projection, command, {
      eventId,
      serverSeq,
      createdAt,
      patch: coins,
      message: command.reason || `${target.name}: moedas atualizadas pelo mestre.`,
    });
  }

  if (command.type === 'request_reward' || command.type === 'grant_reward') {
    return rewardCommandToEvent(projection, command, { eventId, serverSeq, createdAt });
  }

  if (command.type === 'send_item' || command.type === 'donate_item' || command.type === 'trade_item') {
    return itemTransferCommandToEvent(projection, command, { eventId, serverSeq, createdAt });
  }

  if (command.type === 'use_spell') {
    return useSpellCommandToEvent(projection, command, { eventId, serverSeq, createdAt, context });
  }

  if (command.type === 'apply_pending_save' || command.type === 'resolve_pending_save') {
    return pendingSaveCommandToEvent(projection, command, { eventId, serverSeq, createdAt });
  }

  if (command.type === 'apply_self_effect') {
    getTarget(projection, command.targetKey);
    const effect = normalizeDomainEffect(command.effect, { targetKey: command.targetKey, sourceType: 'manual', sourceId: command.commandId });
    return makeEvent({
      projection,
      commandId: command.commandId,
      eventId,
      sessionId: command.sessionId,
      type: 'effect_patch',
      aggregateType: 'effect',
      aggregateId: command.targetKey,
      serverSeq,
      createdAt,
      payload: { targetKey: command.targetKey, add: [effect], update: [], remove: [] } satisfies EffectPatch,
    });
  }

  if (command.type === 'consume_item') {
    return consumeItemCommandToEvent(projection, command, { eventId, serverSeq, createdAt, context });
  }

  if (command.type === 'equip_item' || command.type === 'unequip_item') {
    return equipItemCommandToEvent(projection, command, { eventId, serverSeq, createdAt });
  }

  throw new Error('Comando LAN nao suportado.');
}

function makePlayerTransactionEvent(
  projection: SessionProjection,
  command: Extract<LanCommand, { type: 'grant_xp' | 'set_xp' | 'add_coins' | 'set_coins' }>,
  input: {
    eventId: string;
    serverSeq: number;
    createdAt: string;
    patch: PlayerPatch;
    message: string;
  },
) {
  const payload: CharacterTransactionEvent = {
    type: 'character_transaction',
    eventId: input.eventId,
    commandId: command.commandId,
    sessionId: command.sessionId,
    targetKey: command.targetKey,
    serverSeq: input.serverSeq,
    changes: { player: input.patch },
    message: input.message,
  };
  return makeEvent({
    projection,
    commandId: command.commandId,
    eventId: input.eventId,
    sessionId: command.sessionId,
    type: 'character_transaction',
    aggregateType: 'transaction',
    aggregateId: command.targetKey,
    serverSeq: input.serverSeq,
    createdAt: input.createdAt,
    payload,
  });
}

function consumeItemCommandToEvent(
  projection: SessionProjection,
  command: Extract<LanCommand, { type: 'consume_item' }>,
  meta: {
    eventId: string;
    serverSeq: number;
    createdAt: string;
    context: LanCommandContext;
  },
) {
  const target = getTarget(projection, command.targetKey);
  const consume = consumeItemAtomically({
    equipment: target.inventory,
    itemInstanceId: command.itemInstanceId,
    qty: command.qty,
  });
  const structuredEffects = parseStructuredEffects(consume.item.effect_json || consume.item.effectJson);
  const formula = extractItemHealingFormula(consume.item, structuredEffects);
  const rolls: CharacterTransactionEvent['rolls'] = [];
  const playerPatch: PlayerPatch = {};
  const effectsPatch: EffectPatch = { targetKey: command.targetKey, add: [], update: [], remove: [] };

  if (formula) {
    const parsed = parseUsableDiceFormulaWithContext(formula, target.effectiveStats);
    if (parsed) {
      const roll = rollParsedDiceFormula(parsed, meta.context.rng || Math.random);
      rolls.push({
        ...roll,
        rollId: `${command.commandId}:roll:1`,
        rolledAt: meta.createdAt,
      });
      playerPatch.hpCurrent = Math.min(target.hpMax, target.hpCurrent + roll.total);
    }
  }

  for (const [index, rawEffect] of structuredEffects.entries()) {
    const kind = String(rawEffect?.kind || rawEffect?.type || '').toLowerCase();
    const targetName = String(rawEffect?.target || '').toUpperCase();
    const value = Math.max(0, Math.floor(Number(rawEffect?.value ?? rawEffect?.amount ?? 0) || 0));
    const isHeal = kind === 'heal' || targetName === 'HP';
    const isTempHp = kind === 'temp_hp' || targetName === 'PV_TEMP';
    const isStatOrStatus = (
      kind === 'stat' ||
      kind === 'status' ||
      kind === 'condition' ||
      ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR', 'CA'].includes(targetName)
    );

    if (isHeal && !formula && value > 0) {
      playerPatch.hpCurrent = Math.min(target.hpMax, (playerPatch.hpCurrent ?? target.hpCurrent) + value);
      continue;
    }

    if (isTempHp && value > 0) {
      playerPatch.tempHp = Math.max(playerPatch.tempHp ?? target.tempHp, value);
      effectsPatch.add?.push(normalizeDomainEffect({
        ...rawEffect,
        id: rawEffect?.id || `${command.commandId}:effect:${index}`,
        sourceId: rawEffect?.sourceId || `${command.commandId}:effect:${index}`,
        sourceType: 'item',
        targetKey: command.targetKey,
        name: rawEffect?.name || consume.item.name || 'PV temporario',
        kind: 'temp_hp',
        target: 'PV_TEMP',
        value,
        remaining: rawEffect?.remaining ?? rawEffect?.durationValue ?? rawEffect?.duration ?? 1,
        unit: rawEffect?.unit || rawEffect?.durationUnit || consume.item.duration_unit || 'turn',
      }, { targetKey: command.targetKey }));
      continue;
    }

    if (isStatOrStatus) {
      const rawTarget = targetName && targetName !== 'CHOOSE_STAT' ? targetName : 'custom';
      effectsPatch.add?.push(normalizeDomainEffect({
        ...rawEffect,
        id: rawEffect?.id || `${command.commandId}:effect:${index}`,
        sourceId: rawEffect?.sourceId || `${command.commandId}:effect:${index}`,
        sourceType: 'item',
        targetKey: command.targetKey,
        name: rawEffect?.name || rawEffect?.condition?.name || consume.item.name || 'Efeito de item',
        kind: kind === 'status' || kind === 'condition' || rawEffect?.condition ? 'status' : 'stat',
        target: rawTarget,
        value: Math.floor(Number(rawEffect?.value ?? rawEffect?.amount ?? 0) || 0),
        remaining: rawEffect?.remaining ?? rawEffect?.durationValue ?? rawEffect?.duration ?? rawEffect?.condition?.duration?.value ?? 1,
        unit: rawEffect?.unit || rawEffect?.durationUnit || rawEffect?.condition?.duration?.unit || consume.item.duration_unit || 'turn',
      }, { targetKey: command.targetKey }));
    }
  }

  const inventoryPatch: InventoryPatch = {
    targetKey: command.targetKey,
    equipment: consume.equipmentAfter,
    itemDelta: consume.itemDelta,
  };

  const payload: CharacterTransactionEvent = {
    type: 'character_transaction',
    eventId: meta.eventId,
    commandId: command.commandId,
    sessionId: command.sessionId,
    targetKey: command.targetKey,
    serverSeq: meta.serverSeq,
    changes: {
      player: Object.keys(playerPatch).length > 0 ? playerPatch : undefined,
      inventory: inventoryPatch,
      effects: (effectsPatch.add?.length || effectsPatch.update?.length || effectsPatch.remove?.length) ? effectsPatch : undefined,
    },
    rolls,
    message: `${target.name} consumiu ${consume.qty}x ${consume.item.name || 'item'}.`,
  };

  return makeEvent({
    projection,
    commandId: command.commandId,
    eventId: meta.eventId,
    sessionId: command.sessionId,
    type: 'character_transaction',
    aggregateType: 'transaction',
    aggregateId: command.targetKey,
    serverSeq: meta.serverSeq,
    createdAt: meta.createdAt,
    payload,
  });
}

function equipItemCommandToEvent(
  projection: SessionProjection,
  command: EquipItemCommand | UnequipItemCommand,
  meta: {
    eventId: string;
    serverSeq: number;
    createdAt: string;
  },
) {
  const target = getTarget(projection, command.targetKey);
  const item = command.type === 'equip_item' && command.itemInstanceId
    ? target.inventory.bag.find((entry) => (
      String(entry.id || '') === command.itemInstanceId ||
      String(entry.inventoryItemId || entry.inventory_item_id || '') === command.itemInstanceId ||
      getInventoryStackKey(entry) === command.itemInstanceId
    ))
    : null;
  const equip = equipItemAtomically({
    equipment: target.inventory,
    stats: buildStatsWithDerivedEquipMods(target.baseStats, target.inventory),
    slot: command.slot,
    itemToEquip: item || null,
  });
  const inventoryPatch: InventoryPatch = {
    targetKey: command.targetKey,
    equipment: equip.equipmentAfter,
    stats: equip.statsAfter,
  };
  const payload: CharacterTransactionEvent = {
    type: 'character_transaction',
    eventId: meta.eventId,
    commandId: command.commandId,
    sessionId: command.sessionId,
    targetKey: command.targetKey,
    serverSeq: meta.serverSeq,
    changes: { inventory: inventoryPatch },
    message: item ? `${target.name} equipou ${item.name || 'item'}.` : `${target.name} removeu item de ${command.slot}.`,
  };
  return makeEvent({
    projection,
    commandId: command.commandId,
    eventId: meta.eventId,
    sessionId: command.sessionId,
    type: 'character_transaction',
    aggregateType: 'transaction',
    aggregateId: command.targetKey,
    serverSeq: meta.serverSeq,
    createdAt: meta.createdAt,
    payload,
  });
}

function rewardCommandToEvent(
  projection: SessionProjection,
  command: Extract<LanCommand, { type: 'request_reward' | 'grant_reward' }>,
  meta: { eventId: string; serverSeq: number; createdAt: string },
) {
  const target = getTarget(projection, command.targetKey);
  const tradeId = command.requestId || command.commandId;
  const trade: LanTradeProjection = {
    id: tradeId,
    sessionId: command.sessionId,
    type: 'reward',
    status: command.type === 'request_reward' ? 'pending' : 'committed',
    actorKey: command.actorKey,
    toKey: command.targetKey,
    message: command.message || (command.type === 'request_reward' ? 'Recompensa solicitada.' : 'Recompensa concedida.'),
    createdAt: meta.createdAt,
  };
  const changes: CharacterTransactionEvent['changes'] = { trade };
  if (command.type === 'grant_reward') {
    const patch: PlayerPatch = {};
    if (command.xp != null) patch.xp = target.xp + Math.max(0, Math.floor(Number(command.xp || 0) || 0));
    const coins = normalizeCoins(command.coins || {});
    if (coins.gp || coins.sp || coins.cp) {
      patch.gp = target.coins.gp + coins.gp;
      patch.sp = target.coins.sp + coins.sp;
      patch.cp = target.coins.cp + coins.cp;
    }
    if (Object.keys(patch).length > 0) changes.player = patch;
    if (command.items?.length) {
      const equipment = addItemsToInventory(target.inventory, command.items);
      changes.inventory = { targetKey: command.targetKey, equipment, stats: target.baseStats };
    }
  }
  const payload: CharacterTransactionEvent = {
    type: 'reward_transaction',
    eventId: meta.eventId,
    commandId: command.commandId,
    sessionId: command.sessionId,
    targetKey: command.targetKey,
    serverSeq: meta.serverSeq,
    changes,
    trade,
    message: trade.message || 'Recompensa LAN.',
  };
  return makeEvent({ projection, commandId: command.commandId, eventId: meta.eventId, sessionId: command.sessionId, type: 'reward_transaction', aggregateType: 'transaction', aggregateId: command.targetKey, serverSeq: meta.serverSeq, createdAt: meta.createdAt, payload });
}

function itemTransferCommandToEvent(
  projection: SessionProjection,
  command: Extract<LanCommand, { type: 'send_item' | 'donate_item' | 'trade_item' }>,
  meta: { eventId: string; serverSeq: number; createdAt: string },
) {
  const source = getTarget(projection, command.fromKey);
  const dest = getTarget(projection, command.toKey);
  const qty = Math.max(1, Math.floor(Number(command.qty || 1) || 1));
  const removedSource = consumeItemAtomically({ equipment: source.inventory, itemInstanceId: command.itemInstanceId, qty });
  let sourceInventory = removedSource.equipmentAfter;
  let destInventory = dest.inventory;
  const changesByTarget: CharacterTransactionEvent['changesByTarget'] = {
    [command.fromKey]: { inventory: { targetKey: command.fromKey, equipment: sourceInventory, stats: source.baseStats, itemDelta: removedSource.itemDelta } },
    [command.toKey]: { inventory: { targetKey: command.toKey, equipment: destInventory, stats: dest.baseStats, itemDelta: { mode: 'add', item: { ...removedSource.item, qty }, qty, stackKey: getInventoryStackKey(removedSource.item) } } },
  };

  let itemName = String(removedSource.item.name || 'item');
  if (command.type === 'trade_item' && command.requestedItemInstanceId) {
    const requestedQty = Math.max(1, Math.floor(Number(command.requestedQty || 1) || 1));
    const removedDest = consumeItemAtomically({ equipment: dest.inventory, itemInstanceId: command.requestedItemInstanceId, qty: requestedQty });
    sourceInventory = addItemsToInventory(sourceInventory, [{ ...removedDest.item, qty: requestedQty }]);
    destInventory = removedDest.equipmentAfter;
    changesByTarget[command.fromKey].inventory = {
      targetKey: command.fromKey,
      equipment: sourceInventory,
      stats: source.baseStats,
      itemDelta: { mode: 'add', item: { ...removedDest.item, qty: requestedQty }, qty: requestedQty, stackKey: getInventoryStackKey(removedDest.item) },
    };
    changesByTarget[command.toKey].inventory = {
      targetKey: command.toKey,
      equipment: destInventory,
      stats: dest.baseStats,
      itemDelta: removedDest.itemDelta,
    };
    itemName = `${itemName} / ${String(removedDest.item.name || 'item')}`;
  }
  destInventory = addItemsToInventory(destInventory, [{ ...removedSource.item, qty }]);
  changesByTarget[command.toKey].inventory = {
    ...(changesByTarget[command.toKey].inventory || { targetKey: command.toKey, equipment: destInventory }),
    targetKey: command.toKey,
    equipment: destInventory,
    stats: dest.baseStats,
  };

  const trade: LanTradeProjection = {
    id: command.tradeId || command.commandId,
    sessionId: command.sessionId,
    type: command.type,
    status: 'committed',
    fromKey: command.fromKey,
    toKey: command.toKey,
    actorKey: command.actorKey,
    itemName,
    qty,
    message: command.message || `${source.name} enviou ${qty}x ${itemName} para ${dest.name}.`,
    createdAt: meta.createdAt,
  };
  const payload: CharacterTransactionEvent = {
    type: 'party_transaction',
    eventId: meta.eventId,
    commandId: command.commandId,
    sessionId: command.sessionId,
    targetKey: command.fromKey,
    serverSeq: meta.serverSeq,
    changes: { trade },
    changesByTarget,
    trade,
    message: trade.message || 'Transferencia LAN.',
  };
  return makeEvent({ projection, commandId: command.commandId, eventId: meta.eventId, sessionId: command.sessionId, type: 'party_transaction', aggregateType: 'transaction', aggregateId: `${command.fromKey}->${command.toKey}`, serverSeq: meta.serverSeq, createdAt: meta.createdAt, payload });
}

function useSpellCommandToEvent(
  projection: SessionProjection,
  command: Extract<LanCommand, { type: 'use_spell' }>,
  meta: { eventId: string; serverSeq: number; createdAt: string; context: LanCommandContext },
) {
  const target = getTarget(projection, command.targetKey);
  const playerPatch: PlayerPatch = { ...(command.resourcePatch || {}) };
  const effectsPatch: EffectPatch = { targetKey: command.targetKey, add: [], update: [], remove: [] };
  const rolls: CharacterTransactionEvent['rolls'] = [];
  const mode = command.mode || (command.effects?.length ? 'effect' : command.amount && command.amount < 0 ? 'damage' : 'heal');
  const amountFromFormula = rollFormula(command.formula, target.effectiveStats, `${command.commandId}:spell_roll`, meta.createdAt, meta.context.rng || Math.random, rolls);
  const amount = Math.max(0, Math.floor(Number(amountFromFormula ?? command.amount ?? 0) || 0));
  if (mode === 'heal' && amount > 0) playerPatch.hpCurrent = Math.min(target.hpMax, target.hpCurrent + amount);
  if (mode === 'damage' && amount > 0) {
    const absorbed = Math.min(target.tempHp, amount);
    playerPatch.tempHp = target.tempHp - absorbed;
    playerPatch.hpCurrent = Math.max(0, target.hpCurrent - (amount - absorbed));
  }
  for (const [index, raw] of (command.effects || []).entries()) {
    effectsPatch.add?.push(normalizeDomainEffect({ ...raw, id: raw.id || `${command.commandId}:spell_effect:${index}`, sourceType: 'spell', sourceId: command.spellId || command.commandId, targetKey: command.targetKey, name: raw.name || command.spellName || 'Magia' }, { targetKey: command.targetKey, sourceType: 'spell' }));
  }
  let pendingSave: CharacterTransactionEvent['pendingSave'];
  if (command.save?.enabled) {
    pendingSave = { action: 'create', save: makePendingSave(command, meta.createdAt) };
  }
  const payload: CharacterTransactionEvent = {
    type: 'spell_transaction',
    eventId: meta.eventId,
    commandId: command.commandId,
    sessionId: command.sessionId,
    targetKey: command.targetKey,
    serverSeq: meta.serverSeq,
    changes: {
      player: Object.keys(playerPatch).length ? playerPatch : undefined,
      effects: (effectsPatch.add?.length || effectsPatch.remove?.length || effectsPatch.update?.length) ? effectsPatch : undefined,
      pendingSave,
    },
    pendingSave,
    rolls,
    message: `${target.name} foi afetado por ${command.spellName || 'magia'}.`,
  };
  return makeEvent({ projection, commandId: command.commandId, eventId: meta.eventId, sessionId: command.sessionId, type: 'spell_transaction', aggregateType: 'transaction', aggregateId: command.targetKey, serverSeq: meta.serverSeq, createdAt: meta.createdAt, payload });
}

function pendingSaveCommandToEvent(
  projection: SessionProjection,
  command: Extract<LanCommand, { type: 'apply_pending_save' | 'resolve_pending_save' }>,
  meta: { eventId: string; serverSeq: number; createdAt: string },
) {
  getTarget(projection, command.targetKey);
  const effectsPatch: EffectPatch = { targetKey: command.targetKey, add: [], update: [], remove: [] };
  const saveId = command.saveId || `${command.commandId}:save`;
  const pendingSave = command.type === 'apply_pending_save'
    ? { action: 'create' as const, save: {
      id: saveId,
      sessionId: command.sessionId,
      targetKey: command.targetKey,
      sourceType: command.sourceType || 'manual',
      sourceId: command.sourceId || command.commandId,
      sourceName: command.sourceName || 'Teste de resistencia',
      effectPayload: command.effectPayload || {},
      ability: String(command.ability || 'CON').toUpperCase(),
      dc: command.dc ?? null,
      status: 'pending' as const,
      result: {},
      createdAt: meta.createdAt,
      resolvedAt: null,
    } satisfies LanPendingSaveProjection }
    : { action: 'resolve' as const, id: saveId, result: { ...(command.result || {}), passed: Boolean(command.passed), resolvedAt: meta.createdAt } };
  if (command.type === 'resolve_pending_save') {
    if (command.removeEffectIds?.length) effectsPatch.remove = command.removeEffectIds;
    if (!command.passed && command.applyEffectOnFailure) effectsPatch.add?.push(normalizeDomainEffect(command.applyEffectOnFailure, { targetKey: command.targetKey }));
  }
  const payload: CharacterTransactionEvent = {
    type: 'character_transaction',
    eventId: meta.eventId,
    commandId: command.commandId,
    sessionId: command.sessionId,
    targetKey: command.targetKey,
    serverSeq: meta.serverSeq,
    changes: {
      pendingSave,
      effects: (effectsPatch.add?.length || effectsPatch.remove?.length) ? effectsPatch : undefined,
    },
    pendingSave,
    message: command.type === 'apply_pending_save' ? 'Teste de resistencia pendente.' : 'Teste de resistencia resolvido.',
  };
  return makeEvent({ projection, commandId: command.commandId, eventId: meta.eventId, sessionId: command.sessionId, type: 'character_transaction', aggregateType: 'pending_save', aggregateId: command.targetKey, serverSeq: meta.serverSeq, createdAt: meta.createdAt, payload });
}

function makePendingSave(command: Extract<LanCommand, { type: 'use_spell' }>, createdAt: string): LanPendingSaveProjection {
  return {
    id: command.save?.id || `${command.commandId}:save`,
    sessionId: command.sessionId,
    targetKey: command.targetKey,
    sourceType: 'spell',
    sourceId: command.spellId || command.commandId,
    sourceName: command.spellName || 'Magia',
    effectPayload: command.save?.pendingEffectPayload || {},
    ability: String(command.save?.ability || 'CON').toUpperCase(),
    dc: command.save?.dc ?? null,
    status: 'pending',
    result: {},
    createdAt,
    resolvedAt: null,
  };
}

function rollFormula(
  formula: string | undefined,
  stats: Record<string, number>,
  rollId: string,
  rolledAt: string,
  rng: () => number,
  rolls: NonNullable<CharacterTransactionEvent['rolls']>,
) {
  if (!formula) return undefined;
  const parsed = parseUsableDiceFormulaWithContext(formula, stats);
  if (!parsed) return undefined;
  const roll = rollParsedDiceFormula(parsed, rng);
  rolls.push({ ...roll, rollId, rolledAt });
  return roll.total;
}

function normalizeCoins(value: Partial<LanCoinState>): LanCoinState {
  return {
    gp: Math.max(0, Math.floor(Number(value.gp || 0) || 0)),
    sp: Math.max(0, Math.floor(Number(value.sp || 0) || 0)),
    cp: Math.max(0, Math.floor(Number(value.cp || 0) || 0)),
  };
}

function makeEvent(input: Omit<LanAuthoritativeEvent, 'aggregateRevision'> & { projection: SessionProjection }) {
  const aggregateRevision = nextAggregateRevision(input.projection, input.aggregateType, input.aggregateId);
  const { projection: _projection, ...event } = input;
  return {
    ...event,
    aggregateRevision,
  } satisfies LanAuthoritativeEvent;
}

function nextAggregateRevision(
  projection: SessionProjection,
  aggregateType: LanAuthoritativeEvent['aggregateType'],
  aggregateId: string,
) {
  if (aggregateType === 'session') return projection.versions.session + 1;
  if (aggregateType === 'player') return (projection.versions.players[aggregateId] || 0) + 1;
  if (aggregateType === 'inventory') return (projection.versions.inventories[aggregateId] || 0) + 1;
  if (aggregateType === 'effect') return (projection.versions.effects[aggregateId] || 0) + 1;
  if (aggregateType === 'pending_save') return (projection.versions.pendingSaves[aggregateId] || 0) + 1;
  if (aggregateType === 'trade') return (projection.versions.trades[aggregateId] || 0) + 1;
  return Math.max(
    projection.versions.players[aggregateId] || 0,
    projection.versions.inventories[aggregateId] || 0,
    projection.versions.effects[aggregateId] || 0,
  ) + 1;
}

function getTarget(projection: SessionProjection, targetKey: string) {
  const target = projection.players[targetKey];
  if (!target) throw new Error('Personagem nao encontrado na projection LAN.');
  return target;
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
    if (obj.type || obj.kind || obj.target) return [obj];
  }
  return [];
}
