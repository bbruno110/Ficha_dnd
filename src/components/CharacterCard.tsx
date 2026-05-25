import React, { useState } from 'react';
import { Image, Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { characterCardStyles as styles } from '@/styles/globalStyles';

export type Character = {
  id: number;
  name: string;
  level: number;
  class: string;
  race: string;
  sessionId?: string | null;
  sessionName?: string | null;
  joinUrl?: string | null;
};

type Props = {
  character: Character;
  onPress: () => void;
  onDelete: (id: number) => void;
  onEdit: (id: number) => void;
  onUnlinkSession?: (id: number) => void;
};

export default function CharacterCard({ character, onPress, onDelete, onEdit, onUnlinkSession }: Props) {
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
          <Text style={styles.characterDetails}>{character.race} - {character.class}</Text>
          {character.sessionName && (
            <Text style={styles.sessionDetails} numberOfLines={1}>{character.name} - sessao {character.sessionName}</Text>
          )}
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

                {character.sessionName && onUnlinkSession && (
                  <TouchableOpacity style={styles.optionButton} onPress={() => { handleClose(); onUnlinkSession(character.id); }}>
                    <Text style={styles.optionText}>Desvincular da Sessao</Text>
                  </TouchableOpacity>
                )}
                
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
