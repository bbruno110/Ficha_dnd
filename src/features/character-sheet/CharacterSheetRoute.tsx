import { useLanSession } from '@/contexts/LanSessionContext';
import { useLocalSearchParams } from 'expo-router';
import MultiplayerSheetScreen from './multiplayer/MultiplayerSheetScreen';
import SinglePlayerSheetScreen from './single-player/SinglePlayerSheetScreen';

export default function CharacterSheetRoute() {
  const { id } = useLocalSearchParams();
  const { activeSession } = useLanSession();
  const characterId = Array.isArray(id) ? Number(id[0]) : Number(id);

  if (activeSession?.linked_character_id && Number(activeSession.linked_character_id) === characterId) {
    return <MultiplayerSheetScreen characterId={id} />;
  }

  return <SinglePlayerSheetScreen characterId={id} />;
}
