// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Public surface of the Aerie integration layer.

export type {
  Message as AerieMessage,
  Thread,
  ThreadSummary,
  PresenceStatus,
  Canvas,
  MessageSegment,
  SystemStatus,
  McpServerInfo,
  CommandRegistryEntry,
  ClientMessage,
  ServerMessage,
  Reaction,
} from './protocol';

export type { AerieState, ConnectionState, ToolEvent, ThinkingEvent, ContextUsage, AuthState } from './store';
export { getState, setState, useAerie } from './store';

export {
  useConnectionState,
  useAuth,
  useMessages,
  useThreads,
  useActiveThreadId,
  usePresence,
  useUnreadCounts,
  useLastError,
  useContextUsage,
  useCompactionNotice,
  useRateLimitInfo,
  useLoadingThread,
  useCommandRegistry,
  useSystemStatus,
  useIsStreaming,
  useStreaming,
  useStreamingSegments,
  useTotalUnread,
  buildStreamingSegments,
} from './hooks';

export {
  connect,
  disconnect,
  proveAliveOrReconnect,
  send,
  loadThread,
  loadThreadAround,
  loadThreads,
  loadOlderMessages,
  switchThread,
  createThread,
  pinThread,
  unpinThread,
  sendUserMessage,
  sendUserMessageToThread,
  deleteMessage,
  editMessage,
  regenerateMessage,
  addReaction,
  removeReaction,
  stopGeneration,
  sendCommand,
  mcpToggle,
  mcpReconnect,
  markRead,
  requestStatus,
} from './socket';

export { toPhoneMessage, streamingToPhoneMessage, reactionsToEmojiList } from './adapter';
export { api, apiFetch, checkAuth, login, logout } from './api';
export {
  listEmojis,
  uploadEmoji,
  renameEmoji,
  deleteEmojiApi,
  syncEmojis,
  toCustomEmoji,
  listEmojiPacks,
} from './emojis';
export type { BackendEmoji } from './emojis';
export { loadStickers, getStickerPacks, resolveStickerRef } from './stickers';
export type { BackendSticker, BackendStickerPack } from './stickers';
export { AerieProvider } from './AerieProvider';
export { AerieLoginGate } from './AerieLoginGate';
export {
  startVoiceRecording,
  stopVoiceRecording,
  cancelVoiceRecording,
  clearTranscription,
  isRecordingSupported,
  isVoiceRecording,
} from './voice-recorder';
export type { VoiceRecordingMode, VoiceRecordingOptions } from './voice-recorder';
export {
  unlockVoicePlayback,
  stopVoicePlayback,
  suspendVoicePlayback,
  requestMessageTts,
  requestMessageTtsStream,
  isMessageTtsStreamUnavailable,
  playVoiceUrl,
  playVoiceSequence,
} from './voice-playback';
export type {
  MessageTtsResponse,
  MessageTtsStreamResponse,
  MessageTtsStreamSegment,
} from './voice-playback';
export { fetchServerSettings, pushServerSettings } from './settings-sync';
export type { ServerSettingsBlob } from './settings-sync';
