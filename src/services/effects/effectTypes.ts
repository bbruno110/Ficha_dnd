export type EffectKind = 'condition' | 'buff' | 'debuff' | 'disease' | 'curse' | 'custom' | 'status';

export type SaveAbility = 'FOR' | 'DES' | 'CON' | 'INT' | 'SAB' | 'CAR';

export type DurationUnit =
  | 'instant'
  | 'turn'
  | 'round'
  | 'minute'
  | 'hour'
  | 'day'
  | 'short_rest'
  | 'long_rest'
  | 'rest'
  | 'concentration'
  | 'while_equipped'
  | 'while_active'
  | 'until_save'
  | 'permanent'
  | 'manual';

export type RepeatSave = 'none' | 'start_of_turn' | 'end_of_turn' | 'action' | 'manual' | 'on_damage';

export type SaveOnSuccess = 'none' | 'remove' | 'reduce_duration' | 'ignore' | 'half_damage' | 'negates' | 'special';

export type EffectTarget = 'FOR' | 'DES' | 'CON' | 'INT' | 'SAB' | 'CAR' | 'CA' | 'HP' | 'PV_TEMP' | 'custom';

export type LanEffectCatalogItem = {
  id?: number;
  importUid?: string;
  statusKey: string;
  name: string;
  kind: EffectKind;
  category?: string;
  description?: string;
  color: string;
  secondaryColor?: string;
  icon?: string;
  target?: EffectTarget;
  value?: number;
  defaultDurationValue?: number | null;
  defaultDurationUnit?: DurationUnit | null;
  stackable: boolean;
  removableBySave: boolean;
  repeatSave?: RepeatSave | string | null;
  saveAbility?: SaveAbility | string | null;
  saveOnSuccess?: SaveOnSuccess | string | null;
  visualPriority: number;
  rulesJson: Record<string, unknown>;
  active: boolean;
  creator?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type LanActiveEffectSnapshot = {
  id: string;
  name: string;
  target: EffectTarget;
  value: number;
  remaining: number;
  unit: DurationUnit | 'rest';
  isPermanent?: boolean;
  kind?: EffectKind | 'stat' | 'hp' | 'temp_hp';
  mode?: 'add' | 'set';
  durationText?: string;
  status?: string;
  statusKey?: string;
  source?: string;
  sourceType?: string;
  sourceId?: string;
  color?: string;
  secondaryColor?: string;
  icon?: string;
  visibleToPlayer?: boolean;
  publicNote?: string;
  privateNote?: string;
  stackCount?: number;
  saveDc?: number | null;
  saveAbility?: string | null;
  repeatSave?: string | null;
  removableBySave?: boolean;
  visualPriority?: number;
};

export type ApplyActiveEffectInput = {
  statusKey?: string;
  name?: string;
  target?: EffectTarget;
  value?: number;
  remaining?: number | null;
  unit?: DurationUnit | 'rest' | null;
  mode?: 'add' | 'set';
  kind?: EffectKind | 'stat' | 'hp' | 'temp_hp' | 'custom' | 'status';
  durationText?: string;
  sourceType?: string;
  sourceId?: string;
  sourceName?: string;
  appliedByKey?: string;
  appliedByName?: string;
  saveDc?: number | null;
  saveAbility?: string | null;
  repeatSave?: string | null;
  useCatalogDefaults?: boolean;
  visibleToPlayer?: boolean;
  privateNote?: string;
  publicNote?: string;
  color?: string;
  secondaryColor?: string;
  icon?: string;
};

export type LanEffectPatch = {
  targetKey: string;
  add: LanActiveEffectSnapshot[];
  update: LanActiveEffectSnapshot[];
  remove: string[];
};

export type PendingSaveStatus = 'pending' | 'success' | 'failure' | 'ignored';

export type LanPendingSave = {
  id: string;
  sessionId: string;
  targetKey: string;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceName?: string | null;
  effectPayload: Record<string, unknown>;
  ability: string;
  dc?: number | null;
  dcMode?: string | null;
  status: PendingSaveStatus;
  result: Record<string, unknown>;
  createdAt?: string;
  resolvedAt?: string | null;
};
