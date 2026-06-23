import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Modal, PanResponder, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AvatarAdjustment, AvatarDraft } from '../utils/characterAvatar';

type AvatarAdjustModalProps = {
  draft: AvatarDraft | null;
  adjustment: AvatarAdjustment;
  onChange: (next: AvatarAdjustment) => void;
  onCancel: () => void;
  onConfirm: (next: AvatarAdjustment) => void;
};

const PREVIEW_SIZE = 220;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function touchDistance(touches: { pageX: number; pageY: number }[]) {
  if (touches.length < 2) return 0;
  const [first, second] = touches;
  const dx = first.pageX - second.pageX;
  const dy = first.pageY - second.pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

export default function AvatarAdjustModal({ draft, adjustment, onChange, onCancel, onConfirm }: AvatarAdjustModalProps) {
  const [localAdjustment, setLocalAdjustment] = React.useState<AvatarAdjustment>(adjustment);
  const localAdjustmentRef = React.useRef<AvatarAdjustment>(adjustment);
  const gestureStartRef = React.useRef({
    offsetX: 0,
    offsetY: 0,
    zoom: 1,
    distance: 0,
  });

  React.useEffect(() => {
    const next = {
      zoom: clamp(adjustment.zoom || 1, 1, 3),
      offsetX: clamp(adjustment.offsetX || 0, -1, 1),
      offsetY: clamp(adjustment.offsetY || 0, -1, 1),
    };
    localAdjustmentRef.current = next;
    setLocalAdjustment(next);
  }, [adjustment.offsetX, adjustment.offsetY, adjustment.zoom, draft?.uri]);

  const zoom = clamp(localAdjustment.zoom || 1, 1, 3);
  const draftWidth = draft?.width || PREVIEW_SIZE;
  const draftHeight = draft?.height || PREVIEW_SIZE;
  const coverScale = draftWidth > draftHeight ? PREVIEW_SIZE / draftHeight : PREVIEW_SIZE / draftWidth;
  const displayWidth = draftWidth * coverScale * zoom;
  const displayHeight = draftHeight * coverScale * zoom;
  const maxX = Math.max(0, (displayWidth - PREVIEW_SIZE) / 2);
  const maxY = Math.max(0, (displayHeight - PREVIEW_SIZE) / 2);
  const left = (PREVIEW_SIZE - displayWidth) / 2 - clamp(localAdjustment.offsetX || 0, -1, 1) * maxX;
  const top = (PREVIEW_SIZE - displayHeight) / 2 - clamp(localAdjustment.offsetY || 0, -1, 1) * maxY;

  const update = React.useCallback((patch: Partial<AvatarAdjustment>) => {
    const current = localAdjustmentRef.current;
    const next = {
      zoom: clamp(patch.zoom ?? current.zoom, 1, 3),
      offsetX: clamp(patch.offsetX ?? current.offsetX, -1, 1),
      offsetY: clamp(patch.offsetY ?? current.offsetY, -1, 1),
    };
    localAdjustmentRef.current = next;
    setLocalAdjustment(next);
  }, []);

  const confirmAdjustment = React.useCallback(() => {
    const next = localAdjustmentRef.current;
    onChange(next);
    onConfirm(next);
  }, [onChange, onConfirm]);

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: event => {
          gestureStartRef.current = {
            offsetX: clamp(localAdjustmentRef.current.offsetX || 0, -1, 1),
            offsetY: clamp(localAdjustmentRef.current.offsetY || 0, -1, 1),
            zoom: clamp(localAdjustmentRef.current.zoom || 1, 1, 3),
            distance: touchDistance(event.nativeEvent.touches as { pageX: number; pageY: number }[]),
          };
        },
        onPanResponderMove: (event, gesture) => {
          const start = gestureStartRef.current;
          const touches = event.nativeEvent.touches as { pageX: number; pageY: number }[];
          const currentDistance = touchDistance(touches);
          const nextZoom = touches.length >= 2 && start.distance > 0 && currentDistance > 0
            ? clamp(start.zoom * (currentDistance / start.distance), 1, 3)
            : start.zoom;

          const nextDisplayWidth = draftWidth * coverScale * nextZoom;
          const nextDisplayHeight = draftHeight * coverScale * nextZoom;
          const nextMaxX = Math.max(0, (nextDisplayWidth - PREVIEW_SIZE) / 2);
          const nextMaxY = Math.max(0, (nextDisplayHeight - PREVIEW_SIZE) / 2);

          update({
            zoom: nextZoom,
            offsetX: nextMaxX > 1 ? clamp(start.offsetX - gesture.dx / nextMaxX, -1, 1) : 0,
            offsetY: nextMaxY > 1 ? clamp(start.offsetY - gesture.dy / nextMaxY, -1, 1) : 0,
          });
        },
      }),
    [coverScale, draftHeight, draftWidth, update]
  );

  if (!draft) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.overlay} onPress={onCancel}>
        <Pressable style={styles.card} onPress={event => event.stopPropagation()}>
          <Text style={styles.title}>AJUSTAR AVATAR</Text>
          <Text style={styles.hint}>Arraste a imagem com o dedo e use pinça para aproximar o rosto.</Text>

          <View style={styles.previewFrame} {...panResponder.panHandlers}>
            <Image
              source={{ uri: draft.uri }}
              style={[
                styles.previewImage,
                { width: displayWidth, height: displayHeight, left, top },
              ]}
            />
            <View pointerEvents="none" style={styles.previewRing} />
          </View>
          <View style={styles.gesturePill}>
            <Ionicons name="hand-left-outline" size={15} color="#00bfff" />
            <Text style={styles.gestureText}>Arraste para centralizar. Use pinça ou +/- para zoom.</Text>
          </View>

          <View style={styles.zoomControls}>
            <TouchableOpacity style={styles.zoomButton} onPress={() => update({ zoom: zoom - 0.12 })}>
              <Ionicons name="remove" size={18} color="#00bfff" />
            </TouchableOpacity>
            <View style={styles.zoomTrack}>
              <View style={[styles.zoomFill, { width: `${((zoom - 1) / 2) * 100}%` }]} />
            </View>
            <TouchableOpacity style={styles.zoomButton} onPress={() => update({ zoom: zoom + 0.12 })}>
              <Ionicons name="add" size={18} color="#00bfff" />
            </TouchableOpacity>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => update({ zoom: 1, offsetX: 0, offsetY: 0 })}>
              <Text style={styles.secondaryText}>Resetar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={onCancel}>
              <Text style={styles.secondaryText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={confirmAdjustment}>
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
  gesturePill: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(0,191,255,0.08)', borderWidth: 1, borderColor: 'rgba(0,191,255,0.22)' },
  gestureText: { color: 'rgba(255,255,255,0.62)', fontSize: 11, fontWeight: 'bold' },
  zoomControls: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  zoomButton: { width: 42, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,191,255,0.08)', borderWidth: 1, borderColor: 'rgba(0,191,255,0.24)' },
  zoomTrack: { flex: 1, height: 8, borderRadius: 999, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.1)' },
  zoomFill: { height: '100%', borderRadius: 999, backgroundColor: '#00fa9a' },
  actions: { width: '100%', flexDirection: 'row', gap: 8, marginTop: 18 },
  secondaryButton: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  secondaryText: { color: '#00bfff', fontSize: 12, fontWeight: 'bold' },
  primaryButton: { flex: 1.35, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00fa9a' },
  primaryText: { color: '#02112b', fontSize: 12, fontWeight: 'bold' },
});
