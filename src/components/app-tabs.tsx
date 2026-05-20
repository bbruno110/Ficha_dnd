import { NativeTabs } from 'expo-router/unstable-native-tabs';
import React from 'react';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

const NativeTabTrigger = NativeTabs.Trigger as typeof NativeTabs.Trigger & {
  Label: React.ComponentType<React.PropsWithChildren>;
  Icon: React.ComponentType<{ renderingMode?: string; src: number }>;
};

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme ?? 'light'];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabTrigger name="index">
        <NativeTabTrigger.Label>Home</NativeTabTrigger.Label>
        <NativeTabTrigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabTrigger>

      <NativeTabTrigger name="explore">
        <NativeTabTrigger.Label>Explore</NativeTabTrigger.Label>
        <NativeTabTrigger.Icon
          src={require('@/assets/images/tabIcons/explore.png')}
          renderingMode="template"
        />
      </NativeTabTrigger>
    </NativeTabs>
  );
}
