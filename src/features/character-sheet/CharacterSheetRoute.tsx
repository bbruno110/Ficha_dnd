import { useLanSession } from '@/contexts/LanSessionContext';
import { useLocalSearchParams } from 'expo-router';
import MultiplayerSheetScreen from './multiplayer/MultiplayerSheetScreen';
import SinglePlayerSheetScreen from './single-player/SinglePlayerSheetScreen';

export default function CharacterSheetRoute() {
  const { id } = useLocalSearchParams();
  const { activeSession } = useLanSession();

  if (activeSession) {
    return <MultiplayerSheetScreen characterId={id} />;
  }

  return <SinglePlayerSheetScreen characterId={id} />;
}
