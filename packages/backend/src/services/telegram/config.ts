// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Telegram configuration — DB-backed with config.yaml fallback defaults

import { getConfig, getConfigNumber } from '../db.js';
import { getAerieConfig } from '../../config.js';
import type { TelegramConfigValues } from './types.js';

const DEFAULTS = {
  maxMessageLength: 4096,
};

export function getTelegramConfig(): TelegramConfigValues {
  const appConfig = getAerieConfig();
  return {
    ownerChatId: getConfig('telegram.ownerChatId') || appConfig.telegram.owner_chat_id || '',
    maxMessageLength: getConfigNumber('telegram.maxMessageLength', DEFAULTS.maxMessageLength),
  };
}
