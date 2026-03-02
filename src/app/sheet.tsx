import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const XP_TABLE = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

const DEFAULT_SLOTS = { 
  helmet: null, cloak: null, amulet: null, armor: null, campClothes: null,
  gloves: null, boots: null, ring1: null, ring2: null, 
  mainHand: null, offHand: null, ranged: null, lightSource: null 
};

const SPELL_LEVELS = ['Todos', 'Truque', 'Nível 1', 'Nível 2', 'Nível 3', 'Nível 4', 'Nível 5', 'Nível 6', 'Nível 7', 'Nível 8', 'Nível 9'];
const SPELL_EFFECTS = ['Todos', 'Dano', 'Cura', 'Suporte/Defesa'];

export default function CharacterSheetScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const db = useSQLiteContext();

  const [activeTab, setActiveTab] = useState<'stats' | 'profs' | 'inv' | 'spells'>('stats');
  const [character, setCharacter] = useState<any>(null);
  
  const [spellDetails, setSpellDetails] = useState<any[]>([]);
  const [dbItemsCatalog, setDbItemsCatalog] = useState<any[]>([]);
  const [dbSkills, setDbSkills] = useState<any[]>([]);
  const [dbSaves, setDbSaves] = useState<any[]>([]);
  
  const [charRaceSpeed, setCharRaceSpeed] = useState('9m');
  const [charHasSpells, setCharHasSpells] = useState(false);

  const [loading, setLoading] = useState(true);

  // Estados de Modais e Inventário
  const [xpModalVisible, setXpModalVisible] = useState(false);
  const [hpModalVisible, setHpModalVisible] = useState(false);
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [coinModalVisible, setCoinModalVisible] = useState(false);
  const [activeCoinType, setActiveCoinType] = useState<'gp' | 'sp' | 'cp'>('gp');
  const [inputValue, setInputValue] = useState('');
  const [itemSearch, setItemSearch] = useState('');

  const [slotModalVisible, setSlotModalVisible] = useState(false);
  const [activeSlot, setActiveSlot] = useState<keyof typeof DEFAULT_SLOTS | null>(null);
  const [levelUpModalVisible, setLevelUpModalVisible] = useState(false);
  const [newLevelData, setNewLevelData] = useState(0);

  // Estados do Menu de Ação
  const [selectedBagItem, setSelectedBagItem] = useState<{item: any, index: number} | null>(null);
  const [actionQty, setActionQty] = useState(1);
  const [customAlert, setCustomAlert] = useState<{visible: boolean, title: string, message: string, buttons: any[]}>({visible: false, title: '', message: '', buttons: []});

  // Sistema de Buffs Temporários
  const [tempBuffModalVisible, setTempBuffModalVisible] = useState(false);
  const [activeBuffStat, setActiveBuffStat] = useState('');
  const [tempBuffValue, setTempBuffValue] = useState('');

  // Filtros de Magia
  const [spellSearch, setSpellSearch] = useState('');
  const [spellLevelFilter, setSpellLevelFilter] = useState('Todos');
  const [spellEffectFilter, setSpellEffectFilter] = useState('Todos');
  const [spellSortOrder, setSpellSortOrder] = useState<'A-Z' | 'Z-A'>('A-Z');
  
  // Estado para o Detalhe da Magia
  const [selectedSpell, setSelectedSpell] = useState<any>(null);

  const showCustomAlert = (title: string, message: string, buttons?: {text: string, onPress?: () => void, color?: string}[]) => {
    setCustomAlert({
      visible: true,
      title,
      message,
      buttons: buttons || [{ text: 'OK', color: '#00bfff' }]
    });
  };

  useFocusEffect(
    useCallback(() => {
    async function loadData() {
      if (!id) return;
      try {
        const result = await db.getFirstAsync(`SELECT * FROM characters WHERE id = ?`, [Number(id)]);
        const catalog = await db.getAllAsync(`SELECT * FROM items ORDER BY name ASC`);
        const skillsList = await db.getAllAsync(`SELECT * FROM skills ORDER BY name ASC`);
        const savesList = await db.getAllAsync(`SELECT * FROM saving_throws ORDER BY name ASC`);
        
        setDbItemsCatalog(catalog);
        setDbSkills(skillsList);
        setDbSaves(savesList);

        if (result) {
          let parsedEquip = JSON.parse((result as any).equipment || '{}');
          if (Array.isArray(parsedEquip)) {
             parsedEquip = { bag: parsedEquip, slots: { ...DEFAULT_SLOTS } };
          } else {
             parsedEquip.slots = { ...DEFAULT_SLOTS, ...(parsedEquip.slots || {}) };
          }

          let loadedSaves = JSON.parse((result as any).save_values || '[]');
          let loadedSkills = JSON.parse((result as any).skill_values || '[]');
          const backupProfs = JSON.parse((result as any).proficiencies || '[]');

          if (!Array.isArray(loadedSaves) || (loadedSaves.length > 0 && typeof loadedSaves[0] !== 'string')) {
              loadedSaves = backupProfs.filter((p: string) => p.startsWith('save_'));
          }
          if (!Array.isArray(loadedSkills) || (loadedSkills.length > 0 && typeof loadedSkills[0] !== 'string')) {
              loadedSkills = backupProfs.filter((p: string) => p.startsWith('skill_'));
          }

          const parsedStats = JSON.parse((result as any).stats || '{}');
          if(!parsedStats.temp_mods) parsedStats.temp_mods = {};
          if(!parsedStats.equip_mods) parsedStats.equip_mods = {};

          const charData: any = {
            ...(result as any),
            stats: parsedStats,
            save_values: loadedSaves,
            skill_values: loadedSkills,
            equipment: parsedEquip,
            spells: JSON.parse((result as any).spells || '[]'),
          };
          setCharacter(charData);

          const raceData = await db.getFirstAsync<{speed: string}>(`SELECT speed FROM races WHERE name = ?`, [charData.race]);
          if (raceData) setCharRaceSpeed(raceData.speed);

          const mainClassName = charData.class.split(' ')[0]; 
          const classData = await db.getFirstAsync<{is_caster: number}>(`SELECT is_caster FROM classes WHERE name = ?`, [mainClassName]);
          if (classData) setCharHasSpells(classData.is_caster === 1);

          if (charData.spells.length > 0) {
            const placeholders = charData.spells.map(() => '?').join(',');
            const spellsFull = await db.getAllAsync(`SELECT * FROM spells WHERE id IN (${placeholders})`, charData.spells.map((s: string) => Number(s)));
            setSpellDetails(spellsFull);
          }
        }
      } catch (error) { console.error(error); } finally { setLoading(false); }
    }
      loadData();
    }, [id])
  );

  const updateDB = async (updates: Partial<any>) => {
    try {
      const entries = Object.entries(updates);
      const setString = entries.map(([key]) => `${key} = ?`).join(', ');
      const values = entries.map(([_, val]) => (typeof val === 'object' ? JSON.stringify(val) : val));
      await db.runAsync(`UPDATE characters SET ${setString} WHERE id = ?`, [...values, character.id]);
      setCharacter((prev: any) => ({ ...prev, ...updates }));
    } catch (e) { console.error(e); }
  };

  const handleTempBuffSubmit = () => {
    let newStats = { ...character.stats };
    const val = parseInt(tempBuffValue) || 0;
    
    if (val === 0) {
        delete newStats.temp_mods[activeBuffStat];
    } else {
        newStats.temp_mods[activeBuffStat] = val;
    }
    
    updateDB({ stats: newStats });
    setTempBuffModalVisible(false);
    setTempBuffValue('');
  };

  const clearTempBuff = () => {
    let newStats = { ...character.stats };
    delete newStats.temp_mods[activeBuffStat];
    updateDB({ stats: newStats });
    setTempBuffModalVisible(false);
    setTempBuffValue('');
  };

  const handleXP = (action: 'add' | 'remove') => {
    const amount = parseInt(inputValue) || 0;
    let newXp = Math.max(0, action === 'add' ? character.xp + amount : character.xp - amount);
    
    let calcNewLevel = 1;
    for (let i = XP_TABLE.length - 1; i >= 0; i--) { 
      if (newXp >= XP_TABLE[i]) { calcNewLevel = i + 1; break; } 
    }

    if (calcNewLevel > character.level && action === 'add') {
      setNewLevelData(calcNewLevel);
      setLevelUpModalVisible(true); 
    }
    
    updateDB({ xp: newXp });
    setXpModalVisible(false); 
    setInputValue('');
  };

  const goToEditScreen = () => {
    setLevelUpModalVisible(false);
    router.push(`/edit?id=${character.id}&levelUpTo=${newLevelData}`);
  };

  const handleCoinSubmit = () => {
    updateDB({ [activeCoinType]: Math.max(0, parseInt(inputValue) || 0) });
    setCoinModalVisible(false); setInputValue('');
  };

  const updateCoins = (type: 'gp' | 'sp' | 'cp', delta: number) => updateDB({ [type]: Math.max(0, character[type] + delta) });

  const updateBagQty = (index: number, delta: number) => {
    let newBag = [...character.equipment.bag];
    newBag[index].qty += delta;
    if (newBag[index].qty <= 0) newBag = newBag.filter((_, i) => i !== index);
    updateDB({ equipment: { ...character.equipment, bag: newBag } });
  };

  const addItemToBag = (item: any) => {
    let newBag = [...character.equipment.bag];
    const existingIndex = newBag.findIndex((i: any) => i.name === item.name);
    if (existingIndex > -1) newBag[existingIndex].qty += 1;
    else newBag.push({ name: item.name, qty: 1, weight: item.weight, damage: item.damage, damage_type: item.damage_type, properties: item.properties });
    updateDB({ equipment: { ...character.equipment, bag: newBag } });
    setItemModalVisible(false); setItemSearch('');
  };

  const applyDynamicBonus = (bagIndex: number, attr: string, val: number, isPerm: boolean, itemName: string, qty: number) => {
    updateBagQty(bagIndex, -qty);
    let newStats = { ...character.stats };
    let dbUpdates: any = {};
    const totalVal = val * qty;

    if (isPerm) {
      newStats[attr] = String((parseInt(newStats[attr]) || 10) + totalVal);
      newStats.extra_points = (parseInt(newStats.extra_points) || 0) + totalVal;
      setTimeout(() => showCustomAlert("Poder Permanente!", `A essência de ${itemName} entra em suas veias.\nSua ${attr} foi alterada em ${totalVal > 0 ? '+'+totalVal : totalVal} para sempre! ✨`), 400);
    } else {
      if(!newStats.temp_mods) newStats.temp_mods = {};
      newStats.temp_mods[attr] = (parseInt(newStats.temp_mods[attr]) || 0) + totalVal;
      setTimeout(() => showCustomAlert("Buff Ativado", `Você consumiu ${itemName}.\nSeu corpo reage e você recebe ${totalVal > 0 ? '+'+totalVal : totalVal} em ${attr} temporariamente. ⏳`), 400);
    }

    dbUpdates.stats = newStats;
    updateDB(dbUpdates);
  };

  const processConsumeItem = (bagIndex: number, item: any, qty: number) => {
    const effect = item.damage && item.damage !== '-' ? item.damage : 'Efeito oculto';
    
    if (effect.toLowerCase().includes('escolher')) {
      const match = effect.match(/[+-]?\d+/);
      const bonusVal = match ? parseInt(match[0]) : 1;
      const isPerm = effect.toLowerCase().includes('perm');

      const attrButtons: any[] = ['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].map(attr => ({
        text: attr,
        color: bonusVal > 0 ? '#00fa9a' : '#ff6666',
        onPress: () => applyDynamicBonus(bagIndex, attr, bonusVal, isPerm, item.name, qty)
      }));

      showCustomAlert(
        `Consumir ${qty}x ${item.name}`,
        `Você tem certeza que deseja ingerir este item?\n\n(Seus verdadeiros efeitos só serão revelados após o consumo...)`,
        [
          { text: "Recusar", color: "#666" },
          { 
            text: "Beber / Comer", 
            color: "#00fa9a",
            onPress: () => {
              setTimeout(() => {
                showCustomAlert(
                  `Efeito Revelado!`,
                  `O efeito mágico toma conta de você!\n\nEle alterará ${isPerm ? 'permanentemente' : 'temporariamente'} um atributo à sua escolha em ${bonusVal > 0 ? '+'+(bonusVal*qty) : (bonusVal*qty)}.\n\nQual atributo ele afetará?`,
                  attrButtons
                );
              }, 400);
            }
          }
        ]
      );
      return; 
    }

    showCustomAlert(
      `Consumir ${qty}x ${item.name}`,
      `Você tem certeza que deseja ingerir este item? Seus efeitos serão ativados em seu corpo...`,
      [
        { text: "Recusar", color: "#666" },
        { 
          text: "Beber / Comer", 
          color: "#00fa9a",
          onPress: () => {
            updateBagQty(bagIndex, -qty);

            let newStats = { ...character.stats };
            let msgParts = [];
            let showHpModal = false;
            let dbUpdates: any = {};

            const statRegex = /(CA|FOR|DES|CON|INT|SAB|CAR)\s*([+-]?\d+)\s*(\(?(Perm|Temp).*)?/gi;
            const statMatches = [...effect.matchAll(statRegex)];
            
            if (statMatches.length > 0) {
              for (const match of statMatches) {
                const attr = match[1].toUpperCase();
                const val = parseInt(match[2].replace('+', '')) * qty;
                const isPerm = match[3] && match[3].toLowerCase().includes('perm');
                
                if (isPerm) {
                    if (attr !== 'CA') { 
                        newStats[attr] = String((parseInt(newStats[attr]) || 10) + val);
                        newStats.extra_points = (parseInt(newStats.extra_points) || 0) + val;
                    }
                    msgParts.push(`💪 Permanente: ${val > 0 ? '+'+val : val} em ${attr}`);
                } else {
                    if(!newStats.temp_mods) newStats.temp_mods = {};
                    newStats.temp_mods[attr] = (parseInt(newStats.temp_mods[attr]) || 0) + val;
                    msgParts.push(`⏳ Temporário: ${val > 0 ? '+'+val : val} em ${attr}`);
                }
              }
              dbUpdates.stats = newStats;
            }

            const effectStr = effect.toLowerCase();
            if (effectStr.includes('cura') || effectStr.includes('hp') || (item.damage_type || '').toLowerCase().includes('cura')) {
              const temDado = /d\d+/i.test(effect);
              if (!temDado) {
                const matchFixo = effect.match(/\d+/);
                if (matchFixo) {
                  const curaValor = parseInt(matchFixo[0]) * qty;
                  const novoHp = Math.min(character.hp_max, character.hp_current + curaValor);
                  dbUpdates.hp_current = novoHp;
                  msgParts.push(`💖 Recuperou ${curaValor} Pontos de Vida.`);
                }
              } else {
                showHpModal = true;
                msgParts.push(`🎲 Requer Rolagem de Cura:\n${qty}x (${effect})`);
              }
            }

            if (msgParts.length === 0) msgParts.push(`✨ Efeito da ingestão: ${effect}`);

            if (Object.keys(dbUpdates).length > 0) updateDB(dbUpdates);

            setTimeout(() => {
              showCustomAlert(
                "Efeito Revelado!", 
                msgParts.join('\n\n'), 
                showHpModal 
                  ? [ { text: 'OK', color: '#fff' }, { text: 'Ir para HP', color: '#00fa9a', onPress: () => setHpModalVisible(true) } ] 
                  : [{ text: 'OK', color: '#00bfff' }]
              );
            }, 400);
          } 
        }
      ]
    );
  };

  const processThrowItem = (bagIndex: number, item: any, qty: number) => {
    const isThrowableWeapon = item.properties && item.properties.includes('Arremesso');
    const forValue = parseInt(character.stats.FOR) || 10;
    const forMod = Math.floor((forValue - 10) / 2);
    const desMod = Math.floor(((parseInt(character.stats.DES) || 10) - 10) / 2);
    const profBonus = Math.ceil(character.level / 4) + 1;

    const itemWeight = parseFloat(item.weight) || 0;
    const totalWeightThrown = itemWeight * qty;
    const weightLimit = forValue * 1.5;

    if (!isThrowableWeapon && totalWeightThrown > weightLimit) {
      showCustomAlert("Muito Pesado!", `Arremessar ${qty}x pesa ${totalWeightThrown}kg. Sua Força (${forValue}) não permite arremessar esse peso todo de uma vez como arma.`);
      return;
    }

    let atkBonus = 0;
    let dmgRoll = '';
    let dmgType = '';
    let rangeText = '';

    if (isThrowableWeapon) {
      const isFinesse = item.properties.includes('Acuidade');
      const activeMod = isFinesse ? Math.max(forMod, desMod) : forMod;
      atkBonus = activeMod + profBonus;
      dmgRoll = `${item.damage || '1d4'} ${activeMod !== 0 ? (activeMod > 0 ? `+${activeMod}` : activeMod) : ''}`;
      dmgType = item.damage_type || 'Arma';
      rangeText = 'Alcance da Arma (Ex: 6/18m)';
    } else {
      atkBonus = forMod; 
      dmgRoll = `1d4 ${forMod !== 0 ? (forMod > 0 ? `+${forMod}` : forMod) : ''}`;
      dmgType = 'Concussão (Improvisada)';
      rangeText = 'Alcance Curto: 6m / Longo: 18m';
    }

    showCustomAlert(
      `Arremessar: ${qty}x ${item.name}`,
      `📍 ${rangeText}\n🎯 Acerto (D20): ${atkBonus >= 0 ? `+${atkBonus}` : atkBonus}\n⚔️ Dano (cada): ${dmgRoll} [${dmgType}]\n\n⚠️ Você fará ${qty} ataque(s) separado(s). O(s) item(ns) será(ão) consumido(s).`,
      [
        { text: "Cancelar", color: "#666" },
        { 
          text: "Arremessar!", 
          color: "#ff6666",
          onPress: () => {
            updateBagQty(bagIndex, -qty);
            setTimeout(() => showCustomAlert("Fóooosh!", `Você atirou ${qty}x ${item.name} com sucesso. Role seus dados de Acerto e Dano!`), 400);
          }
        }
      ]
    );
  };

  const getEquipBonus = (item: any) => {
    if (!item) return {};
    const effect = item.damage || '';
    const statRegex = /(CA|FOR|DES|CON|INT|SAB|CAR)\s*([+-]?\d+)(?!\s*\(?(Perm|Temp))/gi; 
    const matches = [...effect.matchAll(statRegex)];
    let bonuses: Record<string, number> = {};
    matches.forEach(match => {
      const attr = match[1].toUpperCase();
      const val = parseInt(match[2].replace('+', ''));
      if (!effect.toLowerCase().includes('perm') && !effect.toLowerCase().includes('temp')) {
          bonuses[attr] = val;
      }
    });
    return bonuses;
  };

  const handleEquipItem = (itemToEquip: any) => {
    if (!activeSlot) return;
    let newBag = [...character.equipment.bag];
    let newSlots = { ...character.equipment.slots };
    let newStats = { ...character.stats };
    if(!newStats.equip_mods) newStats.equip_mods = {};

    const oldItem = newSlots[activeSlot];
    if (oldItem) {
      const oldBonuses = getEquipBonus(oldItem);
      for (const [stat, val] of Object.entries(oldBonuses)) {
        newStats.equip_mods[stat] = (newStats.equip_mods[stat] || 0) - (val as number);
        if (newStats.equip_mods[stat] === 0) delete newStats.equip_mods[stat];
      }
    }

    if (itemToEquip) {
      const props = itemToEquip.properties || '';
      if (activeSlot === 'mainHand' && props.includes('Duas mãos')) {
        if (newSlots.offHand) {
          const offIdx = newBag.findIndex(i => i.name === newSlots.offHand.name);
          if (offIdx > -1) newBag[offIdx].qty += 1;
          else newBag.push({ ...newSlots.offHand, qty: 1 });
          
          const offBonuses = getEquipBonus(newSlots.offHand);
          for (const [stat, val] of Object.entries(offBonuses)) {
            newStats.equip_mods[stat] = (newStats.equip_mods[stat] || 0) - (val as number);
            if (newStats.equip_mods[stat] === 0) delete newStats.equip_mods[stat];
          }

          newSlots.offHand = null;
          showCustomAlert("Aviso de Sistema", "Sua mão secundária foi desequipada. Esta arma requer as duas mãos livres.");
        }
      }
      if (activeSlot === 'offHand') {
        const mainProps = newSlots.mainHand?.properties || '';
        if (mainProps.includes('Duas mãos')) {
          showCustomAlert("Ação Bloqueada", "Sua arma principal ocupa as duas mãos. Desequipe-a primeiro se quiser usar outra coisa.");
          return;
        }
      }
    }

    if (oldItem) {
      const existingIdx = newBag.findIndex(i => i.name === oldItem.name);
      if (existingIdx > -1) newBag[existingIdx].qty += 1;
      else newBag.push({ ...oldItem, qty: 1 });
    }

    if (itemToEquip) {
      const bagIdx = newBag.findIndex(i => i.name === itemToEquip.name);
      if (bagIdx > -1) {
        newBag[bagIdx].qty -= 1;
        if (newBag[bagIdx].qty <= 0) newBag.splice(bagIdx, 1);
      }
      newSlots[activeSlot] = { ...itemToEquip, qty: 1 };

      const newBonuses = getEquipBonus(itemToEquip);
      for (const [stat, val] of Object.entries(newBonuses)) {
        newStats.equip_mods[stat] = (newStats.equip_mods[stat] || 0) + (val as number);
      }
    } else {
      newSlots[activeSlot] = null;
    }

    updateDB({ equipment: { bag: newBag, slots: newSlots }, stats: newStats });
    setSlotModalVisible(false);
  };

  const getFilteredAndSortedSpells = () => {
    let filtered = spellDetails.filter(spell => {
      if (spellSearch && !spell.name.toLowerCase().includes(spellSearch.toLowerCase())) return false;
      if (spellLevelFilter !== 'Todos' && spell.level !== spellLevelFilter) return false;
      
      // Ajuste para ler as novas colunas
      if (spellEffectFilter !== 'Todos') {
        const dmgText = (spell.damage_dice || spell.damage || '').toLowerCase();
        const typeText = (spell.damage_type || '').toLowerCase();
        const isCura = dmgText.includes('cura') || dmgText.includes('hp') || typeText.includes('cura');
        const isSupport = (dmgText === '-' || !dmgText) && !isCura; 
        
        if (spellEffectFilter === 'Cura' && !isCura) return false;
        if (spellEffectFilter === 'Suporte/Defesa' && !isSupport) return false;
        if (spellEffectFilter === 'Dano' && (isCura || isSupport)) return false; 
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (spellSortOrder === 'A-Z') return a.name.localeCompare(b.name);
      return b.name.localeCompare(a.name);
    });

    return filtered;
  };
  const filteredSpellsList = getFilteredAndSortedSpells();

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#00bfff" /></View>;
  if (!character) return <View style={styles.loadingContainer}><Text style={styles.errorText}>Erro ao carregar.</Text></View>;

  const getMod = (val: string) => Math.floor(((parseInt(val) || 10) - 10) / 2);
  
  // LEITURA DOS STATUS COM BUFFS TEMPORÁRIOS E DE EQUIPAMENTO
  const forBase = parseInt(character.stats.FOR) || 10;
  const forTemp = parseInt(character.stats.temp_mods?.FOR) || 0;
  const forEquip = parseInt(character.stats.equip_mods?.FOR) || 0;
  const forMod = Math.floor(((forBase + forTemp + forEquip) - 10) / 2);

  const desBase = parseInt(character.stats.DES) || 10;
  const desTemp = parseInt(character.stats.temp_mods?.DES) || 0;
  const desEquip = parseInt(character.stats.equip_mods?.DES) || 0;
  const desMod = Math.floor(((desBase + desTemp + desEquip) - 10) / 2);
  
  const conBase = parseInt(character.stats.CON) || 10;
  const conTemp = parseInt(character.stats.temp_mods?.CON) || 0;
  const conEquip = parseInt(character.stats.equip_mods?.CON) || 0;
  const conModBase = Math.floor((conBase - 10) / 2);
  const conModTotal = Math.floor(((conBase + conTemp + conEquip) - 10) / 2);
  
  const profBonus = Math.ceil(character.level / 4) + 1; 
  
  // CÁLCULO DINÂMICO DE HP MÁXIMO (Bônus de CON)
  const hpBonusFromCon = (conModTotal - conModBase) * (character.level || 1);
  const displayHpMax = Math.max(1, character.hp_max + hpBonusFromCon);
  const displayHpCurrent = Math.max(0, character.hp_current + hpBonusFromCon);

  const handleHP = (action: 'damage' | 'heal') => {
    const amount = parseInt(inputValue) || 0;
    
    let newDisplayCurrent = action === 'damage' 
      ? Math.max(0, displayHpCurrent - amount) 
      : Math.min(displayHpMax, displayHpCurrent + amount);
      
    let newDbCurrent = newDisplayCurrent - hpBonusFromCon;
    
    updateDB({ hp_current: newDbCurrent });
    setHpModalVisible(false); setInputValue('');
  };

  const bagWeight = character.equipment.bag.reduce((acc: number, item: any) => acc + (item.weight * item.qty), 0);
  const slotsWeight = Object.values(character.equipment.slots).reduce((acc: number, item: any) => acc + (item ? item.weight : 0), 0);
  const totalWeight = bagWeight + slotsWeight + ((character.gp + character.sp + character.cp) * 0.01);
  const carryCap = (forBase + forTemp + forEquip) * 7.5;

  let baseCa = 10;
  let addDes = true;
  if (character.equipment.slots.armor) {
    const props = character.equipment.slots.armor.properties || '';
    const match = props.match(/CA\s*(\d+)/i);
    if (match) baseCa = parseInt(match[1]);
    if (props.includes('CA 16') || props.includes('Armadura Completa') || props.includes('Pesada')) addDes = false; 
  }
  const caTemp = parseInt(character.stats.temp_mods?.CA) || 0;
  const caEquip = parseInt(character.stats.equip_mods?.CA) || 0;
  const armorClass = baseCa + (addDes ? desMod : 0) + caTemp + caEquip;
  const caSumBuffs = caTemp + caEquip;
  const caColor = caSumBuffs > 0 ? '#00fa9a' : (caSumBuffs < 0 ? '#ff6666' : '#fff');

  let expectedLevel = 1;
  for (let i = XP_TABLE.length - 1; i >= 0; i--) { 
    if (character.xp >= XP_TABLE[i]) { expectedLevel = i + 1; break; } 
  }
  const isPendingLevelUp = expectedLevel > character.level;

  const checkProficiency = (id: string, group: any[]) => group.includes(id);
  const proficientSaves = dbSaves.filter(save => checkProficiency(save.id, character.save_values));
  const proficientSkills = dbSkills.filter(skill => checkProficiency(skill.id, character.skill_values));

  const renderAttackCard = (item: any, slotKey: string, title: string) => {
    if (!item) {
      if (slotKey !== 'mainHand') return null;
      return (
        <View style={styles.atkCard}>
          <Text style={styles.combatLabel}>ATAQUE DESARMADO (Mão Livre)</Text>
          <View style={styles.atkRow}>
            <View style={styles.atkSubBox}><Text style={styles.atkVal}>+{forMod + profBonus}</Text><Text style={styles.atkLab}>ACERTO (D20)</Text></View>
            <View style={styles.atkSubBox}><Text style={[styles.atkVal, {color: '#00fa9a'}]}>1 {forMod !== 0 ? (forMod > 0 ? `+${forMod}` : forMod) : ''}</Text><Text style={styles.atkLab}>DANO (Concussão)</Text></View>
          </View>
        </View>
      );
    }

    const dbItem = dbItemsCatalog.find(cat => cat.name === item.name);
    let itemDamage = item.damage || dbItem?.damage;
    if (!itemDamage || itemDamage === '-') itemDamage = '1d4';
    
    let itemDamageType = item.damage_type || dbItem?.damage_type;
    if (!itemDamageType || itemDamageType === '-') itemDamageType = 'Concussão (Improvisada)';

    const props = item.properties || dbItem?.properties || '';
    const isRanged = props.includes('Munição') || props.includes('Arremesso') || slotKey === 'ranged';
    const isFinesse = props.includes('Acuidade');
    
    let activeMod = forMod;
    if (isRanged && !props.includes('Arremesso')) activeMod = desMod;
    else if (isFinesse) activeMod = Math.max(forMod, desMod);
    
    let dmgMod = activeMod;
    if (slotKey === 'offHand' && dmgMod > 0) dmgMod = 0; 

    return (
      <View style={styles.atkCard} key={slotKey}>
        <Text style={styles.combatLabel}>{title.toUpperCase()}: {item.name.toUpperCase()}</Text>
        <View style={styles.atkRow}>
          <View style={styles.atkSubBox}><Text style={styles.atkVal}>+{activeMod + profBonus}</Text><Text style={styles.atkLab}>ACERTO (D20)</Text></View>
          <View style={styles.atkSubBox}>
            <Text style={[styles.atkVal, {color: '#00fa9a'}]}>{itemDamage} {dmgMod !== 0 ? (dmgMod > 0 ? `+${dmgMod}` : dmgMod) : ''}</Text>
            <Text style={styles.atkLab}>DANO ({itemDamageType})</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderEquipSlot = (slotKey: keyof typeof DEFAULT_SLOTS, label: string, icon: string) => {
    const item = character.equipment.slots[slotKey];
    const dbItem = item ? dbItemsCatalog.find(cat => cat.name === item.name) : null;
    
    const itemDamage = item?.damage || dbItem?.damage;
    const itemDamageType = item?.damage_type || dbItem?.damage_type;
    const itemProps = item?.properties || dbItem?.properties;

    let extraInfo = null;
    if (itemDamage && itemDamage !== '-') {
      extraInfo = `⚔️ ${itemDamage} ${itemDamageType && itemDamageType !== '-' ? itemDamageType : ''}`;
    } else if (itemProps && itemProps !== '-') {
      extraInfo = `🛡️ ${itemProps.split(',')[0]}`; 
    }

    return (
      <TouchableOpacity style={[styles.equipSlotBox, item && styles.equipSlotBoxFilled]} onPress={() => { setActiveSlot(slotKey); setSlotModalVisible(true); }}>
        <Text style={styles.equipSlotLabel}>{label}</Text>
        {item ? (
          <>
            <Text style={styles.equipSlotItemName} numberOfLines={2} adjustsFontSizeToFit>{item.name}</Text>
            {extraInfo && (<Text style={styles.equipSlotItemDamage} numberOfLines={1} adjustsFontSizeToFit>{extraInfo}</Text>)}
          </>
        ) : (<Text style={styles.equipSlotEmptyIcon}>{icon}</Text>)}
      </TouchableOpacity>
    );
  };

  return (
    <LinearGradient colors={['#102b56', '#02112b']} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topBarBack} onPress={() => router.back()}><Text style={styles.topBarBackText}>{"<"}</Text></TouchableOpacity>
        <Text style={styles.topBarTitle}>{character.name}</Text>
        <TouchableOpacity onPress={() => router.push(`/edit?id=${character.id}`)}>
            <Ionicons name="pencil" size={20} color="#00bfff" />
        </TouchableOpacity>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabContainer}>
          {['stats', 'profs', 'inv'].concat(charHasSpells ? ['spells'] : []).map((t) => (
            <TouchableOpacity key={t} style={[styles.tab, activeTab === t && styles.activeTab]} onPress={() => setActiveTab(t as any)}>
              <Text style={[styles.tabText, activeTab === t && styles.activeTabText]}>
                {t === 'stats' ? 'STATUS' : t === 'profs' ? 'PROFS' : t === 'inv' ? 'MOCHILA' : 'MAGIAS'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* ================= ABA STATUS ================= */}
        {activeTab === 'stats' && (
          <>
            <View style={styles.headerBlock}>
              <Text style={styles.charClassRace}>{character.race} • {character.class}</Text>
              
              <View style={styles.levelXpRow}>
                <View style={styles.badge}><Text style={styles.badgeText}>Nv. {character.level}</Text></View>
                
                <TouchableOpacity style={styles.badge} onPress={() => setXpModalVisible(true)}>
                  <Text style={styles.badgeText}>XP: {character.xp} / {XP_TABLE[character.level] || 'MAX'}</Text>
                </TouchableOpacity>

                {isPendingLevelUp && (
                  <TouchableOpacity style={styles.levelUpIconBtn} onPress={() => {setNewLevelData(expectedLevel); setLevelUpModalVisible(true);}}>
                    <Ionicons name="arrow-up" size={24} color="#ffffff" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <TouchableOpacity style={[styles.combatBoxHp, hpBonusFromCon !== 0 && {borderColor: hpBonusFromCon > 0 ? '#00fa9a' : '#ff6666', borderWidth: 1}]} onPress={() => setHpModalVisible(true)}>
              <Text style={styles.hpValue}>{displayHpCurrent} <Text style={styles.hpMax}>/ {displayHpMax}</Text></Text>
              <Text style={styles.combatLabel}>PONTOS DE VIDA {hpBonusFromCon !== 0 && `(CON ${hpBonusFromCon > 0 ? '+' : ''}${hpBonusFromCon})`}</Text>
            </TouchableOpacity>

            <View style={styles.combatStatsRow}>
              <TouchableOpacity style={[styles.combatStatSmall, caSumBuffs !== 0 && {borderColor: caColor, borderWidth: 1}]} 
                onPress={() => { setActiveBuffStat('CA'); setTempBuffValue(String(caTemp)); setTempBuffModalVisible(true); }}>
                {caSumBuffs !== 0 && <Text style={{position: 'absolute', top: 8, right: 12, fontSize: 11, fontWeight: 'bold', color: caColor}}>{caSumBuffs > 0 ? `+${caSumBuffs}` : caSumBuffs}</Text>}
                <Text style={[styles.combatStatValue, caSumBuffs !== 0 && {color: caColor}]}>{armorClass}</Text>
                <Text style={styles.combatLabel}>C.A</Text>
              </TouchableOpacity>
              
              <View style={styles.combatStatSmall}><Text style={styles.combatStatValue}>{desMod >= 0 ? `+${desMod}` : desMod}</Text><Text style={styles.combatLabel}>INICIATIVA</Text></View>
              <View style={styles.combatStatSmall}><Text style={styles.combatStatValue}>{charRaceSpeed}</Text><Text style={styles.combatLabel}>DESLOC.</Text></View>
            </View>

            <Text style={styles.sectionTitle}>ATRIBUTOS</Text>
            <View style={styles.attributesGrid}>
              {['FOR', 'DES', 'CON', 'INT', 'SAB', 'CAR'].map((key) => {
                const baseV = parseInt(character.stats[key]) || 10;
                const tempV = parseInt(character.stats.temp_mods?.[key]) || 0;
                const equipV = parseInt(character.stats.equip_mods?.[key]) || 0;
                
                const totalV = baseV + tempV + equipV;
                const sumBuffs = tempV + equipV;
                const hasBuffs = sumBuffs !== 0;
                
                const buffColor = sumBuffs > 0 ? '#00fa9a' : '#ff6666';

                return (
                  <TouchableOpacity key={key} 
                    style={[styles.attrBox, hasBuffs && {borderColor: buffColor, borderWidth: 1}]}
                    onPress={() => { setActiveBuffStat(key); setTempBuffValue(String(tempV)); setTempBuffModalVisible(true); }}
                  >
                    {hasBuffs && <Text style={{position: 'absolute', top: 8, right: 10, fontSize: 11, fontWeight: 'bold', color: buffColor}}>{sumBuffs > 0 ? `+${sumBuffs}` : sumBuffs}</Text>}
                    <Text style={styles.attrLabel}>{key}</Text>
                    <Text style={[styles.attrValue, hasBuffs && {color: buffColor}]}>{totalV}</Text>
                    <View style={styles.modBadge}><Text style={styles.modText}>{getMod(String(totalV)) >= 0 ? `+${getMod(String(totalV))}` : getMod(String(totalV))}</Text></View>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={styles.sectionTitle}>HISTÓRICO E CARACTERÍSTICAS</Text>
            <View style={styles.cardBlock}>
              {character.features_traits ? <View style={styles.detailSection}><Text style={styles.detailLabel}>TRAÇOS</Text><Text style={styles.detailText}>{character.features_traits}</Text></View> : null}
              {character.languages ? <View style={styles.detailSection}><Text style={styles.detailLabel}>IDIOMAS</Text><Text style={styles.detailText}>{character.languages}</Text></View> : null}
              {character.personality_traits ? <View style={styles.detailSection}><Text style={styles.detailLabel}>PERSONALIDADE</Text><Text style={styles.detailText}>{character.personality_traits}</Text></View> : null}
              {character.ideals ? <View style={styles.detailSection}><Text style={styles.detailLabel}>IDEAIS</Text><Text style={styles.detailText}>{character.ideals}</Text></View> : null}
              {character.bonds ? <View style={styles.detailSection}><Text style={styles.detailLabel}>LIGAÇÕES</Text><Text style={styles.detailText}>{character.bonds}</Text></View> : null}
              {character.flaws ? <View style={styles.detailSection}><Text style={styles.detailLabel}>DEFEITOS</Text><Text style={styles.detailText}>{character.flaws}</Text></View> : null}
              {character.backstory ? <View style={styles.detailSection}><Text style={styles.detailLabel}>HISTÓRIA</Text><Text style={styles.detailText}>{character.backstory}</Text></View> : null}
            </View>
          </>
        )}

        {/* ================= ABA PROFICIÊNCIAS ================= */}
        {activeTab === 'profs' && (
          <>
            <View style={styles.headerSpaceBetween}>
              <Text style={styles.sectionTitle}>TESTES DE RESISTÊNCIA</Text>
              <Text style={{color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 'bold'}}>Bônus Prof: +{profBonus}</Text>
            </View>
            <View style={styles.cardBlock}>
              <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between'}}>
                {proficientSaves.length > 0 ? proficientSaves.map((save) => {
                  const bV = parseInt(character.stats[save.stat]) || 10;
                  const tV = parseInt(character.stats.temp_mods?.[save.stat]) || 0;
                  const eV = parseInt(character.stats.equip_mods?.[save.stat]) || 0;
                  const statMod = Math.floor(((bV + tV + eV) - 10) / 2);
                  const total = statMod + profBonus;
                  return (
                    <View key={save.id} style={{width: '48%', flexDirection: 'row', alignItems: 'center', marginBottom: 15}}>
                      <View style={styles.profIconActive} />
                      <Text style={styles.profName}>{save.name}</Text>
                      <Text style={styles.profValue}>{total >= 0 ? `+${total}` : total}</Text>
                    </View>
                  );
                }) : <Text style={styles.emptyText}>Nenhum teste de resistência marcado.</Text>}
              </View>
            </View>

            <Text style={styles.sectionTitle}>PERÍCIAS (Skills)</Text>
            <View style={styles.cardBlock}>
              {proficientSkills.length > 0 ? proficientSkills.map((skill) => {
                const bV = parseInt(character.stats[skill.stat]) || 10;
                const tV = parseInt(character.stats.temp_mods?.[skill.stat]) || 0;
                const eV = parseInt(character.stats.equip_mods?.[skill.stat]) || 0;
                const statMod = Math.floor(((bV + tV + eV) - 10) / 2);
                const total = statMod + profBonus;
                return (
                  <View key={skill.id} style={styles.profRow}>
                    <View style={styles.profStatBadge}><Text style={{fontSize: 9, fontWeight: 'bold', color: 'rgba(255,255,255,0.5)'}}>{skill.stat}</Text></View>
                    <View style={styles.profIconActive} />
                    <Text style={[styles.profName, {flex: 1}]}>{skill.name}</Text>
                    <Text style={styles.profValue}>{total >= 0 ? `+${total}` : total}</Text>
                  </View>
                );
              }) : <Text style={styles.emptyText}>Nenhuma proficiência em perícias.</Text>}
            </View>
          </>
        )}

        {/* ================= ABA INVENTÁRIO (BOTÕES DIRETOS) ================= */}
        {activeTab === 'inv' && (
          <>
            <View style={styles.weightCard}>
                <Text style={styles.combatLabel}>PESO DA CARGA (Itens + Moedas)</Text>
                <Text style={[styles.weightVal, totalWeight > carryCap && {color: '#ff6666'}]}>{totalWeight.toFixed(1)} / {carryCap.toFixed(1)} kg</Text>
                <View style={styles.weightBar}><View style={[styles.weightFill, {width: `${Math.min((totalWeight/carryCap)*100, 100)}%`, backgroundColor: totalWeight > carryCap ? '#ff6666' : '#00bfff'}]} /></View>
            </View>

            <Text style={styles.sectionTitle}>AÇÕES DE ATAQUE</Text>
            {renderAttackCard(character.equipment.slots.mainHand, 'mainHand', 'Mão Principal')}
            {renderAttackCard(character.equipment.slots.offHand, 'offHand', 'Mão Secundária')}
            {renderAttackCard(character.equipment.slots.ranged, 'ranged', 'Arma à Distância')}

            <Text style={styles.sectionTitle}>MOEDAS</Text>
            <View style={styles.coinManager}>
              {[ { l: 'PO', k: 'gp', c: '#ffd700' }, { l: 'PP', k: 'sp', c: '#c0c0c0' }, { l: 'PC', k: 'cp', c: '#cd7f32' } ].map(c => (
                <View key={c.k} style={styles.coinControl}>
                  <TouchableOpacity onPress={() => updateCoins(c.k as any, -1)} style={styles.coinBtn}><Text style={styles.qtyBtnText}>-</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.coinDisplay} onPress={() => { setActiveCoinType(c.k as any); setInputValue(character[c.k].toString()); setCoinModalVisible(true); }}>
                    <Text style={[styles.coinLabel, {color: c.c}]}>{c.l}</Text>
                    <Text style={[styles.coinValText, {textDecorationLine: 'underline'}]}>{character[c.k]}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => updateCoins(c.k as any, 1)} style={styles.coinBtn}><Text style={styles.qtyBtnText}>+</Text></TouchableOpacity>
                </View>
              ))}
            </View>

            <View style={styles.headerSpaceBetween}>
                <Text style={styles.sectionTitle}>MOCHILA (Bolsos)</Text>
                <TouchableOpacity style={styles.addBtn} onPress={() => setItemModalVisible(true)}><Text style={styles.addBtnText}>+ ITEM</Text></TouchableOpacity>
            </View>
            
            <View style={styles.cardBlock}>
              {character.equipment.bag.length > 0 ? character.equipment.bag.map((item: any, i: number) => {
                  const p = (item.properties || '').toLowerCase();
                  const d = (item.damage || '').toLowerCase();
                  const dt = (item.damage_type || '').toLowerCase();
                  const n = (item.name || '').toLowerCase();
                  const isConsumable = p.includes('consumível') || d.includes('cura') || dt.includes('cura') || d.includes('escolher') || n.includes('poção') || n.includes('pocao');

                  return (
                    <View key={i} style={styles.itemRow}>
                        <View style={styles.qtyContainer}>
                            <TouchableOpacity onPress={() => updateBagQty(i, -1)} style={styles.smallQtyBtn}><Text style={styles.smallQtyBtnText}>-</Text></TouchableOpacity>
                            <Text style={styles.itemQty}>{item.qty}</Text>
                            <TouchableOpacity onPress={() => updateBagQty(i, 1)} style={styles.smallQtyBtn}><Text style={styles.smallQtyBtnText}>+</Text></TouchableOpacity>
                        </View>
                        
                        <TouchableOpacity 
                          style={{flex: 1}} 
                          onPress={() => {
                            setActionQty(1);
                            setSelectedBagItem({item, index: i});
                          }}
                        >
                            <Text style={styles.itemName}>{item.name}</Text>
                            <Text style={styles.itemSubDetail}>{item.weight}kg {item.properties ? ` • ${item.properties}` : ''}</Text>
                        </TouchableOpacity>

                        <View style={{flexDirection: 'row', gap: 5}}>
                          {isConsumable && (
                            <TouchableOpacity style={styles.iconActionBtn} onPress={() => {
                              setActionQty(1);
                              setSelectedBagItem({item, index: i});
                            }}>
                                <Ionicons name="flask" size={18} color="#00fa9a" />
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity style={[styles.iconActionBtn, {borderColor: 'rgba(255,100,100,0.3)', backgroundColor: 'rgba(255,100,100,0.1)'}]} onPress={() => {
                            setActionQty(1);
                            setSelectedBagItem({item, index: i});
                          }}>
                              <Ionicons name="paper-plane" size={18} color="#ff6666" />
                          </TouchableOpacity>
                        </View>
                    </View>
                  )
              }) : <Text style={styles.emptyText}>Sua mochila está vazia.</Text>}
            </View>

            <Text style={[styles.sectionTitle, {marginTop: 20}]}>SLOTS EQUIPADOS</Text>
            <View style={styles.equipGrid}>
              {renderEquipSlot('helmet', 'Capacete', '🪖')}
              {renderEquipSlot('amulet', 'Colar', '📿')}
              {renderEquipSlot('cloak', 'Capa', '🧥')}
              {renderEquipSlot('armor', 'Vestimenta', '🛡️')}
              {renderEquipSlot('campClothes', 'Acampamento', '🏕️')}
              {renderEquipSlot('lightSource', 'Fonte de Luz', '🕯️')}
              {renderEquipSlot('gloves', 'Luvas', '🧤')}
              {renderEquipSlot('boots', 'Botas', '👢')}
              {renderEquipSlot('ring1', 'Anel 1', '💍')}
              {renderEquipSlot('ring2', 'Anel 2', '💍')}
              {renderEquipSlot('mainHand', 'Principal', '🗡️')}
              {renderEquipSlot('offHand', 'Secundária', '🔪')}
              {renderEquipSlot('ranged', 'Distância', '🏹')}
            </View>
            <View style={{height: 30}} />
          </>
        )}

        {/* ================= ABA MAGIAS ================= */}
        {activeTab === 'spells' && (
          <View style={{paddingBottom: 20}}>
            
            <View style={styles.spellFilterSection}>
              <View style={styles.spellSearchRow}>
                <View style={styles.spellSearchInputBox}>
                  <Ionicons name="search" size={16} color="rgba(255,255,255,0.4)" />
                  <TextInput style={styles.spellSearchInput} placeholder="Buscar magia..." placeholderTextColor="rgba(255,255,255,0.4)" value={spellSearch} onChangeText={setSpellSearch} />
                </View>
                <TouchableOpacity style={styles.spellSortBtn} onPress={() => setSpellSortOrder(prev => prev === 'A-Z' ? 'Z-A' : 'A-Z')}>
                  <Ionicons name={spellSortOrder === 'A-Z' ? "arrow-down" : "arrow-up"} color="#00bfff" size={18} />
                  <Text style={styles.spellSortText}>{spellSortOrder}</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.filterLabel}>NÍVEL DA MAGIA</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 15}}>
                <View style={{flexDirection: 'row', gap: 8}}>
                  {SPELL_LEVELS.map(lvl => (
                    <TouchableOpacity key={lvl} style={[styles.filterPill, spellLevelFilter === lvl && styles.filterPillActive]} onPress={() => setSpellLevelFilter(lvl)}>
                      <Text style={[styles.filterPillText, spellLevelFilter === lvl && styles.filterPillTextActive]}>{lvl}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={styles.filterLabel}>TIPO DE EFEITO</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 10}}>
                <View style={{flexDirection: 'row', gap: 8}}>
                  {SPELL_EFFECTS.map(eff => (
                    <TouchableOpacity key={eff} style={[styles.filterPill, spellEffectFilter === eff && styles.filterPillActive]} onPress={() => setSpellEffectFilter(eff)}>
                      <Text style={[styles.filterPillText, spellEffectFilter === eff && styles.filterPillTextActive]}>{eff}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* LISTA DE MAGIAS ATUALIZADA (CARDS COMPACTOS CLICÁVEIS) */}
            <View style={{gap: 12, marginTop: 10}}>
              {filteredSpellsList.length > 0 ? filteredSpellsList.map((spell) => {
                const effDisplay = spell.damage_dice || spell.damage || '-';
                const typeDisplay = spell.damage_type && spell.damage_type !== 'Nenhum' ? ` (${spell.damage_type})` : '';

                return (
                  <TouchableOpacity key={spell.id} style={styles.spellCardCompact} onPress={() => setSelectedSpell(spell)}>
                    <View style={styles.spellHeaderCompact}>
                      <View style={{flex: 1}}>
                        <Text style={styles.spellNameCompact}>{spell.name}</Text>
                        <Text style={styles.spellSubCompact}>{spell.level} • {spell.casting_time} • {spell.range}</Text>
                      </View>
                      <Ionicons name="chevron-down" size={24} color="#00bfff" />
                    </View>
                    <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 10}}>
                      <Text style={{color: '#00fa9a', fontWeight: 'bold', fontSize: 12}}>Efeito: {effDisplay}{typeDisplay}</Text>
                    </View>
                  </TouchableOpacity>
                )
              }) : <Text style={[styles.emptyText, {marginTop: 40}]}>Nenhuma magia atende aos filtros.</Text>}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ================= MODAIS DE SISTEMA ================= */}

      {/* NOVO MODAL DE DETALHES DE MAGIA COMPLETO */}
      <Modal visible={!!selectedSpell} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedSpell(null)}>
          <View style={styles.spellDetailCard}>
            {selectedSpell && (
              <>
                <Text style={styles.spellDetailName}>{selectedSpell.name}</Text>
                <Text style={styles.spellDetailLevel}>{selectedSpell.level}</Text>
                <View style={styles.divider} />
                
                <View style={styles.spellDetailInfoGrid}>
                  <View style={styles.spellDetailInfoItem}>
                    <Text style={styles.spellDetailInfoLabel}>CONJURAÇÃO</Text>
                    <Text style={styles.spellDetailInfoValue}>{selectedSpell.casting_time}</Text>
                  </View>
                  <View style={styles.spellDetailInfoItem}>
                    <Text style={styles.spellDetailInfoLabel}>ALCANCE</Text>
                    <Text style={styles.spellDetailInfoValue}>{selectedSpell.range}</Text>
                  </View>
                </View>

                <View style={styles.spellDetailInfoGrid}>
                  <View style={styles.spellDetailInfoItem}>
                    <Text style={styles.spellDetailInfoLabel}>COMPONENTES</Text>
                    <Text style={styles.spellDetailInfoValue}>{selectedSpell.components || 'V, S'}</Text>
                  </View>
                  <View style={styles.spellDetailInfoItem}>
                    <Text style={styles.spellDetailInfoLabel}>DURAÇÃO</Text>
                    <Text style={styles.spellDetailInfoValue}>{selectedSpell.duration || 'Instantânea'}</Text>
                  </View>
                </View>

                {(selectedSpell.damage_dice || selectedSpell.damage) && (
                  <>
                    <Text style={styles.spellDetailInfoLabel}>EFEITO / DANO / RESISTÊNCIA</Text>
                    <Text style={[styles.spellDetailInfoValue, {color: '#00fa9a', marginBottom: 15}]}>
                      {selectedSpell.damage_dice || selectedSpell.damage} {selectedSpell.damage_type && selectedSpell.damage_type !== 'Nenhum' ? `(${selectedSpell.damage_type})` : ''}
                      {selectedSpell.saving_throw && selectedSpell.saving_throw !== 'Nenhum' ? ` • CD ${selectedSpell.saving_throw}` : ''}
                    </Text>
                  </>
                )}

                <Text style={styles.spellDetailInfoLabel}>DESCRIÇÃO</Text>
                <ScrollView style={{maxHeight: 200, marginTop: 5}}>
                  <Text style={styles.spellDetailDescription}>{selectedSpell.description}</Text>
                </ScrollView>

                <TouchableOpacity style={styles.modalCloseButton} onPress={() => setSelectedSpell(null)}>
                  <Text style={styles.modalCloseText}>FECHAR</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </Pressable>
      </Modal>

      {/* Modal de BUFF TEMPORÁRIO */}
      <Modal visible={tempBuffModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setTempBuffModalVisible(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Ajuste Temporário: {activeBuffStat}</Text>
            <Text style={{color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 15, fontSize: 13}}>Adicione buffs ou debuffs gerados por feitiços, itens ou fadiga. Ex: +2, -1</Text>
            <TextInput style={styles.modalInputLarge} keyboardType="numeric" placeholder="Ex: +2" placeholderTextColor="rgba(255,255,255,0.2)" value={tempBuffValue} onChangeText={setTempBuffValue} autoFocus />
            <View style={styles.modalRowButtons}>
              <TouchableOpacity style={styles.modalBtn} onPress={clearTempBuff}><Text style={{color:'#ff6666', fontWeight:'bold'}}>Limpar (0)</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalBtn} onPress={handleTempBuffSubmit}><Text style={{color:'#00fa9a', fontWeight:'bold'}}>Aplicar Buff</Text></TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Modal de Ações do Item na Mochila */}
      <Modal visible={!!selectedBagItem} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedBagItem(null)}>
          <View style={styles.actionModalBox}>
            {selectedBagItem && (() => {
              const catItem = dbItemsCatalog.find(i => i.name === selectedBagItem.item.name);
              const itemLore = catItem?.descricao || '';
              const p = (selectedBagItem.item.properties || '').toLowerCase();
              const d = (selectedBagItem.item.damage || '').toLowerCase();
              const dt = (selectedBagItem.item.damage_type || '').toLowerCase();
              const n = (selectedBagItem.item.name || '').toLowerCase();
              const isConsumable = p.includes('consumível') || d.includes('cura') || dt.includes('cura') || d.includes('escolher') || n.includes('poção') || n.includes('pocao');

              return (
              <>
                <Text style={styles.modalTitle}>{selectedBagItem.item.name}</Text>
                
                {/* LORE DO ITEM */}
                {itemLore ? (
                  <Text style={{color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginBottom: 15, fontSize: 13, fontStyle: 'italic', paddingHorizontal: 10}}>
                    "{itemLore}"
                  </Text>
                ) : (
                  <Text style={{color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginBottom: 15, fontSize: 12, fontStyle: 'italic'}}>
                    Sem descrição disponível.
                  </Text>
                )}

                {/* STATUS DO ITEM SE NÃO FOR CONSUMÍVEL */}
                <View style={styles.itemStatsBox}>
                  {!isConsumable ? (
                    <>
                      <Text style={styles.itemStatText}>⚔️ Dano/Efeito: <Text style={{color: '#00fa9a'}}>{selectedBagItem.item.damage || '-'}</Text></Text>
                      <Text style={styles.itemStatText}>🛡️ Propriedades: {selectedBagItem.item.properties || '-'}</Text>
                    </>
                  ) : (
                    <Text style={styles.itemStatText}>🧪 Efeito: <Text style={{color: '#ff6666'}}>??? (Oculto até o consumo)</Text></Text>
                  )}
                </View>

                <View style={styles.actionQtyRow}>
                  <TouchableOpacity onPress={() => setActionQty(Math.max(1, actionQty - 1))} style={styles.actionQtyBtn}><Text style={styles.actionQtyBtnText}>-</Text></TouchableOpacity>
                  <Text style={styles.actionQtyVal}>{actionQty}</Text>
                  <TouchableOpacity onPress={() => setActionQty(Math.min(selectedBagItem.item.qty, actionQty + 1))} style={styles.actionQtyBtn}><Text style={styles.actionQtyBtnText}>+</Text></TouchableOpacity>
                </View>
                <Text style={{color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginBottom: 20, fontSize: 10}}>Quantidade Selecionada</Text>

                <View style={{gap: 12, width: '100%'}}>
                  {isConsumable && (
                    <TouchableOpacity style={styles.actionBtnConsume} onPress={() => {
                      const {item, index} = selectedBagItem;
                      const qty = actionQty;
                      setSelectedBagItem(null);
                      processConsumeItem(index, item, qty);
                    }}>
                      <Ionicons name="flask" size={20} color="#00fa9a" />
                      <Text style={styles.actionBtnConsumeText}>Consumir</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity style={styles.actionBtnThrow} onPress={() => {
                    const {item, index} = selectedBagItem;
                    const qty = actionQty;
                    setSelectedBagItem(null);
                    processThrowItem(index, item, qty);
                  }}>
                    <Ionicons name="paper-plane" size={20} color="#ff6666" />
                    <Text style={styles.actionBtnThrowText}>Arremessar</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.actionBtnCancel} onPress={() => setSelectedBagItem(null)}>
                    <Text style={styles.actionBtnCancelText}>Voltar</Text>
                  </TouchableOpacity>
                </View>
              </>
            )})()}
          </View>
        </Pressable>
      </Modal>

      {/* Alerta Customizado Universal */}
      <Modal visible={customAlert.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.customAlertBox}>
            <Text style={styles.customAlertTitle}>{customAlert.title}</Text>
            <Text style={styles.customAlertMessage}>{customAlert.message}</Text>
            <View style={styles.customAlertBtnRow}>
              {customAlert.buttons.map((btn, idx) => (
                <TouchableOpacity key={idx} style={[styles.customAlertBtn, {borderColor: btn.color || '#00bfff', borderWidth: 1}]} onPress={() => { setCustomAlert(prev => ({...prev, visible: false})); if(btn.onPress) setTimeout(btn.onPress, 300); }}>
                  <Text style={[styles.customAlertBtnText, {color: btn.color || '#00bfff'}]}>{btn.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={slotModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSlotModalVisible(false)}>
            <View style={[styles.modalContent, {height: '60%'}]}>
                <Text style={styles.modalTitle}>O que deseja equipar?</Text>
                <TouchableOpacity style={styles.unequipBtn} onPress={() => handleEquipItem(null)}><Text style={styles.unequipBtnText}>[ Limpar Espaço ]</Text></TouchableOpacity>
                <FlatList
                    data={character?.equipment?.bag || []}
                    keyExtractor={(i, idx) => idx.toString()}
                    renderItem={({item}) => {
                      const dbItem = dbItemsCatalog.find(cat => cat.name === item.name);
                      const itemDamage = item.damage || dbItem?.damage;
                      const itemDamageType = item.damage_type || dbItem?.damage_type;
                      const itemProps = item.properties || dbItem?.properties;
                      
                      let subText = `Peso: ${item.weight}kg`;
                      if (itemDamage && itemDamage !== '-') subText = `⚔️ ${itemDamage} ${itemDamageType && itemDamageType !== '-' ? itemDamageType : ''} • ${subText}`;
                      else if (itemProps && itemProps !== '-') subText = `✨ ${itemProps.split(',')[0]} • ${subText}`;

                      return (
                        <TouchableOpacity style={styles.catalogItem} onPress={() => handleEquipItem(item)}>
                            <View style={{flex: 1}}><Text style={styles.catalogItemName}>{item.name}</Text><Text style={styles.catalogItemSub}>{subText}</Text></View>
                            <Text style={styles.addIcon}>›</Text>
                        </TouchableOpacity>
                      )
                    }}
                    ListEmptyComponent={<Text style={styles.emptyText}>Mochila vazia.</Text>}
                />
            </View>
        </Pressable>
      </Modal>

      <Modal visible={itemModalVisible} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setItemModalVisible(false)}>
            <View style={[styles.modalContent, {height: '75%'}]}>
                <Text style={styles.modalTitle}>Catálogo do Mundo</Text>
                <TextInput style={styles.modalInput} placeholder="Buscar..." placeholderTextColor="#666" value={itemSearch} onChangeText={setItemSearch} />
                <FlatList
                    data={dbItemsCatalog.filter(i => i.name.toLowerCase().includes(itemSearch.toLowerCase()))}
                    keyExtractor={i => i.id.toString()}
                    renderItem={({item}) => (
                        <TouchableOpacity style={styles.catalogItem} onPress={() => addItemToBag(item)}>
                            <View style={{flex: 1}}>
                              <Text style={styles.catalogItemName}>
                                {item.name} {item.criador === 'proprio' || item.criador === 'importado' ? <Text style={{color: '#00bfff', fontSize: 10}}>[Custom]</Text> : null}
                              </Text>
                              <Text style={styles.catalogItemSub}>{item.weight}kg {item.damage && item.damage !== '-' && `• ⚔️ ${item.damage}`}</Text>
                            </View>
                            <Text style={styles.addIcon}>+</Text>
                        </TouchableOpacity>
                    )}
                />
            </View>
        </Pressable>
      </Modal>

      <Modal visible={coinModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setCoinModalVisible(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Quantidade de Moedas</Text>
            <TextInput style={styles.modalInputLarge} keyboardType="numeric" value={inputValue} onChangeText={setInputValue} autoFocus />
            <View style={styles.modalRowButtons}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setCoinModalVisible(false)}><Text style={{color:'#ff6666', fontWeight:'bold'}}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalBtn} onPress={handleCoinSubmit}><Text style={{color:'#00fa9a', fontWeight:'bold'}}>Confirmar</Text></TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={hpModalVisible || xpModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => {setXpModalVisible(false); setHpModalVisible(false);}}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{xpModalVisible ? 'Gerenciar XP' : 'Gerenciar HP'}</Text>
            <TextInput style={styles.modalInputLarge} keyboardType="numeric" value={inputValue} onChangeText={setInputValue} autoFocus />
            <View style={styles.modalRowButtons}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => xpModalVisible ? handleXP('remove') : handleHP('damage')}><Text style={{color:'#ff6666', fontWeight:'bold'}}>{xpModalVisible ? '- Remover' : '⚔️ Dano'}</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalBtn} onPress={() => xpModalVisible ? handleXP('add') : handleHP('heal')}><Text style={{color:'#00fa9a', fontWeight:'bold'}}>{xpModalVisible ? '+ Adicionar' : '💖 Cura'}</Text></TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={levelUpModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>🎉 Level Up! Nível {newLevelData}</Text>
                <Text style={{color: 'rgba(255,255,255,0.8)', fontSize: 14, textAlign: 'center', marginBottom: 25, marginTop: 10, lineHeight: 22}}>Você ganhou XP suficiente para subir de nível! Deseja atualizar sua ficha agora?</Text>
                <View style={{width: '100%', gap: 15}}>
                  <TouchableOpacity style={styles.lvlUpBtnPrimary} onPress={goToEditScreen}><Text style={styles.lvlUpBtnPrimaryText}>Atualizar Ficha</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.lvlUpBtnSecondary} onPress={() => setLevelUpModalVisible(false)}><Text style={styles.lvlUpBtnSecondaryText}>Mais Tarde</Text></TouchableOpacity>
                </View>
            </View>
        </View>
      </Modal>

    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#02112b' },
  errorText: { color: '#ff6666', fontWeight: 'bold' },
  topBar: { paddingTop: 60, paddingBottom: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.2)', position: 'relative' },
  topBarBack: { position: 'absolute', left: 20, bottom: 12, padding: 5, zIndex: 10 },
  topBarBackText: { color: '#00bfff', fontSize: 16, fontWeight: 'bold' },
  topBarTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  
  tabContainer: { paddingHorizontal: 20, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  tab: { paddingVertical: 12, paddingHorizontal: 15, alignItems: 'center', marginRight: 10 },
  activeTab: { borderBottomWidth: 2, borderBottomColor: '#00bfff' },
  tabText: { color: 'rgba(255,255,255,0.4)', fontWeight: 'bold', fontSize: 12, letterSpacing: 1 },
  activeTabText: { color: '#00bfff' },
  
  scrollContent: { padding: 20 },
  
  headerBlock: { alignItems: 'center', marginBottom: 20 },
  charClassRace: { fontSize: 14, color: '#00bfff' },
  levelXpRow: { flexDirection: 'row', gap: 10, marginTop: 10, alignItems: 'center' },
  badge: { backgroundColor: 'rgba(0,191,255,0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  badgeText: { color: '#00bfff', fontSize: 11, fontWeight: 'bold' },
  
  levelUpIconBtn: { paddingHorizontal: 5, justifyContent: 'center', alignItems: 'center' },

  combatBoxHp: { backgroundColor: 'rgba(255,50,50,0.1)', padding: 20, borderRadius: 20, alignItems: 'center', marginBottom: 15 },
  hpValue: { fontSize: 36, fontWeight: 'bold', color: '#ff6666' },
  hpMax: { fontSize: 20, color: 'rgba(255,102,102,0.4)' },
  combatLabel: { fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 5, letterSpacing: 1, fontWeight: 'bold' },
  combatStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  combatStatSmall: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', padding: 15, borderRadius: 15, alignItems: 'center' },
  combatStatValue: { fontSize: 18, color: '#fff', fontWeight: 'bold' },
  
  sectionTitle: { color: '#00bfff', fontWeight: 'bold', marginTop: 10, marginBottom: 10, fontSize: 12 },
  attributesGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  attrBox: { width: '31%', backgroundColor: 'rgba(255,255,255,0.05)', padding: 15, borderRadius: 15, alignItems: 'center', marginBottom: 15 },
  attrLabel: { fontSize: 9, color: 'rgba(255,255,255,0.5)', marginBottom: 5 },
  attrValue: { fontSize: 20, color: '#fff', fontWeight: 'bold' },
  modBadge: { backgroundColor: '#00bfff', paddingHorizontal: 8, borderRadius: 6, marginTop: 5 },
  modText: { fontSize: 12, fontWeight: 'bold', color: '#02112b' },
  
  cardBlock: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: 15, marginTop: 5, marginBottom: 15 },
  detailSection: { marginBottom: 15 },
  detailLabel: { fontSize: 10, color: 'rgba(0,191,255,0.5)', fontWeight: 'bold', marginBottom: 5 },
  detailText: { color: '#fff', fontSize: 14, lineHeight: 20 },

  profRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  profStatBadge: { backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, marginRight: 10, width: 35, alignItems: 'center' },
  profIconActive: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#00bfff', marginRight: 10 },
  profName: { color: '#fff', fontSize: 13 },
  profValue: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  weightCard: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 10, borderRadius: 15, marginBottom: 15, alignItems: 'center' },
  weightVal: { fontSize: 18, color: '#fff', fontWeight: 'bold', marginTop: 5 },
  weightBar: { width: '100%', height: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 5 },
  weightFill: { height: '100%', borderRadius: 2 },
  atkCard: { backgroundColor: 'rgba(0,191,255,0.1)', padding: 15, borderRadius: 16, alignItems: 'center', marginBottom: 10 },
  atkRow: { flexDirection: 'row', marginTop: 10, gap: 40 },
  atkSubBox: { alignItems: 'center' },
  atkVal: { fontSize: 20, color: '#fff', fontWeight: 'bold' },
  atkLab: { fontSize: 8, color: '#00bfff', fontWeight: 'bold', marginTop: 3 },
  
  equipGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, marginBottom: 20 },
  equipSlotBox: { width: '48%', backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 15, alignItems: 'center', justifyContent: 'center', height: 95 },
  equipSlotBoxFilled: { borderColor: '#00bfff', backgroundColor: 'rgba(0,191,255,0.05)' },
  equipSlotLabel: { fontSize: 8, color: 'rgba(255,255,255,0.5)', position: 'absolute', top: 8, left: 8, fontWeight: 'bold' },
  equipSlotEmptyIcon: { fontSize: 30, opacity: 0.2 },
  equipSlotItemName: { color: '#fff', fontWeight: 'bold', textAlign: 'center', fontSize: 13, marginTop: 5 },
  equipSlotItemDamage: { color: '#00fa9a', fontSize: 10, marginTop: 5, fontWeight: 'bold' },

  coinManager: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  coinControl: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 8, alignItems: 'center' },
  coinDisplay: { alignItems: 'center', marginVertical: 5 },
  coinLabel: { fontSize: 10, fontWeight: 'bold' },
  coinValText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  coinBtn: { width: '100%', paddingVertical: 5, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8 },
  qtyBtnText: { color: '#00bfff', fontSize: 20, fontWeight: 'bold' },
  headerSpaceBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addBtn: { backgroundColor: '#00bfff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  addBtnText: { color: '#02112b', fontWeight: 'bold', fontSize: 11 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  qtyContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 15 },
  itemQty: { color: '#fff', fontWeight: 'bold', width: 15, textAlign: 'center', fontSize: 14 },
  smallQtyBtn: { width: 28, height: 28, backgroundColor: 'rgba(0,191,255,0.1)', borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  smallQtyBtnText: { color: '#00bfff', fontSize: 16, fontWeight: 'bold' },
  itemName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  itemSubDetail: { color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 2 },
  emptyText: { color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginVertical: 20, fontSize: 12 },

  // BOTÕES DA MOCHILA E AÇÕES
  iconActionBtn: { padding: 8, borderRadius: 8, backgroundColor: 'rgba(0,250,154,0.1)', borderWidth: 1, borderColor: 'rgba(0,250,154,0.3)', justifyContent: 'center', alignItems: 'center' },

  itemStatsBox: { backgroundColor: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', alignItems: 'center' },
  itemStatText: { color: '#00fa9a', fontSize: 13, marginBottom: 5, fontWeight: 'bold' },

  spellFilterSection: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 15, borderRadius: 20, marginBottom: 15 },
  spellSearchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 15 },
  spellSearchInputBox: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 12, paddingHorizontal: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  spellSearchInput: { flex: 1, color: '#fff', paddingVertical: 10, marginLeft: 10, fontSize: 14 },
  spellSortBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,191,255,0.1)', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,191,255,0.3)', gap: 5 },
  spellSortText: { color: '#00bfff', fontWeight: 'bold', fontSize: 12 },
  filterLabel: { fontSize: 10, color: '#00bfff', fontWeight: 'bold', marginBottom: 8, letterSpacing: 1 },
  filterPill: { paddingVertical: 6, paddingHorizontal: 15, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  filterPillActive: { backgroundColor: 'rgba(0,191,255,0.2)', borderColor: '#00bfff' },
  filterPillText: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 'bold' },
  filterPillTextActive: { color: '#00bfff' },

  // NOVOS ESTILOS COMPACTOS PARA MAGIAS
  spellCardCompact: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  spellHeaderCompact: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  spellNameCompact: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  spellSubCompact: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 4 },
  
  spellDetailCard: { backgroundColor: '#102b56', borderRadius: 24, padding: 25, width: '90%', borderWidth: 1, borderColor: '#00bfff', alignSelf: 'center', marginTop: 'auto', marginBottom: 'auto' },
  spellDetailName: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 5 },
  spellDetailLevel: { color: '#00bfff', fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 15 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginBottom: 15 },
  spellDetailInfoGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15, backgroundColor: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 12 },
  spellDetailInfoItem: { alignItems: 'center', flex: 1 },
  spellDetailInfoLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 9, fontWeight: 'bold', letterSpacing: 1, marginBottom: 4 },
  spellDetailInfoValue: { color: '#fff', fontSize: 13, fontWeight: 'bold', textAlign: 'center' },
  spellDetailDescription: { color: 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 22 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: '#102b56', width: '100%', borderRadius: 25, padding: 20, borderWidth: 1, borderColor: 'rgba(0,191,255,0.3)' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 5 },
  modalInput: { backgroundColor: 'rgba(255,255,255,0.1)', padding: 15, borderRadius: 15, color: '#fff', fontSize: 16, marginBottom: 15 },
  modalInputLarge: { backgroundColor: 'rgba(255,255,255,0.1)', padding: 15, borderRadius: 15, color: '#fff', fontSize: 24, textAlign: 'center', marginBottom: 15, fontWeight: 'bold' },
  modalRowButtons: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, padding: 15, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 15 },
  
  lvlUpBtnPrimary: { backgroundColor: '#00bfff', paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  lvlUpBtnPrimaryText: { color: '#000000', fontWeight: 'bold', fontSize: 16 }, 
  lvlUpBtnSecondary: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  lvlUpBtnSecondaryText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },

  catalogItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  catalogItemName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  catalogItemSub: { color: 'rgba(0,191,255,0.5)', fontSize: 12, marginTop: 2 },
  addIcon: { color: '#00bfff', fontSize: 24, fontWeight: 'bold' },
  unequipBtn: { backgroundColor: 'rgba(255,50,50,0.1)', padding: 10, borderRadius: 10, alignItems: 'center', marginBottom: 15, borderWidth: 1, borderColor: 'rgba(255,50,50,0.3)' },
  unequipBtnText: { color: '#ff6666', fontWeight: 'bold', fontSize: 12 },

  actionModalBox: { backgroundColor: '#02112b', width: '85%', borderRadius: 25, padding: 25, borderWidth: 1, borderColor: '#00bfff' },
  actionQtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginVertical: 10 },
  actionQtyBtn: { backgroundColor: 'rgba(255,255,255,0.1)', width: 45, height: 45, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionQtyBtnText: { color: '#00bfff', fontSize: 26, fontWeight: 'bold' },
  actionQtyVal: { color: '#fff', fontSize: 28, fontWeight: 'bold', width: 50, textAlign: 'center' },
  
  actionBtnConsume: { flexDirection: 'row', backgroundColor: 'rgba(0,250,154,0.1)', paddingVertical: 15, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,250,154,0.3)', gap: 10 },
  actionBtnConsumeText: { color: '#00fa9a', fontWeight: 'bold', fontSize: 16 },
  actionBtnThrow: { flexDirection: 'row', backgroundColor: 'rgba(255,100,100,0.1)', paddingVertical: 15, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,100,100,0.3)', gap: 10 },
  actionBtnThrowText: { color: '#ff6666', fontWeight: 'bold', fontSize: 16 },
  actionBtnCancel: { paddingVertical: 15, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionBtnCancelText: { color: 'rgba(255,255,255,0.5)', fontWeight: 'bold', fontSize: 14 },

  customAlertBox: { backgroundColor: '#102b56', width: '90%', borderRadius: 20, padding: 25, borderWidth: 1, borderColor: 'rgba(0,191,255,0.3)', alignItems: 'center' },
  customAlertTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
  customAlertMessage: { color: 'rgba(255,255,255,0.8)', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 25 },
  customAlertBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, width: '100%', justifyContent: 'center' },
  customAlertBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', minWidth: '30%' },
  customAlertBtnText: { fontWeight: 'bold', fontSize: 14 },
  modalCloseButton: { marginTop: 20, paddingVertical: 15, width: '100%', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: 12 },
  modalCloseText: { color: '#00bfff', fontWeight: 'bold' }
});