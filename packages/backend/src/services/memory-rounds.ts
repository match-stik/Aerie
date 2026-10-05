// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { createHash } from 'crypto';
import { getDb } from './db.js';
import { memoryReceipt } from './memory-ledger.js';
import { refreshSelfKnowledgeIndex } from './self-knowledge-index.js';

let running: Promise<Record<string, unknown>> | null = null;

export async function runMemoryRounds(force = false): Promise<Record<string, unknown>> {
  if (running) return running;
  running = (async () => {
    const db = getDb();
    const day = new Date().toISOString().slice(0, 10);
    if (!force && db.prepare('SELECT 1 FROM memory_round_runs WHERE day=?').get(day)) return { day, skipped: true };
    db.prepare(`INSERT INTO memory_round_runs (day, started_at, status) VALUES (?, ?, 'running')
      ON CONFLICT(day) DO UPDATE SET started_at=excluded.started_at, status='running'`)
      .run(day, new Date().toISOString());
    const summary: Record<string, unknown> = {};
    try {
      const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
      const missing = count(`SELECT count(*) n FROM self_knowledge sk LEFT JOIN self_knowledge_embeddings e
        ON e.self_knowledge_id=sk.id WHERE e.self_knowledge_id IS NULL`);
      const orphaned = count(`SELECT count(*) n FROM self_knowledge_embeddings e LEFT JOIN self_knowledge sk
        ON sk.id=e.self_knowledge_id WHERE sk.id IS NULL`);
      let hashDrift = 0;
      for (const row of db.prepare(`SELECT sk.category,sk.content,e.content_hash FROM self_knowledge sk
        JOIN self_knowledge_embeddings e ON e.self_knowledge_id=sk.id`).all() as Array<{category:string;content:string;content_hash:string}>) {
        const input = `${row.category.replaceAll('_', ' ')}: ${row.content}`;
        if (createHash('sha256').update(input).digest('hex') !== row.content_hash) hashDrift++;
      }
      summary.selfKnowledgeIndex = { missing, orphaned, hashDrift };
      if (missing || orphaned || hashDrift) await refreshSelfKnowledgeIndex();
      summary.staleProposals = count(`SELECT count(*) n FROM self_knowledge WHERE status='proposed'
        AND julianday(created_at) < julianday('now','-30 days')`);
      summary.invalidLifecycle = count(`SELECT count(*) n FROM self_knowledge WHERE heat<0 OR heat>1
        OR confidence<0 OR confidence>1 OR (status='contradicted' AND confidence>=0.2)`);
      summary.brokenJournalSources = count(`SELECT count(*) n FROM self_knowledge sk LEFT JOIN journal_entries j
        ON j.id=sk.source_id WHERE sk.source_type IN ('journal','dream') AND sk.source_id IS NOT NULL AND j.id IS NULL`);
      summary.journalAnomalies = count(`SELECT count(*) n FROM journal_entries WHERE
        (entry_type='dream' AND vividness IS NULL) OR entry_type NOT IN ('journal','dream')`);
      summary.cortexUnindexed = count(`SELECT count(*) n FROM cortex_memory_embeddings WHERE vector IS NULL`);
      db.prepare(`UPDATE memory_round_runs SET finished_at=?,status='complete',summary_json=? WHERE day=?`)
        .run(new Date().toISOString(), JSON.stringify(summary), day);
      memoryReceipt({ actor: 'daemon', action: 'rounds.complete', detail: 'Memory integrity rounds completed.', metadata: summary });
      return { day, ...summary };
    } catch (error) {
      db.prepare(`UPDATE memory_round_runs SET finished_at=?,status='error',summary_json=? WHERE day=?`)
        .run(new Date().toISOString(), JSON.stringify({ error: String(error) }), day);
      memoryReceipt({ actor: 'daemon', action: 'rounds.error', detail: `Memory integrity rounds failed: ${String(error).slice(0, 300)}` });
      throw error;
    }
  })().finally(() => { running = null; });
  return running;
}

export function startMemoryRounds(): void {
  void runMemoryRounds().catch(() => {});
  const timer = setInterval(() => void runMemoryRounds().catch(() => {}), 6 * 60 * 60 * 1000);
  timer.unref?.();
}
