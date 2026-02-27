import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const RACE_SPEED: Record<string, string> = {
  'Anão': '7,5m', 'Halfling': '7,5m', 'Gnomo': '7,5m',
  'Elfo': '9m', 'Humano': '9m', 'Meio-Elfo': '9m', 'Meio-Orc': '9m', 'Tiefling': '9m', 'Draconato': '9m'
};

const XP_TABLE = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

export default function CharacterSheetScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const db = useSQLiteContext();

  const [activeTab, setActiveTab] = useState<'stats' | 'inv'>('stats');
  const [character, setCharacter] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dbItemsCatalog, setDbItemsCatalog] = useState<any[]>([]);

  // Modais
  const [xpModalVisible, setXpModalVisible] = useState(false);
  const [hpModalVisible, setHpModalVisible] = useState(false);
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [itemSearch, setItemSearch] = useState('');

  useEffect(() => {
    async function loadData() {
      if (!id) return;
      try {
        const result = await db.getFirstAsync(`SELECT * FROM characters WHERE id = ?`, [Number(id)]);
        const catalog = await db.getAllAsync(`SELECT * FROM items ORDER BY name ASC`);
        setDbItemsCatalog(catalog);

        if (result) {
          setCharacter({
            ...result,
            stats: JSON.parse((result as any).stats || '{}'),
            skill_values: JSON.parse((result as any).skill_values || '{}'),
            save_values: JSON.parse((result as any).save_values || '{}'),
            equipment: JSON.parse((result as any).equipment || '[]'),
            spells: JSON.parse((result as any).spells || '[]'),
          });
        }
      } catch (error) { console.error(error); } finally { setLoading(false); }
    }
    loadData();
  }, [id]);

  const updateDB = async (updates: Partial<any>) => {
    try {
      const entries = Object.entries(updates);
      const setString = entries.map(([key]) => `${key} = ?`).join(', ');
      const values = entries.map(([_, val]) => (typeof val === 'object' ? JSON.stringify(val) : val));
      await db.runAsync(`UPDATE characters SET ${setString} WHERE id = ?`, [...values, character.id]);
      setCharacter((prev: any) => ({ ...prev, ...updates }));
    } catch (e) { console.error(e); }
  };

  // XP & HP
  const handleXP = (action: 'add' | 'remove') => {
    const amount = parseInt(inputValue) || 0;
    let newXp = Math.max(0, action === 'add' ? character.xp + amount : character.xp - amount);
    let newLevel = 1;
    for (let i = XP_TABLE.length - 1; i >= 0; i--) { if (newXp >= XP_TABLE[i]) { newLevel = i + 1; break; } }
    updateDB({ xp: newXp, level: newLevel });
    setXpModalVisible(false); setInputValue('');
  };

  const handleHP = (action: 'damage' | 'heal') => {
    const amount = parseInt(inputValue) || 0;
    let currentHp = action === 'damage' ? Math.max(0, character.hp_current - amount) : Math.min(character.hp_max, character.hp_current + amount);
    updateDB({ hp_current: currentHp });
    setHpModalVisible(false); setInputValue('');
  };

  // Inventário Pro
  const updateItemQty = (index: number, delta: number) => {
    let newEquip = [...character.equipment];
    newEquip[index].qty += delta;
    if (newEquip[index].qty <= 0) {
      newEquip = newEquip.filter((_, i) => i !== index);
    }
    updateDB({ equipment: newEquip });
  };

  const addItemFromCatalog = (item: any) => {
    const existingIndex = character.equipment.findIndex((i: any) => i.name === item.name);
    let newEquip = [...character.equipment];

    if (existingIndex > -1) {
      newEquip[existingIndex].qty += 1;
    } else {
      newEquip.push({ name: item.name, qty: 1, weight: item.weight });
    }
    updateDB({ equipment: newEquip });
    setItemModalVisible(false);
    setItemSearch('');
  };

  const updateCoins = (type: 'gp' | 'sp' | 'cp', delta: number) => {
    updateDB({ [type]: Math.max(0, character[type] + delta) });
  };

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#00bfff" /></View>;
  if (!character) return <View style={styles.loadingContainer}><Text style={styles.errorText}>Erro ao carregar.</Text></View>;

  // Cálculos
  const getMod = (val: string) => Math.floor(((parseInt(val) || 10) - 10) / 2);
  const forMod = getMod(character.stats.FOR);
  const desMod = getMod(character.stats.DES);
  const atkBonus = Math.max(forMod, desMod) + 2;

  // Peso
  const totalWeightItems = character.equipment.reduce((acc: number, item: any) => acc + (item.weight * item.qty), 0);
  const totalWeightCoins = (character.gp + character.sp + character.cp) * 0.01;
  const totalWeight = totalWeightItems + totalWeightCoins;
  const carryCap = parseInt(character.stats.FOR) * 7.5;

  return (
    <LinearGradient colors={['#102b56', '#02112b']} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topBarBack} onPress={() => router.back()}><Text style={styles.topBarBackText}>{"<"}</Text></TouchableOpacity>
        <Text style={styles.topBarTitle}>{character.name}</Text>
      </View>

      <View style={styles.tabContainer}>
        {['stats', 'inv'].map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, activeTab === t && styles.activeTab]} onPress={() => setActiveTab(t as any)}>
            <Text style={[styles.tabText, activeTab === t && styles.activeTabText]}>{t === 'stats' ? 'STATUS' : 'MOCHILA'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {activeTab === 'stats' ? (
          <>
            <View style={styles.headerBlock}>
              <Text style={styles.charClassRace}>{character.race} • {character.class}</Text>
              <View style={styles.levelXpRow}>
                <View style={styles.badge}><Text style={styles.badgeText}>Nv. {character.level}</Text></View>
                <TouchableOpacity style={styles.badge} onPress={() => setXpModalVisible(true)}>
                  <Text style={styles.badgeText}>XP: {character.xp} / {XP_TABLE[character.level] || 'MAX'}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity style={styles.combatBoxHp} onPress={() => setHpModalVisible(true)}>
              <Text style={styles.hpValue}>{character.hp_current} <Text style={styles.hpMax}>/ {character.hp_max}</Text></Text>
              <Text style={styles.combatLabel}>PONTOS DE VIDA</Text>
            </TouchableOpacity>

            <View style={styles.combatStatsRow}>
              <View style={styles.combatStatSmall}><Text style={styles.combatStatValue}>{10 + desMod}</Text><Text style={styles.combatLabel}>C.A</Text></View>
              <View style={styles.combatStatSmall}><Text style={styles.combatStatValue}>{desMod >= 0 ? `+${desMod}` : desMod}</Text><Text style={styles.combatLabel}>INICIATIVA</Text></View>
              <View style={styles.combatStatSmall}><Text style={styles.combatStatValue}>{RACE_SPEED[character.race] || '9m'}</Text><Text style={styles.combatLabel}>DESLOC.</Text></View>
            </View>

            <Text style={styles.sectionTitle}>ATRIBUTOS</Text>
            <View style={styles.attributesGrid}>
              {Object.keys(character.stats).map((key) => (
                <View key={key} style={styles.attrBox}>
                  <Text style={styles.attrLabel}>{key}</Text>
                  <Text style={styles.attrValue}>{character.stats[key]}</Text>
                  <View style={styles.modBadge}><Text style={styles.modText}>{getMod(character.stats[key]) >= 0 ? `+${getMod(character.stats[key])}` : getMod(character.stats[key])}</Text></View>
                </View>
              ))}
            </View>
          </>
        ) : (
          <>
            <View style={styles.weightCard}>
                <Text style={styles.combatLabel}>PESO TOTAL DA CARGA</Text>
                <Text style={[styles.weightVal, totalWeight > carryCap && {color: '#ff6666'}]}>{totalWeight.toFixed(1)} / {carryCap.toFixed(1)} kg</Text>
                <View style={styles.weightBar}><View style={[styles.weightFill, {width: `${Math.min((totalWeight/carryCap)*100, 100)}%`, backgroundColor: totalWeight > carryCap ? '#ff6666' : '#00bfff'}]} /></View>
            </View>

            <View style={styles.atkCard}>
              <Text style={styles.combatLabel}>ATAQUE PADRÃO (MELHOR ATRIBUTO)</Text>
              <View style={styles.atkRow}>
                <View style={styles.atkSubBox}><Text style={styles.atkVal}>+{atkBonus}</Text><Text style={styles.atkLab}>ACERTO</Text></View>
                <View style={styles.atkSubBox}><Text style={styles.atkVal}>Dano + {Math.max(forMod, desMod)}</Text><Text style={styles.atkLab}>BÔNUS DANO</Text></View>
              </View>
            </View>

            <Text style={styles.sectionTitle}>MOEDAS</Text>
            <View style={styles.coinManager}>
              {[ { l: 'PO', k: 'gp', c: '#ffd700' }, { l: 'PP', k: 'sp', c: '#c0c0c0' }, { l: 'PC', k: 'cp', c: '#cd7f32' } ].map(c => (
                <View key={c.k} style={styles.coinControl}>
                  <TouchableOpacity onPress={() => updateCoins(c.k as any, -1)} style={styles.coinBtn}><Text style={styles.qtyBtnText}>-</Text></TouchableOpacity>
                  <View style={styles.coinDisplay}><Text style={[styles.coinLabel, {color: c.c}]}>{c.l}</Text><Text style={styles.coinValText}>{character[c.k]}</Text></View>
                  <TouchableOpacity onPress={() => updateCoins(c.k as any, 1)} style={styles.coinBtn}><Text style={styles.qtyBtnText}>+</Text></TouchableOpacity>
                </View>
              ))}
            </View>

            <View style={styles.headerSpaceBetween}>
                <Text style={styles.sectionTitle}>EQUIPAMENTOS</Text>
                <TouchableOpacity style={styles.addBtn} onPress={() => setItemModalVisible(true)}><Text style={styles.addBtnText}>+ ADICIONAR</Text></TouchableOpacity>
            </View>
            
            <View style={styles.cardBlock}>
              {character.equipment.length > 0 ? character.equipment.map((item: any, i: number) => (
                <View key={i} style={styles.itemRow}>
                    <View style={styles.qtyContainer}>
                        <TouchableOpacity onPress={() => updateItemQty(i, -1)} style={styles.smallQtyBtn}><Text style={styles.smallQtyBtnText}>-</Text></TouchableOpacity>
                        <Text style={styles.itemQty}>{item.qty}</Text>
                        <TouchableOpacity onPress={() => updateItemQty(i, 1)} style={styles.smallQtyBtn}><Text style={styles.smallQtyBtnText}>+</Text></TouchableOpacity>
                    </View>
                    <View style={{flex:1}}>
                        <Text style={styles.itemName}>{item.name}</Text>
                        <Text style={styles.itemSubDetail}>{item.weight}kg</Text>
                    </View>
                </View>
              )) : <Text style={styles.emptyText}>Mochila vazia.</Text>}
            </View>
          </>
        )}
      </ScrollView>

      {/* MODAL ADICIONAR ITEM DO BANCO */}
      <Modal visible={itemModalVisible} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setItemModalVisible(false)}>
            <View style={[styles.modalContent, {height: '70%'}]}>
                <Text style={styles.modalTitle}>Catálogo de Itens</Text>
                <TextInput style={styles.modalInput} placeholder="Buscar item..." placeholderTextColor="#666" value={itemSearch} onChangeText={setItemSearch} />
                <FlatList
                    data={dbItemsCatalog.filter(i => i.name.toLowerCase().includes(itemSearch.toLowerCase()))}
                    keyExtractor={i => i.id.toString()}
                    renderItem={({item}) => (
                        <TouchableOpacity style={styles.catalogItem} onPress={() => addItemFromCatalog(item)}>
                            <View>
                                <Text style={styles.catalogItemName}>{item.name}</Text>
                                <Text style={styles.catalogItemSub}>{item.weight}kg</Text>
                            </View>
                            <Text style={styles.addIcon}>+</Text>
                        </TouchableOpacity>
                    )}
                />
            </View>
        </Pressable>
      </Modal>

      {/* MODAIS HP E XP (Simplificados) */}
      <Modal visible={xpModalVisible || hpModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => {setXpModalVisible(false); setHpModalVisible(false);}}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{xpModalVisible ? 'Gerenciar XP' : 'Gerenciar HP'}</Text>
            <TextInput style={styles.modalInput} keyboardType="numeric" value={inputValue} onChangeText={setInputValue} autoFocus />
            <View style={styles.modalRowButtons}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => xpModalVisible ? handleXP('remove') : handleHP('damage')}><Text style={{color:'#ff6666'}}>{xpModalVisible ? 'Remover' : 'Dano'}</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalBtn} onPress={() => xpModalVisible ? handleXP('add') : handleHP('heal')}><Text style={{color:'#00fa9a'}}>{xpModalVisible ? 'Adicionar' : 'Cura'}</Text></TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: '#ff6666', fontWeight: 'bold' },
  topBar: { paddingTop: 60, paddingBottom: 15, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
  topBarBack: { padding: 10, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10 },
  topBarBackText: { color: '#00bfff', fontWeight: 'bold' },
  topBarTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginLeft: 20 },
  tabContainer: { flexDirection: 'row', paddingHorizontal: 20 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'rgba(255,255,255,0.1)' },
  activeTab: { borderBottomColor: '#00bfff' },
  tabText: { color: 'rgba(255,255,255,0.4)', fontWeight: 'bold', fontSize: 12 },
  activeTabText: { color: '#00bfff' },
  scrollContent: { padding: 20 },
  headerBlock: { alignItems: 'center', marginBottom: 20 },
  charClassRace: { fontSize: 14, color: '#00bfff' },
  levelXpRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  badge: { backgroundColor: 'rgba(0,191,255,0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  badgeText: { color: '#00bfff', fontSize: 11, fontWeight: 'bold' },
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
  weightCard: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 15, borderRadius: 20, marginBottom: 15, alignItems: 'center' },
  weightVal: { fontSize: 24, color: '#fff', fontWeight: 'bold', marginVertical: 5 },
  weightBar: { width: '100%', height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, marginTop: 5 },
  weightFill: { height: '100%', borderRadius: 3 },
  atkCard: { backgroundColor: 'rgba(0,191,255,0.1)', padding: 15, borderRadius: 20, alignItems: 'center', marginBottom: 20 },
  atkRow: { flexDirection: 'row', marginTop: 10, gap: 40 },
  atkSubBox: { alignItems: 'center' },
  atkVal: { fontSize: 20, color: '#fff', fontWeight: 'bold' },
  atkLab: { fontSize: 8, color: '#00bfff', fontWeight: 'bold' },
  coinManager: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  coinControl: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 8, alignItems: 'center' },
  coinDisplay: { alignItems: 'center', marginVertical: 5 },
  coinLabel: { fontSize: 10, fontWeight: 'bold' },
  coinValText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  coinBtn: { width: '100%', paddingVertical: 5, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8 },
  headerSpaceBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addBtn: { backgroundColor: '#00bfff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  addBtnText: { color: '#02112b', fontWeight: 'bold', fontSize: 11 },
  cardBlock: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: 15, marginTop: 10 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  qtyContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 15 },
  itemQty: { color: '#fff', fontWeight: 'bold', width: 15, textAlign: 'center', fontSize: 14 },
  smallQtyBtn: { width: 28, height: 28, backgroundColor: 'rgba(0,191,255,0.1)', borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  smallQtyBtnText: { color: '#00bfff', fontSize: 16, fontWeight: 'bold' },
  itemName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  itemSubDetail: { color: 'rgba(255,255,255,0.3)', fontSize: 10 },
  emptyText: { color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginVertical: 20, fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: '#102b56', width: '100%', borderRadius: 25, padding: 20, borderWidth: 1, borderColor: 'rgba(0,191,255,0.3)' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 15 },
  modalInput: { backgroundColor: 'rgba(255,255,255,0.1)', padding: 15, borderRadius: 15, color: '#fff', fontSize: 18, textAlign: 'center', marginBottom: 15 },
  modalRowButtons: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, padding: 15, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 15 },
  qtyBtnText: { color: '#00bfff', fontSize: 20, fontWeight: 'bold' },
  catalogItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  catalogItemName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  catalogItemSub: { color: 'rgba(0,191,255,0.5)', fontSize: 12 },
  addIcon: { color: '#00fa9a', fontSize: 24, fontWeight: 'bold' },
});