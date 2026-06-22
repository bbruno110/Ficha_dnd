import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AvatarAdjustment, AvatarDraft } from '../utils/characterAvatar';

type AvatarAdjustModalProps = {
  draft: AvatarDraft | null;
  adjustment: AvatarAdjustment;
  onChange: (next: AvatarAdjustment) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

const PREVIEW_SIZE = 220;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default function AvatarAdjustModal({ draft, adjustment, onChange, onCancel, onConfirm }: AvatarAdjustModalProps) {
  if (!draft) return null;

  const zoom = clamp(adjustment.zoom || 1, 1, 3);
  const coverScale = draft.width > draft.height ? PREVIEW_SIZE / draft.height : PREVIEW_SIZE / draft.width;
  const displayWidth = draft.width * coverScale * zoom;
  const displayHeight = draft.height * coverScale * zoom;
  const maxX = Math.max(0, (displayWidth - PREVIEW_SIZE) / 2);
  const maxY = Math.max(0, (displayHeight - PREVIEW_SIZE) / 2);
  const left = (PREVIEW_SIZE - displayWidth) / 2 - clamp(adjustment.offsetX || 0, -1, 1) * maxX;
  const top = (PREVIEW_SIZE - displayHeight) / 2 - clamp(adjustment.offsetY || 0, -1, 1) * maxY;

  const update = (patch: Partial<AvatarAdjustment>) => {
    onChange({
      zoom: clamp(patch.zoom ?? adjustment.zoom, 1, 3),
      offsetX: clamp(patch.offsetX ?? adjustment.offsetX, -1, 1),
      offsetY: clamp(patch.offsetY ?? adjustment.offsetY, -1, 1),
    });
  };

  const nudge = (axis: 'offsetX' | 'offsetY', delta: number) => {
    update({ [axis]: clamp((adjustment[axis] || 0) + delta, -1, 1) } as Partial<AvatarAdjustment>);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.overlay} onPress={onCancel}>
        <Pressable style={styles.card} onPress={event => event.stopPropagation()}>
          <Text style={styles.title}>AJUSTAR AVATAR</Text>
          <Text style={styles.hint}>Centralize o rosto dentro do recorte circular.</Text>

          <View style={styles.previewFrame}>
            <Image
              source={{ uri: draft.uri }}
              style={[
                styles.previewImage,
                { width: displayWidth, height: displayHeight, left, top },
              ]}
            />
            <View pointerEvents="none" style={styles.previewRing} />
          </View>

          <View style={styles.controls}>
            <View style={styles.controlRow}>
              <TouchableOpacity style={styles.controlButton} onPress={() => nudge('offsetY', -0.12)}>
                <Ionicons name="arrow-up" size={20} color="#00bfff" />
              </TouchableOpacity>
            </View>
            <View style={styles.controlRow}>
              <TouchableOpacity style={styles.controlButton} onPress={() => nudge('offsetX', -0.12)}>
                <Ionicons name="arrow-back" size={20} color="#00bfff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.controlButton} onPress={() => update({ zoom: zoom - 0.12 })}>
                <Ionicons name="remove" size={20} color="#00bfff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.controlButton} onPress={() => update({ zoom: zoom + 0.12 })}>
                <Ionicons name="add" size={20} color="#00bfff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.controlButton} onPress={() => nudge('offsetX', 0.12)}>
                <Ionicons name="arrow-forward" size={20} color="#00bfff" />
              </TouchableOpacity>
            </View>
            <View style={styles.controlRow}>
              <TouchableOpacity style={styles.controlButton} onPress={() => nudge('offsetY', 0.12)}>
                <Ionicons name="arrow-down" size={20} color="#00bfff" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => update({ zoom: 1, offsetX: 0, offsetY: 0 })}>
              <Text style={styles.secondaryText}>Resetar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={onCancel}>
              <Text style={styles.secondaryText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={onConfirm}>
              <Text style={styles.primaryText}>Usar Avatar</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  card: { width: '100%', maxWidth: 420, alignItems: 'center', borderRadius: 22, padding: 18, backgroundColor: '#102b56', borderWidth: 1, borderColor: 'rgba(0,191,255,0.35)' },
  title: { color: '#fff', fontSize: 18, fontWeight: 'bold', letterSpacing: 1 },
  hint: { color: 'rgba(255,255,255,0.58)', fontSize: 12, textAlign: 'center', marginTop: 6, marginBottom: 16 },
  previewFrame: { width: PREVIEW_SIZE, height: PREVIEW_SIZE, borderRadius: PREVIEW_SIZE / 2, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.35)' },
  previewImage: { position: 'absolute' },
  previewRing: { ...StyleSheet.absoluteFillObject, borderRadius: PREVIEW_SIZE / 2, borderWidth: 3, borderColor: '#00fa9a' },
  controls: { width: '100%', gap: 8, marginTop: 16 },
  controlRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  controlButton: { width: 46, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,191,255,0.1)', borderWidth: 1, borderColor: 'rgba(0,191,255,0.32)' },
  actions: { width: '100%', flexDirection: 'row', gap: 8, marginTop: 18 },
  secondaryButton: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  secondaryText: { color: '#00bfff', fontSize: 12, fontWeight: 'bold' },
  primaryButton: { flex: 1.35, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00fa9a' },
  primaryText: { color: '#02112b', fontSize: 12, fontWeight: 'bold' },
});
