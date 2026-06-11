import { LanActiveRuntimeSync } from '@/services/lan/lanActiveRuntimeSync';
import { appColors, appGradients, layoutStyles as styles } from '@/styles/globalStyles';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import React, { useEffect } from 'react';
import { initializeDatabase } from '../database/init';
import { traceApp } from '../services/debug/appTrace';

export default function RootLayout() {
  useEffect(() => {
    traceApp('APP', 'APP_ROOT_RENDER', {
      screen: 'root',
      source: '_layout',
    });
  }, []);

  return (
    <SQLiteProvider databaseName="dnd_data_v008.db" onInit={initializeDatabase}>
      <LanActiveRuntimeSync />
      <ThemeProvider value={DarkTheme}>
        <LinearGradient
          colors={appGradients.main}
          style={styles.root}
        >
          <Stack
            screenOptions={{
              headerTransparent: true,
              headerTintColor: appColors.textPrimary,
              contentStyle: styles.transparentContent,
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="create" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="sessionJoin" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="lan-session" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="sheet" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="edit" options={{ headerShown: false }} />
            <Stack.Screen name="debug-trace" options={{ headerShown: false }} />
          </Stack>
        </LinearGradient>
      </ThemeProvider>
    </SQLiteProvider>
  );
}
