// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import React, { useState } from 'react';
import { Plug } from 'lucide-react';
import { AppShell } from './AppShell';
import { ProvidersApp } from './ProvidersApp';
import { DiscordApp } from './DiscordApp';
import { McpApp } from './McpApp';
import { SecretsManager } from './SecretsManager';
import { IntegrationsToggles } from './IntegrationsToggles';
import { VoiceUsageMeter } from './VoiceUsageMeter';
import { SubscriptionUsageMeters } from './SubscriptionUsageMeters';
import { ThemeConfig } from '../lib/theme';
import { cn } from '../lib/utils';

interface IntegrationsAppProps {
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
}

type Tab = 'providers' | 'discord' | 'mcp' | 'secrets';
const TABS: { id: Tab; label: string }[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'discord', label: 'Discord' },
  { id: 'mcp', label: 'MCP' },
  { id: 'secrets', label: 'Secrets' },
];

// Grouped wrapper for external-service plumbing: model provider API keys
// (incl. Codex auth), the Discord bot + rules, and the MCP server roster
// (SDK auto-detected + managed HTTP).
export function IntegrationsApp({ onClose, themeConfig, themeMode }: IntegrationsAppProps) {
  const colors = themeConfig[themeMode];
  const [tab, setTab] = useState<Tab>('providers');

  return (
    <AppShell title="Integrations" icon={Plug} onClose={onClose} themeConfig={themeConfig} themeMode={themeMode}>
      <IntegrationsToggles themeConfig={themeConfig} themeMode={themeMode} />
      <VoiceUsageMeter themeConfig={themeConfig} themeMode={themeMode} />
      <SubscriptionUsageMeters themeConfig={themeConfig} themeMode={themeMode} />

      <div className={cn("p-3 rounded-2xl border backdrop-blur-md mb-4 flex justify-center", colors.panelBg, colors.panelBorder)}>
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn('shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border', colors.panelBorder, tab !== t.id && colors.panelBg)}
              style={tab === t.id ? { background: colors.accent, color: 'var(--aerie-on-accent)', borderColor: colors.accent } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'providers' && <ProvidersApp embedded onClose={onClose} themeConfig={themeConfig} themeMode={themeMode} />}
      {tab === 'discord' && <DiscordApp embedded onClose={onClose} themeConfig={themeConfig} themeMode={themeMode} />}
      {tab === 'mcp' && <McpApp embedded onClose={onClose} themeConfig={themeConfig} themeMode={themeMode} />}
      {tab === 'secrets' && (
        <SecretsManager themeConfig={themeConfig} themeMode={themeMode} />
      )}
    </AppShell>
  );
}
