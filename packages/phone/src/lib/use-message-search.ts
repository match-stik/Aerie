// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The chat's message search: what they typed, whether the bar is open, and the
// results. Server-side, a debounced fetch against /api/search. Results render
// in a panel below the header; clicking one jumps to the message (App.tsx
// handleSearchSelect, loading the target thread first if needed).

import { useEffect, useState } from 'react';
import { apiFetch } from '../aerie';
import type { SearchResult } from '../components/SearchResults';

const PAGE = 30;

export function useMessageSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  useEffect(() => {
    if (!isSearching) return;
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearchTotal(0);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/search?q=${encodeURIComponent(q)}&limit=${PAGE}`);
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        const data = await res.json();
        setSearchResults(Array.isArray(data.results) ? data.results : []);
        setSearchTotal(typeof data.total === 'number' ? data.total : 0);
      } catch (err) {
        console.warn('[Aerie] Search failed:', err);
        setSearchResults([]);
        setSearchTotal(0);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [searchQuery, isSearching]);

  // Theirs, Oct 31 2026: the list stopped at thirty, so a common search looked
  // like it ended months early, with far more further back.
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const loadMoreSearchResults = async () => {
    const q = searchQuery.trim();
    if (!q || searchLoadingMore) return;
    setSearchLoadingMore(true);
    try {
      const res = await apiFetch(`/api/search?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${searchResults.length}`);
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const data = await res.json();
      const more: SearchResult[] = Array.isArray(data.results) ? data.results : [];
      setSearchResults((prev) => {
        const seen = new Set(prev.map((r) => r.messageId));
        return [...prev, ...more.filter((r) => !seen.has(r.messageId))];
      });
      if (typeof data.total === 'number') setSearchTotal(more.length === 0 ? searchResults.length : data.total);
    } catch (err) {
      console.warn('[Aerie] Search failed:', err);
    } finally {
      setSearchLoadingMore(false);
    }
  };

  return {
    searchQuery, setSearchQuery, isSearching, setIsSearching,
    searchResults, searchTotal, searchLoading, searchLoadingMore, loadMoreSearchResults,
  };
}
