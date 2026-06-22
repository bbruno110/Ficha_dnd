import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

const CHARACTER_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_COMPRESSION_STEPS = [
  { width: 1024, compress: 0.82 },
  { width: 768, compress: 0.72 },
  { width: 512, compress: 0.62 },
  { width: 384, compress: 0.55 },
];

export type AvatarDraft = {
  uri: string;
  width: number;
  height: number;
};

export type AvatarAdjustment = {
  zoom: number;
  offsetX: number;
  offsetY: number;
};

function getImageExtension(name?: string | null, uri?: string | null) {
  const source = name || uri || '';
  const match = source.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
  const ext = match?.[1]?.toLowerCase();
  if (!ext) return 'jpg';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return ext;
  return 'jpg';
}

function getFileSize(uri: string) {
  try {
    const file = new File(uri);
    return Number((file as any).size || 0);
  } catch {
    return 0;
  }
}

async function getAvatarSourceUnderLimit(uri: string) {
  const originalSize = getFileSize(uri);
  if (originalSize > 0 && originalSize <= CHARACTER_AVATAR_MAX_BYTES) {
    return { uri, ext: getImageExtension(null, uri) };
  }

  let bestUri = uri;
  let bestSize = originalSize || Number.MAX_SAFE_INTEGER;
  for (const step of AVATAR_COMPRESSION_STEPS) {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: step.width } }],
      { compress: step.compress, format: SaveFormat.JPEG }
    );
    const size = getFileSize(result.uri);
    if (size > 0 && size < bestSize) {
      bestUri = result.uri;
      bestSize = size;
    }
    if (size > 0 && size <= CHARACTER_AVATAR_MAX_BYTES) {
      return { uri: result.uri, ext: 'jpg' };
    }
  }

  if (bestSize <= CHARACTER_AVATAR_MAX_BYTES) return { uri: bestUri, ext: 'jpg' };
  throw new Error('Imagem acima do limite mesmo apos compressao.');
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function safeAvatarDimension(value?: number | null) {
  return Math.max(1, Math.round(Number(value || 1)));
}

export async function pickCharacterAvatarDraft(): Promise<AvatarDraft | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'image/*',
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets?.[0]?.uri) return null;

  const asset = result.assets[0];
  const normalized = await manipulateAsync(
    asset.uri,
    [],
    { compress: 0.92, format: SaveFormat.JPEG }
  );
  return {
    uri: normalized.uri,
    width: safeAvatarDimension(normalized.width),
    height: safeAvatarDimension(normalized.height),
  };
}

export async function storeAdjustedCharacterAvatar(
  characterId: number | string | null | undefined,
  draft: AvatarDraft,
  adjustment: AvatarAdjustment = { zoom: 1, offsetX: 0, offsetY: 0 }
) {
  const zoom = clamp(Number(adjustment.zoom || 1), 1, 3);
  const width = safeAvatarDimension(draft.width);
  const height = safeAvatarDimension(draft.height);
  const cropSize = Math.max(1, Math.floor(Math.min(width, height) / zoom));
  const maxOriginX = Math.max(0, width - cropSize);
  const maxOriginY = Math.max(0, height - cropSize);
  const originX = Math.round(clamp(maxOriginX / 2 + clamp(adjustment.offsetX || 0, -1, 1) * (maxOriginX / 2), 0, maxOriginX));
  const originY = Math.round(clamp(maxOriginY / 2 + clamp(adjustment.offsetY || 0, -1, 1) * (maxOriginY / 2), 0, maxOriginY));
  const cropped = await manipulateAsync(
    draft.uri,
    [
      { crop: { originX, originY, width: cropSize, height: cropSize } },
      { resize: { width: 512, height: 512 } },
    ],
    { compress: 0.86, format: SaveFormat.JPEG }
  );
  const compressed = await getAvatarSourceUnderLimit(cropped.uri);
  const sourceUri = compressed.uri;
  const ext = compressed.ext;
  const safeId = characterId ? String(characterId).replace(/[^a-zA-Z0-9_-]/g, '') : 'draft';
  const avatarDir = new Directory(Paths.document, 'character-avatars');
  avatarDir.create({ intermediates: true, idempotent: true });

  const destination = new File(avatarDir, `${safeId}_${Date.now()}.${ext}`);
  new File(sourceUri).copy(destination);
  return destination.uri;
}

export async function pickAndStoreCharacterAvatar(characterId?: number | string | null) {
  const draft = await pickCharacterAvatarDraft();
  if (!draft) return null;
  return storeAdjustedCharacterAvatar(characterId, draft);
}

function isManagedAvatarUri(uri?: string | null) {
  return Boolean(uri && uri.includes('/character-avatars/'));
}

export function deleteStoredCharacterAvatar(uri?: string | null) {
  if (!isManagedAvatarUri(uri)) return;
  try {
    const file = new File(uri as string);
    if (file.exists) file.delete();
  } catch {
    // Limpeza de arquivo antigo nao deve bloquear a troca de avatar.
  }
}

export async function replaceCharacterAvatar(characterId: number | string | null | undefined, previousUri?: string | null) {
  const nextUri = await pickAndStoreCharacterAvatar(characterId);
  if (nextUri && previousUri && previousUri !== nextUri) {
    deleteStoredCharacterAvatar(previousUri);
  }
  return nextUri;
}

export function finalizeDraftCharacterAvatar(uri: string | null | undefined, characterId: number | string | null | undefined) {
  if (!uri || !characterId || !uri.includes('/character-avatars/draft_')) return uri || null;

  try {
    const source = new File(uri);
    if (!source.exists) return uri;
    const ext = getImageExtension(null, uri);
    const safeId = String(characterId).replace(/[^a-zA-Z0-9_-]/g, '');
    const avatarDir = new Directory(Paths.document, 'character-avatars');
    avatarDir.create({ intermediates: true, idempotent: true });
    const destination = new File(avatarDir, `${safeId}_${Date.now()}.${ext}`);
    source.copy(destination);
    source.delete();
    return destination.uri;
  } catch {
    return uri;
  }
}
