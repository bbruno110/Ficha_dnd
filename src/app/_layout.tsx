import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { LanSessionProvider } from '../contexts/LanSessionContext';
import { initializeDatabase } from '../database/init';

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName="dnd_dados4.db" onInit={initializeDatabase}>
      <LanSessionProvider>
        <ThemeProvider value={DarkTheme}>
          <LinearGradient
            colors={['#102b56', '#02112b']} 
            style={{ flex: 1 }}
          >
            <Stack
              screenOptions={{
                headerTransparent: true,
                headerTintColor: '#fff',
                contentStyle: { backgroundColor: 'transparent' },
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="create" options={{ headerShown: false }} />
              <Stack.Screen name="grimorio" options={{ headerShown: false }} />
              <Stack.Screen name="lan-session" options={{ headerShown: false }} />
              <Stack.Screen name="lan-master-setup" options={{ headerShown: false }} />
              <Stack.Screen name="lan-player-join" options={{ headerShown: false }} />
              <Stack.Screen name="tracer" options={{ headerShown: false }} />
            </Stack>
          </LinearGradient>
        </ThemeProvider>
      </LanSessionProvider>
    </SQLiteProvider>
  );
}
