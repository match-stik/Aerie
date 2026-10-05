// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Local structural stand-ins for the handful of @anthropic-ai/claude-agent-sdk
 * and @anthropic-ai/sdk types the house used to borrow. Since the SDK
 * retirement (Jul 22, 2026) these are the only definitions — the packages
 * themselves are uninstalled.
 */

export type McpStdioServerConfig = {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpSSEServerConfig = {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
};

export type McpHttpServerConfig = {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
};

export type McpServerConfig =
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHttpServerConfig;

/** Anthropic Messages API image block (matches @anthropic-ai/sdk's shape). */
export interface ImageBlockParam {
  type: 'image';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string };
}
