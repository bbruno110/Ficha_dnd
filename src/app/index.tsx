import { Ionicons } from '@expo/vector-icons'; // <-- Adicionado o import do Ionicons
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import CharacterCard, { Character } from '../components/CharacterCard';

export default function HomeScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const [charactersList, setCharactersList] = useState<Character[]>([]);

  // BUSCA OS DADOS NO BANCO
  const loadCharacters = async () => {
    try {
      const result = await db.getAllAsync<Character>(
        `SELECT id, name, level, class, race FROM characters ORDER BY created_at DESC`
      );
      setCharactersList(result);
    } catch (error) {
      console.error("Erro ao carregar: ", error);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadCharacters();
    }, [db])
  );

  const handleDeleteCharacter = async (id: number) => {
    try {
      await db.runAsync(`DELETE FROM characters WHERE id = ?`, [id]);
      loadCharacters(); // Atualiza a lista tirando o deletado da tela
    } catch (error) {
      Alert.alert("Erro", "Não foi possível excluir o personagem.");
    }
  };

  const handleEditCharacter = (id: number) => {
    // Agora que você tem a rota /edit, se quiser já pode rotear para ela!
    // router.push(`/edit?id=${id}`);
    Alert.alert("Em Breve!", "A edição será implementada em breve.");
  };

  const handleOpenSheet = (character: Character) => {
    router.push(`/sheet?id=${character.id}`);
  };

  return (
    <LinearGradient colors={['#102b56', '#02112b']} style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Meus Personagens</Text>
      </View>

      {charactersList.length > 0 ? (
        <FlatList
          data={charactersList}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <CharacterCard 
              character={item} 
              onPress={() => handleOpenSheet(item)}
              onDelete={handleDeleteCharacter}
              onEdit={handleEditCharacter}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🛡️</Text>
          <Text style={styles.emptyTitle}>Nenhum herói encontrado</Text>
          <Text style={styles.emptyText}>Sua jornada ainda não começou. Crie seu primeiro personagem para iniciar a aventura!</Text>
        </View>
      )}

      <View style={styles.footer}>
        {/* NOVO BOTÃO: FERRAMENTAS DO MESTRE */}
        <TouchableOpacity style={styles.advancedButton} activeOpacity={0.8} onPress={() => router.push('/advanced')}>
          <Ionicons name="construct-outline" size={20} color="#00bfff" style={{ marginRight: 10 }} />
          <Text style={styles.advancedButtonText}>FERRAMENTAS DO MESTRE</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.createButton} activeOpacity={0.8} onPress={() => router.push('/create')}>
          <Text style={styles.createButtonIcon}>+</Text>
          <Text style={styles.createButtonText}>NOVO PERSONAGEM</Text>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 20 },
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#ffffff', letterSpacing: 1 },
  
  // paddingBottom aumentado para 160 para a lista não ficar atrás dos dois botões do rodapé
  listContent: { paddingHorizontal: 20, paddingBottom: 160 }, 
  
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, marginTop: -50 },
  emptyIcon: { fontSize: 60, marginBottom: 20, opacity: 0.8 },
  emptyTitle: { fontSize: 20, fontWeight: 'bold', color: '#ffffff', marginBottom: 10 },
  emptyText: { fontSize: 14, color: 'rgba(255, 255, 255, 0.6)', textAlign: 'center', lineHeight: 22 },
  
  footer: { position: 'absolute', bottom: 30, left: 20, right: 20 },
  
  advancedButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 191, 255, 0.1)', borderWidth: 1, borderColor: '#00bfff', borderRadius: 16, paddingVertical: 14, marginBottom: 15 },
  advancedButtonText: { fontSize: 14, fontWeight: 'bold', color: '#00bfff', letterSpacing: 1 },
  
  createButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#102b56', borderWidth: 1, borderColor: '#00bfff', borderRadius: 16, paddingVertical: 16, shadowColor: '#00bfff', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 5, elevation: 5 },
  createButtonIcon: { fontSize: 24, color: '#00bfff', marginRight: 10, fontWeight: '300' },
  createButtonText: { fontSize: 16, fontWeight: 'bold', color: '#ffffff', letterSpacing: 1 },
});