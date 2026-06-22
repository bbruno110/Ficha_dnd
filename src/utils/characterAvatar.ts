import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

function getImageExtension(name?: string | null, uri?: string | null) {
  const source = name || uri || '';
  const match = source.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
  const ext = match?.[1]?.toLowerCase();
  if (!ext) return 'jpg';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return ext;
  return 'jpg';
}

export async function pickAndStoreCharacterAvatar(characterId?: number | string | null) {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'image/*',
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets?.[0]?.uri) return null;

  const asset = result.assets[0];
  const sourceUri = asset.uri;
  const ext = getImageExtension(asset.name, sourceUri);
  const safeId = characterId ? String(characterId).replace(/[^a-zA-Z0-9_-]/g, '') : 'draft';
  const avatarDir = new Directory(Paths.document, 'character-avatars');
  avatarDir.create({ intermediates: true, idempotent: true });

  const destination = new File(avatarDir, `${safeId}_${Date.now()}.${ext}`);
  new File(sourceUri).copy(destination);
  return destination.uri;
}
