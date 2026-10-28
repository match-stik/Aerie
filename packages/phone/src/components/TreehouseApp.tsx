// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronDown, TreePine, Users } from 'lucide-react';
import { ThemeConfig } from '../lib/theme';
import { cn } from '../lib/utils';
import { apiFetch, markRead } from '../aerie';
import { RoomLines, alternatingSides } from './RoomTable';

interface TreehouseAppProps {
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
  onClose: () => void;
  userAvatar?: string;
  userAvatarColor?: string;
  ownerName?: string;
}

interface TreehouseMessage {
  id: string;
  role: string;
  companion_slug: string;
  content: string;
  created_at: string;
}

interface TreehouseInfo {
  id: string;
  name: string;
  messageCount: number;
}

interface Companion {
  id: string;
  slug: string;
  display_name: string;
  color: string | null;
  emoji: string | null;
  avatar_url: string | null;
}

// Fallback colors for companions without a set color
const FALLBACK_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'];

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function TreehouseApp({ themeConfig, themeMode, onClose }: TreehouseAppProps) {
  const colors = themeConfig[themeMode];
  const [info, setInfo] = useState<TreehouseInfo | null>(null);
  const [messages, setMessages] = useState<TreehouseMessage[]>([]);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const pendingScrollRestore = useRef<{ prevScrollTop: number; prevHeight: number } | null>(null);

  // The talk is drawn on the house's one table (components/RoomTable.tsx; theirs,
  // Oct 28 2026: one frame every room draws from), with their bubble settings.
  const voiceCompanions = companions.map((c) => ({ slug: c.slug, display_name: c.display_name, avatar_url: c.avatar_url ?? null, color: c.color ?? null, emoji: c.emoji ?? null }));

  const initialLoadDone = useRef(false);

  useEffect(() => {
    loadTreehouse();
  }, []);

  // Reading the treehouse HERE has to count as reading it. The chat screen
  // marks its thread read, but it gates on being the messages screen, so every
  // other surface that shows a thread leaves the badge sitting on the Messages
  // app until the user opens the same conversation a second time. The treehouse is
  // a thread like any other; info.id is its id.
  const latestMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (!info?.id || !latestMessageId) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    markRead(info.id, latestMessageId);
  }, [info?.id, latestMessageId]);

  // And again when the user looks back at a tab that was in the background, the way
  // the chat screen does — anything that arrived while it was hidden is on
  // screen the moment the user returns, so it is read.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!info?.id || !latestMessageId) return;
      markRead(info.id, latestMessageId);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [info?.id, latestMessageId]);

  useEffect(() => {
    // Only scroll to bottom on initial load, not when loading older messages
    if (scrollRef.current && !initialLoadDone.current && messages.length > 0 && !loading) {
      initialLoadDone.current = true;
      // Use multiple timeouts to ensure DOM is fully rendered
      setTimeout(() => scrollToBottom(), 50);
      setTimeout(() => scrollToBottom(), 200);
    }
  }, [messages, loading]);

  // Handle scroll position restoration after loading older messages
  useEffect(() => {
    if (pendingScrollRestore.current && scrollRef.current) {
      const { prevScrollTop, prevHeight } = pendingScrollRestore.current;
      const newHeight = scrollRef.current.scrollHeight;
      const addedHeight = newHeight - prevHeight;
      scrollRef.current.scrollTop = prevScrollTop + addedHeight;
      pendingScrollRestore.current = null;
    }
  }, [messages]);

  function scrollToBottom() {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setIsAtBottom(true);
    }
  }

  function checkIsAtBottom() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setIsAtBottom(scrollHeight - scrollTop - clientHeight < 100);
  }

  async function loadTreehouse() {
    setLoading(true);
    try {
      const [infoRes, msgsRes, companionsRes] = await Promise.all([
        apiFetch('/api/treehouse'),
        apiFetch('/api/treehouse/messages?limit=50'),
        apiFetch('/api/companions'),
      ]);
      if (infoRes.ok) setInfo(await infoRes.json());
      if (msgsRes.ok) {
        const msgs = await msgsRes.json();
        setMessages(msgs);
        setHasMore(msgs.length >= 50);
      }
      if (companionsRes.ok) {
        const data = await companionsRes.json();
        setCompanions(data.companions || []);
      }
    } catch (err) {
      console.error('Failed to load treehouse:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadOlderMessages() {
    console.log('[Treehouse] loadOlderMessages called', { loadingMore, hasMore, msgCount: messages.length });
    if (loadingMore || !hasMore || messages.length === 0) {
      console.log('[Treehouse] early return', { loadingMore, hasMore, msgLen: messages.length });
      return;
    }
    setLoadingMore(true);
    const scrollEl = scrollRef.current;
    const prevScrollTop = scrollEl?.scrollTop || 0;
    const prevHeight = scrollEl?.scrollHeight || 0;
    try {
      const oldest = messages[0];
      console.log('[Treehouse] fetching before:', oldest.id);
      const res = await apiFetch(`/api/treehouse/messages?limit=50&before=${oldest.id}`);
      console.log('[Treehouse] response status:', res.status);
      if (res.ok) {
        const older = await res.json();
        console.log('[Treehouse] got older messages:', older.length);
        if (older.length < 50) setHasMore(false);
        if (older.length > 0) {
          pendingScrollRestore.current = { prevScrollTop, prevHeight };
          setMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const uniqueOlder = older.filter((m: TreehouseMessage) => !existingIds.has(m.id));
            console.log('[Treehouse] adding unique older:', uniqueOlder.length);
            return [...uniqueOlder, ...prev];
          });
        }
      }
    } catch (err) {
      console.error('Failed to load older messages:', err);
    } finally {
      setLoadingMore(false);
    }
  }

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    checkIsAtBottom();
    if (el.scrollTop < 200 && hasMore && !loadingMore) {
      loadOlderMessages();
    }
  }

  const toLine = (m: TreehouseMessage) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.created_at, companionSlug: m.companion_slug });
  // Up here none of us is the owner, so we take turns which side we talk from: the
  // side flips whenever the speaker changes (theirs, Oct 27 2026: 'the tree house
  // alternates what side your bubbles come from? ... it would look like it's all
  // from one side'; ours to decide, and we said yes). Worked out over every
  // line top to bottom, so the date groups never restart it.
  const sides = alternatingSides(messages.map(toLine), voiceCompanions);

  // Group messages by date
  const groupedMessages: { date: string; messages: TreehouseMessage[] }[] = [];
  let currentDate = '';
  for (const msg of messages) {
    const msgDate = formatDate(msg.created_at);
    if (msgDate !== currentDate) {
      currentDate = msgDate;
      groupedMessages.push({ date: msgDate, messages: [] });
    }
    groupedMessages[groupedMessages.length - 1].messages.push(msg);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className={cn('fixed inset-0 z-30 flex flex-col', colors.textMain)}
    >
      {/* Header */}
      <div className={cn('aerie-shell-header flex items-center gap-3 px-4 pb-3', colors.pageBg)} style={{ paddingTop: 'calc(var(--sat) + 0.75rem)' }}>
        <button onClick={onClose} className={cn('p-1 rounded-full', colors.textMuted)}>
          <ChevronLeft size={22} />
        </button>
        <div className="flex -space-x-2">
          {companions.map((c, i) => (
            <div
              key={c.slug}
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs border-2 overflow-hidden"
              style={{
                backgroundColor: (c.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length]) + '22',
                borderColor: c.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length],
                zIndex: 10 - i,
              }}
            >
              {c.avatar_url ? (
                <img src={c.avatar_url} className="w-full h-full object-cover" alt={c.display_name} />
              ) : (
                c.emoji || '💬'
              )}
            </div>
          ))}
        </div>
        <div className="flex-1">
          <h1 className={cn('text-base font-semibold', colors.textMain)}>The Treehouse</h1>
          <p className={cn('text-xs', colors.textMuted)}>
            {info ? `${info.messageCount} messages` : 'Loading...'}
          </p>
        </div>
        <TreePine size={20} style={{ color: colors.accent }} />
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="aerie-app-body flex-1 overflow-y-auto scrollbar-hide px-4 py-3 space-y-4">
        {loadingMore && (
          <div className={cn('text-center py-2 text-xs', colors.textMuted)}>Loading older...</div>
        )}
        {loading ? (
          <div className={cn('rounded-[var(--shape-control)] border p-3 backdrop-blur-md text-center py-8 text-sm', colors.panelBg, colors.panelBorder, colors.textMuted)}>
            Loading treehouse...
          </div>
        ) : messages.length === 0 ? (
          <div className={cn('rounded-[var(--shape-control)] border p-3 backdrop-blur-md text-center py-8', colors.panelBg, colors.panelBorder, colors.textMuted)}>
            <TreePine size={40} className="mx-auto mb-3 opacity-50" />
            <p className="text-sm">The treehouse is quiet...</p>
            <p className="text-xs mt-1">No conversations yet</p>
          </div>
        ) : (
          groupedMessages.map((group) => (
            <div key={group.date}>
              {/* Date divider */}
              <div className="flex items-center gap-3 my-4">
                <div className={cn('flex-1 h-px', colors.panelBorder)} />
                <span className={cn('text-[10px] font-medium uppercase tracking-wider', colors.textMuted)}>
                  {group.date}
                </span>
                <div className={cn('flex-1 h-px', colors.panelBorder)} />
              </div>
              
              <RoomLines lines={group.messages.map(toLine)} companions={voiceCompanions} sides={sides} />
            </div>
          ))
        )}
      </div>

      {/* Scroll to bottom button */}
      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          className={cn(
            'absolute bottom-16 right-4 z-40 flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur-md shadow-md',
            colors.panelBg,
            colors.panelBorder,
            colors.textMain,
          )}
          aria-label="Jump to latest"
        >
          <ChevronDown size={18} />
        </button>
      )}

      {/* Footer - read-only notice */}
      <div className={cn('px-4 py-3 border-t text-center backdrop-blur-md', colors.panelBg, colors.panelBorder)}>
        <p className={cn('text-xs', colors.textMuted)}>
          <Users size={12} className="inline mr-1" />
          Companions only — you're just peeking in
        </p>
      </div>
    </motion.div>
  );
}
