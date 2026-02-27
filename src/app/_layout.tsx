import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { initializeDatabase } from '../database/init';

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName="dnd_sheet.db" onInit={initializeDatabase}>
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
            {/* Telas */}
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="create" options={{ headerShown: false }} />
          </Stack>
        </LinearGradient>
      </ThemeProvider>
    </SQLiteProvider>
  );
}