// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { McpServerConfig } from './claude-types.js';
import type { McpServerInfo } from '@aerie/shared';
import { getAllConfig, setConfig } from '../db.js';

const CC_KEYWORDS = [
  'task', 'todo', 'tasks', 'project', 'expense', 'budget', 'money',
  'cycle', 'period', 'wellness', 'health', 'pet', 'cat', 'cats',
  'countdown', 'calendar', 'daily win', 'scratchpad', 'note',
];

const MIND_KEYWORDS = [
  'remember', 'forget', 'memory', 'feel', 'feeling', 'mood',
  'dream', 'journal', 'identity', 'tension', 'resolve', 'sit with',
  'pattern', 'emotion', 'weather', 'recall', 'what do i think',
];

function hasKeywordIntent(message: string | undefined, keywords: string[]): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return keywords.some(kw => {
    const pattern = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return pattern.test(normalized);
  });
}

function isCcServer(name: string, url?: string): boolean {
  const nameLower = name.toLowerCase();
  if (nameLower.includes('command') || nameLower.includes('cc')) return true;
  if (url && url.endsWith('/mcp/cc')) return true;
  return false;
}

function isMindServer(name: string): boolean {
  return name.toLowerCase().includes('mind');
}

export function getDisabledMcpServers(): string[] {
  const config = getAllConfig();
  const disabled = config['mcp.disabled_servers'];
  if (!disabled) return [];
  try {
    return JSON.parse(disabled);
  } catch {
    return [];
  }
}

export function setDisabledMcpServers(servers: string[]): void {
  setConfig('mcp.disabled_servers', JSON.stringify(servers));
}

export function buildMcpStatusWithDisabled(
  sdkStatuses: McpServerInfo[],
  mcpServersFromConfig: Record<string, McpServerConfig>,
): McpServerInfo[] {
  const disabledServers = getDisabledMcpServers();
  const result = [...sdkStatuses];

  for (const status of result) {
    if (disabledServers.includes(status.name)) {
      status.status = 'disabled';
    }
  }

  const reportedNames = new Set(result.map(s => s.name));
  for (const name of disabledServers) {
    if (!reportedNames.has(name) && mcpServersFromConfig[name]) {
      result.push({
        name,
        status: 'disabled',
        toolCount: 0,
      });
    }
  }

  return result;
}

export function filterMcpServers(
  servers: Record<string, McpServerConfig>,
  content: string,
  isAutonomous: boolean,
  isFirstMessage: boolean,
): Record<string, McpServerConfig> {
  const disabledServers = getDisabledMcpServers();
  const working: Record<string, McpServerConfig> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    if (!disabledServers.includes(name)) {
      working[name] = cfg;
    }
  }

  if (isAutonomous || isFirstMessage) return working;

  const needsCc = hasKeywordIntent(content, CC_KEYWORDS);
  const needsMind = hasKeywordIntent(content, MIND_KEYWORDS);

  const filtered: Record<string, McpServerConfig> = {};
  for (const [name, cfg] of Object.entries(working)) {
    const url = (cfg as any).url as string | undefined;
    const isCC = isCcServer(name, url);
    const isMind = isMindServer(name);

    if (isCC && !needsCc) continue;
    if (isMind && !needsMind) continue;
    filtered[name] = cfg;
  }

  return filtered;
}
