// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The main chat's bubble, for every other room that shows messages: the
// treehouse, the Fleet Room comms, the Story Shelf's table talk. Theirs, Oct 27
// 2026: 'all the settings should carry over to our chat tables other places
// ... You know me and my consistency thing.' The rooms used to draw their own
// plain cards; now they draw MessageBubble from one shared set of their settings,
// so anything the owner changes in Look & feel follows into every room with nothing
// to keep in sync.
import React, { createContext, useContext } from 'react';
import { MessageBubble } from './MessageBubble';
import type { ThemeConfig } from '../lib/theme';
import type { BubbleLook } from '../lib/bubble-look';
import type { VoiceCompanion } from '../lib/voices';
import type { Message, ThemeMode, CustomEmoji, EmojiPack } from '../types';

export interface RoomBubbleSettings {
  themeConfig: ThemeConfig;
  themeMode: ThemeMode;
  look: BubbleLook;
  ownerName?: string;
  userAvatar?: string;
  userAvatarColor?: string;
  customEmojis?: CustomEmoji[];
  emojiPacks?: EmojiPack[];
}

export const RoomBubbleContext = createContext<RoomBubbleSettings | null>(null);

export function useRoomBubbleSettings(): RoomBubbleSettings | null {
  return useContext(RoomBubbleContext);
}

export interface RoomBubbleProps {
  id: string;
  content: string;
  createdAt: string;
  /** Their message: their side, their bubble, their face. */
  fromOwner?: boolean;
  /** Which of us is speaking; null for the house or an unknown voice. */
  voice?: VoiceCompanion | null;
  groupPos?: 'only' | 'first' | 'middle' | 'last';
  /** One of us on their side of the room (the treehouse alternates). */
  mirror?: boolean;
}

/** Null outside the provider, so a room can fall back to its own card. */
export function RoomBubble({ id, content, createdAt, fromOwner = false, voice = null, groupPos = 'only', mirror = false }: RoomBubbleProps) {
  const s = useContext(RoomBubbleContext);
  if (!s) return null;
  const message: Message = {
    id,
    timestamp: createdAt,
    direction: fromOwner ? 'inbound' : 'outbound',
    content,
    read: 1,
    type: 'text',
  };
  return (
    <MessageBubble
      message={message}
      voice={fromOwner ? null : voice}
      groupPos={groupPos}
      mirror={!fromOwner && mirror}
      themeConfig={s.themeConfig}
      themeMode={s.themeMode}
      look={s.look}
      ownerName={s.ownerName}
      userAvatar={s.userAvatar}
      userAvatarColor={s.userAvatarColor}
      customEmojis={s.customEmojis}
      emojiPacks={s.emojiPacks}
      isPrivateTab={false}
    />
  );
}
