// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Memory app's Import tab: old chats back word for word, and a Letta
// companion's memory. It brings in chats as well as walls, so it is its own
// tab beside Cortex, Blocks, Self-Knowledge and Compactions.
import React, { useEffect, useState } from 'react';
import type { ThemeConfig } from '../lib/theme';
import { ConversationImportPanel } from './ConversationImportPanel';
import { LettaImportPanel } from './LettaImportPanel';

interface Props {
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
}

export function MemoryImportTab({ themeConfig, themeMode }: Props) {
  const colors = themeConfig[themeMode];
  const [companions, setCompanions] = useState<string[] | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let live = true;
    fetch('/api/companions', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (live) setCompanions((data?.companions ?? []).map((c: { slug: string }) => c.slug)); })
      .catch(() => { if (live) setCompanions([]); });
    return () => { live = false; };
  }, [refresh]);

  return (
    <div className="space-y-4">
      <ConversationImportPanel colors={colors} />
      {companions && (
        <LettaImportPanel
          key={companions.join(',')}
          companions={companions}
          colors={colors}
          onImported={() => setRefresh((n) => n + 1)}
        />
      )}
    </div>
  );
}
