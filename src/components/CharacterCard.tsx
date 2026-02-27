import React, { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type Character = {
  id: number;
  name: string;
  level: number;
  class: string;
  race: string;
};

type Props = {
  character: Character;
  onPress: () => void;
  onDelete: (id: number) => void;
  onEdit: (id: number) => void;
};

export default function CharacterCard({ character, onPress, onDelete, onEdit }: Props) {
  // Estados que controlam o nosso Menu Customizado
  const [modalVisible, setModalVisible] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  // Abre o modal ao segurar
  const handleLongPress = () => {
    setIsConfirmingDelete(false); // Reseta para a tela principal de opções
    setModalVisible(true);
  };

  // Fecha o modal (seja clicando em cancelar ou clicando fora)
  const handleClose = () => {
    setModalVisible(false);
    setIsConfirmingDelete(false);
  };

  // Ações dos botões
  const handleEdit = () => {
    handleClose();
    onEdit(character.id);
  };

  const handleDeleteClick = () => {
    setIsConfirmingDelete(true); // Muda o conteúdo do modal para a pergunta de confirmação
  };

  const handleConfirmDelete = () => {
    handleClose();
    onDelete(character.id);
  };

  return (
    <>
      {/* O CARD DO PERSONAGEM */}
      <TouchableOpacity 
        style={styles.characterCard}
        activeOpacity={0.7}
        onPress={onPress}
        onLongPress={handleLongPress}
        delayLongPress={400} // Segurar por 400ms ativa o menu
      >
        <Image 
          source={{ uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(character.name)}&background=102b56&color=00bfff&size=100&bold=true` }} 
          style={styles.avatar} 
        />
        
        <View style={styles.cardInfo}>
          <Text style={styles.characterName} numberOfLines={1}>{character.name}</Text>
          <Text style={styles.characterDetails}>{character.race} • {character.class}</Text>
        </View>

        <View style={styles.levelBadge}>
          <Text style={styles.levelText}>Nv. {character.level || 1}</Text>
        </View>
      </TouchableOpacity>
      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={handleClose}
      >
        <Pressable style={styles.modalOverlay} onPress={handleClose}>
        
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            
            {!isConfirmingDelete ? (
              <>
                <Text style={styles.modalTitle}>{character.name}</Text>
                
                <TouchableOpacity style={styles.optionButton} onPress={handleEdit}>
                  <Text style={styles.optionText}>✏️ Editar Ficha</Text>
                </TouchableOpacity>
                
                <TouchableOpacity style={[styles.optionButton, styles.optionButtonNoBorder]} onPress={handleDeleteClick}>
                  <Text style={styles.deleteText}>🗑️ Excluir Personagem</Text>
                </TouchableOpacity>
                
                <TouchableOpacity style={styles.cancelButton} onPress={handleClose}>
                  <Text style={styles.cancelText}>Cancelar</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>Excluir {character.name}?</Text>
                <Text style={styles.modalWarningText}>
                  Essa ação não pode ser desfeita. Todos os itens, atributos e história do herói serão perdidos no vazio do multiverso.
                </Text>
                
                <TouchableOpacity style={styles.confirmDeleteButton} onPress={handleConfirmDelete}>
                  <Text style={styles.confirmDeleteText}>⚠️ Sim, Excluir para sempre</Text>
                </TouchableOpacity>
                
                <TouchableOpacity style={styles.cancelButton} onPress={handleClose}>
                  <Text style={styles.cancelText}>Ufa, não! Cancelar.</Text>
                </TouchableOpacity>
              </>
            )}

          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  characterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    padding: 15,
    marginBottom: 15,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  cardInfo: {
    flex: 1,
    marginLeft: 15,
    marginRight: 10,
  },
  characterName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  characterDetails: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  levelBadge: {
    backgroundColor: 'rgba(0, 191, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0, 191, 255, 0.3)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  levelText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#00bfff',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#0a1930',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(0, 191, 255, 0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 16,
    color: '#00bfff',
    textAlign: 'center',
    marginBottom: 20,
    fontWeight: '600',
  },
  modalWarningText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 25,
    lineHeight: 22,
  },
  optionButton: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
  },
  optionButtonNoBorder: {
    borderBottomWidth: 0,
  },
  optionText: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
  },
  deleteText: {
    fontSize: 16,
    color: '#ff6666',
    fontWeight: '600',
  },
  confirmDeleteButton: {
    backgroundColor: 'rgba(255, 50, 50, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 50, 50, 0.4)',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  confirmDeleteText: {
    color: '#ff6666',
    fontWeight: 'bold',
    fontSize: 16,
  },
  cancelButton: {
    marginTop: 15,
    paddingVertical: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: 'bold',
  },
});