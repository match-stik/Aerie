// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import React, { useEffect, useState } from 'react';
import { Plus, ChevronLeft, X, Check } from 'lucide-react';
import { ThemeConfig } from '../../lib/theme';
import { cn } from '../../lib/utils';
import { apiFetch } from '../../aerie';

const CC_API = '/api/cc';

interface CcSubPageProps {
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
}

export function CcLists({ themeConfig, themeMode }: CcSubPageProps) {
  const colors = themeConfig[themeMode];
  const [loading, setLoading] = useState(true);
  const [lists, setLists] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [showAddList, setShowAddList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newItem, setNewItem] = useState('');

  async function loadLists() {
    setLoading(true);
    try {
      const res = await apiFetch(`${CC_API}/lists`);
      const data = await res.json();
      setLists(data.lists || []);
    } catch {
      /* empty */
    }
    setLoading(false);
  }

  async function openList(id: string) {
    const res = await apiFetch(`${CC_API}/lists/${id}`);
    const data = await res.json();
    setSelected(data.list);
  }

  useEffect(() => {
    loadLists();
  }, []);

  async function createList() {
    if (!newListName.trim()) return;
    await apiFetch(`${CC_API}/lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newListName.trim() }),
    });
    setNewListName('');
    setShowAddList(false);
    await loadLists();
  }

  async function deleteList(id: string) {
    await apiFetch(`${CC_API}/lists/${id}`, { method: 'DELETE' });
    setSelected(null);
    await loadLists();
  }

  async function addItem() {
    if (!newItem.trim() || !selected) return;
    await apiFetch(`${CC_API}/lists/${selected.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: newItem.trim() }),
    });
    setNewItem('');
    await openList(selected.id);
  }

  async function toggleItem(itemId: string, checked: number) {
    await apiFetch(`${CC_API}/lists/items/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checked: !checked }),
    });
    if (selected) await openList(selected.id);
  }

  async function deleteItem(itemId: string) {
    await apiFetch(`${CC_API}/lists/items/${itemId}`, { method: 'DELETE' });
    if (selected) await openList(selected.id);
  }

  async function clearChecked() {
    if (!selected) return;
    await apiFetch(`${CC_API}/lists/${selected.id}/items`, { method: 'DELETE' });
    await openList(selected.id);
  }

  const card = cn('rounded-2xl border p-3 mb-3', colors.panelBg, colors.panelBorder);
  const input = cn('rounded-lg border px-3 py-2 text-sm bg-transparent', colors.panelBorder, colors.textMain);

  if (loading) return <div className={cn('rounded-2xl border p-3 backdrop-blur-md text-xs py-6 text-center', colors.panelBg, colors.panelBorder, colors.textMuted)}>Loading…</div>;

  if (selected) {
    const items: any[] = selected.items || [];
    const unchecked = items.filter((i) => !i.checked);
    const checked = items.filter((i) => i.checked);
    return (
      <>
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setSelected(null)} className={cn('flex items-center gap-1 text-xs', colors.textMuted)}>
            <ChevronLeft size={14} /> All lists
          </button>
          <div className="flex gap-2">
            <button onClick={clearChecked} className={cn('text-xs', colors.textMuted)}>Clear done</button>
            <button onClick={() => deleteList(selected.id)} className="text-xs" style={{ color: colors.accent, opacity: 0.8 }}>
              Delete list
            </button>
          </div>
        </div>
        <div className={card}>
          <div className={cn('text-base font-semibold mb-3', colors.textMain)}>{selected.name}</div>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              placeholder="Add item…"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addItem()}
              className={cn(input, 'flex-1')}
            />
            <button onClick={addItem} className="rounded-lg px-3 aerie-on-accent" style={{ background: colors.accent }}>
              <Plus size={16} />
            </button>
          </div>
          {items.length === 0 ? (
            <div className={cn('text-xs py-3 text-center', colors.textMuted)}>This list is empty.</div>
          ) : (
            <div className="space-y-0.5">
              {[...unchecked, ...checked].map((item) => (
                <div key={item.id} className="flex items-center gap-2 py-1.5">
                  <button
                    onClick={() => toggleItem(item.id, item.checked)}
                    className="h-5 w-5 shrink-0 rounded border flex items-center justify-center"
                    style={{
                      borderColor: item.checked ? colors.accent : 'rgba(127,127,127,0.5)',
                      background: item.checked ? colors.accent : 'transparent',
                    }}
                  >
                    {item.checked ? <Check size={12} className="aerie-on-accent" /> : null}
                  </button>
                  <span
                    className={cn('flex-1 text-sm', colors.textMain)}
                    style={{ opacity: item.checked ? 0.5 : 1, textDecoration: item.checked ? 'line-through' : 'none' }}
                  >
                    {item.text}
                  </span>
                  <button onClick={() => deleteItem(item.id)} className={cn('p-1', colors.textMuted)}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <div className={cn('rounded-2xl border p-3 backdrop-blur-md', colors.panelBg, colors.panelBorder)}>
      <div className="flex items-center justify-between mb-2">
        <span className={cn('text-[11px] font-bold uppercase tracking-[0.12em]', colors.textMuted)}>Your lists</span>
        <button onClick={() => setShowAddList(!showAddList)} className="rounded-full p-1.5 aerie-on-accent" style={{ background: colors.accent }}>
          <Plus size={14} />
        </button>
      </div>

      {showAddList && (
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            placeholder="List name"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createList()}
            className={cn(input, 'flex-1')}
          />
          <button onClick={createList} className="rounded-lg px-4 text-sm font-semibold aerie-on-accent" style={{ background: colors.accent }}>
            Create
          </button>
        </div>
      )}

      {lists.length === 0 ? (
        <div className={cn('text-xs py-6 text-center', colors.textMuted)}>No lists yet.</div>
      ) : (
        <div className="space-y-2">
          {lists.map((list) => (
            <button
              key={list.id}
              onClick={() => openList(list.id)}
              className={cn('flex w-full items-center justify-between rounded-xl border p-3 text-left', colors.panelBorder)}
            >
              <div>
                <div className={cn('text-sm font-semibold', colors.textMain)}>{list.name}</div>
                <div className={cn('text-[11px]', colors.textMuted)}>
                  {list.unchecked_count} of {list.item_count} items
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
