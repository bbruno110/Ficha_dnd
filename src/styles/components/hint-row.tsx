import React, { type ReactNode } from 'react';
import { View } from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { hintRowStyles as styles } from '@/styles/globalStyles';

type HintRowProps = {
  title?: string;
  hint?: ReactNode;
};

export function HintRow({ title = 'Try editing', hint = 'app/index.tsx' }: HintRowProps) {
  return (
    <View style={styles.stepRow}>
      <ThemedText type="small">{title}</ThemedText>
      <ThemedView type="backgroundSelected" style={styles.codeSnippet}>
        <ThemedText themeColor="textSecondary">{hint}</ThemedText>
      </ThemedView>
    </View>
  );
}
