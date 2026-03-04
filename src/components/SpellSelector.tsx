import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export type SpellItem = { 
  id: number; 
  name: string; 
  level: string; 
  category?: string; // NOVA PROPRIEDADE ('Magia', 'Habilidade', 'Passiva')
  casting_time?: string; 
  range?: string; 
  components?: string;
  duration?: string;
  damage?: string; 
  damage_dice?: string;
  damage_type?: string;
  saving_throw?: string;
  description?: string;
  classes?: string;
  class_level_required?: number | string;
};

interface SpellSelectorProps {
  visible: boolean;
  onClose: () => void;
  availableSpells: SpellItem[];
  selectedSpellIds: string[];
  lockedFeatureNames: string[];
  onToggleSpell: (spellId: string) => void;
  counterText?: string;
  hintText?: string;
}

export default function SpellSelector({ visible, onClose, availableSpells, selectedSpellIds, lockedFeatureNames, onToggleSpell, counterText, hintText }: SpellSelectorProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todos');
  const [levelFilter, setLevelFilter] = useState('Todos');
  const [actionFilter, setActionFilter] = useState('Todos');

  const [detailSpell, setDetailSpell] = useState<SpellItem | null>(null);

  const availableCategories = ['Todos', 'Magia', 'Habilidade', 'Passiva'];
  const availableLevels = ['Todos', 'Truque', 'Nível 1', 'Nível 2', 'Nível 3', 'Nível 4', 'Nível 5', 'Nível 6', 'Nível 7', 'Nível 8', 'Nível 9'];
  const availableActions = ['Todos', '1 Ação', '1 Ação Bônus', '1 Reação', 'Especial', 'Passiva'];

  const filteredSpells = useMemo(() => {
    return availableSpells.filter(spell => {
      // 1. Busca de Texto
      if (search && !spell.name.toLowerCase().includes(search.toLowerCase())) return false;

      // 2. Filtro de Categoria (Usa explicitamente a nova coluna 'category')
      if (categoryFilter !== 'Todos') {
         if (spell.category !== categoryFilter) return false;
      }

      // 3. Filtro de Nível
      if (levelFilter !== 'Todos') {
         // Habilidades e Passivas muitas vezes têm o nível preenchido com a palavra "Passiva" ou "Nível X" para indicar quando é ganho.
         // Se o usuário filtrou por "Truque" ou "Nível X", aplicamos a restrição rigorosamente à coluna level.
         if (spell.level !== levelFilter) return false;
      }

      // 4. Filtro de Ação
      if (actionFilter !== 'Todos') {
        const ct = spell.casting_time || '';
        if (actionFilter === 'Passiva' && ct !== 'Passiva') return false;
        if (actionFilter === '1 Ação' && ct !== '1 Ação') return false;
        if (actionFilter === '1 Ação Bônus' && ct !== '1 Ação Bônus') return false;
        if (actionFilter === '1 Reação' && ct !== '1 Reação') return false;
        if (actionFilter === 'Especial' && (ct === '1 Ação' || ct === '1 Ação Bônus' || ct === '1 Reação' || ct === 'Passiva')) return false;
      }

      return true;
    });
  }, [availableSpells, search, categoryFilter, levelFilter, actionFilter]);

  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentFullScreen}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={{flex: 1}}>
                <Text style={styles.modalTitle}>Catálogo de Habilidades</Text>
                {counterText && <Text style={styles.counterText}>{counterText}</Text>}
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose}><Ionicons name="close" size={24} color="#fff" /></TouchableOpacity>
            </View>
            
            {hintText && <Text style={styles.hpHint}>{hintText}</Text>}

            {/* Barra de Busca */}
            <View style={styles.searchBox}>
              <Ionicons name="search" size={18} color="rgba(255,255,255,0.4)" style={{marginRight: 10}}/>
              <TextInput style={styles.searchInput} placeholder="Buscar por nome..." value={search} onChangeText={setSearch} placeholderTextColor="rgba(255,255,255,0.4)" />
            </View>

            {/* Filtros em Abas */}
            <View style={{maxHeight: 140, marginBottom: 15}}>
              <ScrollView showsVerticalScrollIndicator={false}>
                
                <Text style={styles.filterTitle}>Categoria:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 10}}>
                  <View style={{flexDirection: 'row', gap: 8}}>
                    {availableCategories.map(cat => (
                      <TouchableOpacity key={cat} style={[styles.filterPill, categoryFilter === cat && styles.filterPillActive]} onPress={() => setCategoryFilter(cat)}>
                        <Text style={[styles.filterPillText, categoryFilter === cat && styles.filterPillTextActive]}>{cat}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                <Text style={styles.filterTitle}>Nível / Grau:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 10}}>
                  <View style={{flexDirection: 'row', gap: 8}}>
                    {availableLevels.map(lvl => (
                      <TouchableOpacity key={lvl} style={[styles.filterPill, levelFilter === lvl && styles.filterPillActive]} onPress={() => setLevelFilter(lvl)}>
                        <Text style={[styles.filterPillText, levelFilter === lvl && styles.filterPillTextActive]}>{lvl}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                <Text style={styles.filterTitle}>Custo de Ação:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{flexDirection: 'row', gap: 8}}>
                    {availableActions.map(act => (
                      <TouchableOpacity key={act} style={[styles.filterPill, actionFilter === act && styles.filterPillActive]} onPress={() => setActionFilter(act)}>
                        <Text style={[styles.filterPillText, actionFilter === act && styles.filterPillTextActive]}>{act}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

              </ScrollView>
            </View>

            {/* Lista de Cards */}
            <FlatList
              style={{ flex: 1, width: '100%' }}
              showsVerticalScrollIndicator={false}
              data={filteredSpells}
              keyExtractor={s => s.id.toString()}
              initialNumToRender={10}
              renderItem={({ item }) => {
                const isActive = selectedSpellIds.includes(item.id.toString());
                const isLocked = lockedFeatureNames.includes(item.name);
                
                // Exibe a categoria correta diretamente do banco (Magia, Habilidade ou Passiva)
                const displayCategory = item.category || 'Desconhecido';

                return (
                  <TouchableOpacity 
                    style={[styles.spellCard, isActive && styles.spellCardActive, isLocked && !isActive && styles.spellCardLocked]} 
                    onPress={() => onToggleSpell(item.id.toString())}
                  >
                    <View style={styles.spellCardHeader}>
                      <View style={{flex: 1, paddingRight: 10}}>
                        <Text style={[styles.spellCardTitle, isActive && {color: '#02112b'}, isLocked && !isActive && {color: '#00fa9a'}]}>{item.name}</Text>
                        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6}}>
                          
                          {/* TAG 1: Categoria da Habilidade */}
                          <View style={[styles.tag, isActive && styles.tagDark]}>
                             <Text style={[styles.tagText, isActive && styles.tagTextDark]}>{displayCategory}</Text>
                          </View>
                          
                          {/* TAG 2: Nível (só se não for Truque e não for Passiva, para não ficar redundante) */}
                          {item.level && item.level !== 'Passiva' && (
                             <View style={[styles.tag, isActive && styles.tagDark]}>
                                <Text style={[styles.tagText, isActive && styles.tagTextDark]}>{item.level}</Text>
                             </View>
                          )}
                          
                          {/* TAG 3: Tempo de Conjuração */}
                          {item.casting_time && item.casting_time !== 'Passiva' && item.casting_time !== '-' && (
                             <View style={[styles.tag, isActive && styles.tagDark]}>
                                <Text style={[styles.tagText, isActive && styles.tagTextDark]}>{item.casting_time}</Text>
                             </View>
                          )}
                          
                          {/* TAG 4: Alcance */}
                          {item.range && item.range !== '-' && item.range !== 'Pessoal' && (
                             <View style={[styles.tag, isActive && styles.tagDark]}>
                                <Text style={[styles.tagText, isActive && styles.tagTextDark]}>{item.range}</Text>
                             </View>
                          )}
                        </View>
                      </View>
                      
                      <View style={{alignItems: 'center', gap: 10}}>
                        {isLocked ? (
                           <Ionicons name="lock-closed" size={28} color={isActive ? "#02112b" : "#00fa9a"} />
                        ) : (
                           <Ionicons name={isActive ? "checkmark-circle" : "add-circle-outline"} size={32} color={isActive ? "#02112b" : "#00bfff"} />
                        )}
                      </View>
                    </View>

                    <View style={styles.spellCardFooter}>
                      <Text style={[styles.spellCardEffect, isActive && {color: 'rgba(2,17,43,0.7)'}]} numberOfLines={1}>
                        {item.damage && item.damage !== '-' ? `Efeito: ${item.damage} ${item.damage_type !== 'Nenhum' ? `(${item.damage_type})` : ''}` : 'Efeito: Suporte/Utilitário'}
                      </Text>
                      <TouchableOpacity style={styles.infoBtn} onPress={() => setDetailSpell(item)}>
                        <Ionicons name="information-circle-outline" size={24} color={isActive ? "#02112b" : "#fff"} />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                )
              }}
              ListEmptyComponent={<Text style={styles.emptyText}>Nenhum item encontrado com esses filtros.</Text>}
            />
          </View>
        </View>

        {/* MODAL INTERNO DE DETALHE */}
        <Modal visible={!!detailSpell} transparent animationType="fade">
          <Pressable style={styles.modalOverlayCenter} onPress={() => setDetailSpell(null)}>
            <View style={styles.spellDetailCard}>
              {detailSpell && (
                <>
                  <Text style={styles.spellDetailName}>{detailSpell.name}</Text>
                  <Text style={styles.spellDetailLevel}>{detailSpell.category} • {detailSpell.category === 'Magia' ? detailSpell.level : detailSpell.classes}</Text>
                  <View style={styles.divider} />
                  
                  <View style={styles.spellDetailInfoGrid}>
                    <View style={styles.spellDetailInfoItem}>
                      <Text style={styles.spellDetailInfoLabel}>ATIVAÇÃO</Text>
                      <Text style={styles.spellDetailInfoValue}>{detailSpell.casting_time || '-'}</Text>
                    </View>
                    <View style={styles.spellDetailInfoItem}>
                      <Text style={styles.spellDetailInfoLabel}>ALCANCE</Text>
                      <Text style={styles.spellDetailInfoValue}>{detailSpell.range || '-'}</Text>
                    </View>
                  </View>

                  <View style={styles.spellDetailInfoGrid}>
                    <View style={styles.spellDetailInfoItem}>
                      <Text style={styles.spellDetailInfoLabel}>COMPONENTES</Text>
                      <Text style={styles.spellDetailInfoValue}>{detailSpell.components || 'Nenhum'}</Text>
                    </View>
                    <View style={styles.spellDetailInfoItem}>
                      <Text style={styles.spellDetailInfoLabel}>DURAÇÃO</Text>
                      <Text style={styles.spellDetailInfoValue}>{detailSpell.duration || 'Instantânea'}</Text>
                    </View>
                  </View>

                  <Text style={styles.spellDetailInfoLabel}>DANO / EFEITO</Text>
                  <Text style={[styles.spellDetailInfoValue, {color: '#00fa9a', marginBottom: 15}]}>
                    {detailSpell.damage || '-'} {detailSpell.damage_type && detailSpell.damage_type !== 'Nenhum' ? `(${detailSpell.damage_type})` : ''}
                  </Text>

                  <Text style={styles.spellDetailInfoLabel}>DESCRIÇÃO</Text>
                  <ScrollView style={{maxHeight: 200, marginTop: 5}}>
                    <Text style={styles.spellDetailDescription}>{detailSpell.description}</Text>
                  </ScrollView>

                  <TouchableOpacity style={styles.modalCloseButton} onPress={() => setDetailSpell(null)}>
                    <Text style={styles.modalCloseText}>FECHAR</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </Pressable>
        </Modal>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalOverlayCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContentFullScreen: { backgroundColor: '#02112b', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 15, height: '90%', marginBottom: 10, borderBottomLeftRadius: 30, borderBottomRightRadius: 30, borderWidth: 1, borderColor: '#00bfff' },
  
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  counterText: { color: '#00fa9a', fontSize: 13, fontWeight: 'bold', marginTop: 4 },
  closeBtn: { padding: 5, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10 },
  hpHint: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 15 },

  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, paddingHorizontal: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginBottom: 15 },
  searchInput: { flex: 1, color: '#fff', paddingVertical: 12, fontSize: 15 },

  filterTitle: { color: '#00bfff', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 5, marginLeft: 2 },
  filterPill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  filterPillActive: { backgroundColor: 'rgba(0,191,255,0.2)', borderColor: '#00bfff' },
  filterPillText: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 'bold' },
  filterPillTextActive: { color: '#00bfff' },

  spellCard: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginBottom: 12 },
  spellCardActive: { backgroundColor: '#00bfff', borderColor: '#00bfff' },
  spellCardLocked: { borderColor: '#00fa9a', backgroundColor: 'rgba(0,250,154,0.05)' },
  
  spellCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  spellCardTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  
  tag: { backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  tagText: { color: '#00bfff', fontSize: 9, fontWeight: 'bold' },
  tagDark: { backgroundColor: 'rgba(0,0,0,0.2)' },
  tagTextDark: { color: '#02112b' },

  spellCardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 15, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  spellCardEffect: { color: '#00fa9a', fontSize: 12, fontWeight: 'bold', flex: 1 },
  infoBtn: { padding: 4 },

  emptyText: { color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 40, fontSize: 14 },

  spellDetailCard: { backgroundColor: '#102b56', borderRadius: 24, padding: 25, width: '100%', borderWidth: 1, borderColor: '#00bfff' },
  spellDetailName: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 5 },
  spellDetailLevel: { color: '#00bfff', fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 15 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginBottom: 15 },
  spellDetailInfoGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, backgroundColor: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 12 },
  spellDetailInfoItem: { alignItems: 'center', flex: 1 },
  spellDetailInfoLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 9, fontWeight: 'bold', letterSpacing: 1, marginBottom: 4 },
  spellDetailInfoValue: { color: '#fff', fontSize: 13, fontWeight: 'bold', textAlign: 'center' },
  spellDetailDescription: { color: 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 22 },
  modalCloseButton: { marginTop: 20, paddingVertical: 15, width: '100%', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: 12 },
  modalCloseText: { color: '#00bfff', fontWeight: 'bold' }
});