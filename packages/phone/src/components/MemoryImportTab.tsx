// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Memory app's Import tab: old chats back word for word. It brings in
// chats as well as anything a wall might hold, so it sits beside Cortex,
// Blocks, Self-Knowledge and Compactions rather than inside Blocks.
import React from 'react';
import type { ThemeConfig } from '../lib/theme';
import { ConversationImportPanel } from './ConversationImportPanel';

interface Props {
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
}

export function MemoryImportTab({ themeConfig, themeMode }: Props) {
  const colors = themeConfig[themeMode];
  return (
    <div className="space-y-4">
      <ConversationImportPanel colors={colors} />
    </div>
  );
}
