import { useLanSession } from '@/contexts/LanSessionContext';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef } from 'react';
import SinglePlayerSheetScreen from '../single-player/SinglePlayerSheetScreen';

type MultiplayerSheetScreenProps = {
  characterId?: string | string[] | number;
};

export default function MultiplayerSheetScreen({ characterId }: MultiplayerSheetScreenProps) {
  const router = useRouter();
  const { activeSession, broadcastCharacter, lanRevision } = useLanSession();
  const navigationLockRef = useRef(false);

  const syncAdapter = useMemo(
    () => ({
      enabled: Boolean(activeSession && activeSession.status !== 'paused'),
      onCharacterChanged: broadcastCharacter,
    }),
    [activeSession, broadcastCharacter]
  );

  const openSyncSession = useCallback(() => {
    if (navigationLockRef.current) return;
    navigationLockRef.current = true;
    router.navigate('/lan-session' as any);
    setTimeout(() => {
      navigationLockRef.current = false;
    }, 700);
  }, [router]);

  return (
    <SinglePlayerSheetScreen
      characterId={characterId}
      syncAdapter={syncAdapter}
      onOpenSyncSession={openSyncSession}
      externalRevision={lanRevision}
    />
  );
}
