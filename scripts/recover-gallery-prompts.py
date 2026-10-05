#!/usr/bin/env python3
# Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
"""Rebuild lost gallery metadata for data/generated-images/_index.json.

The gallery index was repeatedly wiped through early July 2026 by a
read-modify-write race in image-gen.ts (fixed alongside this script):
a corrupt/partial read returned {}, and the next single-image write
persisted it, orphaning every earlier image. 108 of 200 images lost
their prompts. The button was never broken — the data was gone.

Recovery sources, best first:
  1. A full-entry snapshot of the index catted during a Jul 5 Codex
     session (rollout files under ~/.codex/sessions keep untruncated
     command output).
  2. [recordGalleryMeta] lines in ~/.pm2/logs/aerie-out.log — filename +
     first 50 chars of prompt. Used as a search key into codex rollouts
     (--- PROMPT --- blocks) to find the full prompt; falls back to the
     truncated prefix if no rollout matches.
  3. Timestamp correlation: gallery filenames embed their creation time;
     codex image-job rollouts near that moment carry the full prompt.

Never overwrites an existing index entry. Backs up the index before
writing. Safe to re-run. Jun 26 - Jul 4 images whose sessions lived on
the GCP box may stay unrecovered until that box is booted.
"""

import glob
import json
import os
import re
import shutil
import time
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GALLERY = os.path.join(ROOT, 'data', 'generated-images')
INDEX = os.path.join(GALLERY, '_index.json')
PM2_LOG = os.path.expanduser('~/.pm2/logs/aerie-out.log')
SESSIONS = os.path.expanduser('~/.codex/sessions')

PROMPT_BLOCK = re.compile(r'--- PROMPT ---\n(.*?)\n--- END PROMPT ---', re.S)


def walk_strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from walk_strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from walk_strings(v)


def filename_ts(name):
    m = re.match(r'img_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})', name)
    if not m:
        return None
    d, hh, mm, ss = m.groups()
    return datetime.fromisoformat(f'{d}T{hh}:{mm}:{ss}+00:00').timestamp()


def load_orphans():
    idx = json.load(open(INDEX)) if os.path.exists(INDEX) else {}
    files = [f for f in os.listdir(GALLERY)
             if f != '_index.json' and not f.startswith('_index.json.')]
    return idx, sorted(f for f in files if f not in idx)


def source_snapshots():
    """Full index snapshots catted inside codex sessions (untruncated)."""
    recovered = {}
    dec = json.JSONDecoder()
    for path in glob.glob(f'{SESSIONS}/*/*/*/rollout-*.jsonl'):
        try:
            fh = open(path, encoding='utf-8', errors='replace')
        except OSError:
            continue
        for line in fh:
            # quotes are backslash-escaped in raw JSONL, so match loosely here
            if 'img_2026-' not in line or 'prompt' not in line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            for text in walk_strings(obj):
                if text.count('"prompt"') < 2 or '"img_2026-' not in text:
                    continue
                for m in re.finditer(r'\{\s*\n\s*"img_2026-', text):
                    try:
                        parsed, _ = dec.raw_decode(text[m.start():])
                    except json.JSONDecodeError:
                        continue
                    for k, v in parsed.items():
                        if isinstance(v, dict) and v.get('prompt'):
                            recovered.setdefault(k, v)
    return recovered


def source_log_prefixes():
    """filename -> 50-char prompt prefix from [recordGalleryMeta] log lines."""
    prefixes = {}
    if not os.path.exists(PM2_LOG):
        return prefixes
    pat = re.compile(r'\[recordGalleryMeta\] (\S+\.(?:png|jpg|jpeg|webp)): prompt=(.*)')
    for line in open(PM2_LOG, encoding='utf-8', errors='replace'):
        m = pat.match(line.strip())
        if m and m.group(2) != 'NONE':
            prefixes[m.group(1)] = m.group(2)
    return prefixes


def source_rollout_prompts():
    """(prompt, session_start_ts, session_end_ts) from codex image jobs."""
    jobs = []
    for path in glob.glob(f'{SESSIONS}/*/*/*/rollout-*.jsonl'):
        m = re.search(r'rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})', path)
        if not m:
            continue
        d, hh, mm, ss = m.group(1)[:10], m.group(1)[11:13], m.group(1)[14:16], m.group(1)[17:19]
        start = datetime.fromisoformat(f'{d}T{hh}:{mm}:{ss}+00:00').timestamp()
        end = os.stat(path).st_mtime
        try:
            text = open(path, encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        if '--- PROMPT ---' not in text:
            continue
        # Prompts inside the rollout are JSON-escaped; unescape the common cases
        unescaped = text.replace('\\n', '\n').replace('\\"', '"')
        for raw in PROMPT_BLOCK.finditer(unescaped):
            prompt = raw.group(1).strip()
            if prompt:
                jobs.append((prompt, start, end))
                break
    return jobs


def main():
    idx, orphans = load_orphans()
    print(f'index entries: {len(idx)}, orphaned images: {len(orphans)}')
    if not orphans:
        return

    snapshots = source_snapshots()
    prefixes = source_log_prefixes()
    rollouts = source_rollout_prompts()
    print(f'sources: {len(snapshots)} snapshot entries, '
          f'{len(prefixes)} log prefixes, {len(rollouts)} rollout prompts')

    stats = {'snapshot': 0, 'log+rollout': 0, 'log-prefix': 0, 'timestamp': 0}
    for name in orphans:
        entry = None
        if name in snapshots:
            entry = dict(snapshots[name])
            stats['snapshot'] += 1
        elif name in prefixes:
            prefix = prefixes[name]
            full = [p for p, _, _ in rollouts if p.startswith(prefix.rstrip())]
            if full:
                entry = {'prompt': max(full, key=len), 'backend': 'codex'}
                stats['log+rollout'] += 1
            else:
                entry = {'prompt': prefix + '…', 'backend': 'codex'}
                stats['log-prefix'] += 1
        else:
            ts = filename_ts(name)
            if ts:
                near = [(abs(ts - end), p) for p, start, end in rollouts
                        if start - 30 <= ts <= end + 300]
                if near:
                    entry = {'prompt': min(near)[1], 'backend': 'codex'}
                    stats['timestamp'] += 1
        if entry:
            entry.setdefault('createdAt', datetime.fromtimestamp(
                os.stat(os.path.join(GALLERY, name)).st_mtime,
                tz=timezone.utc).isoformat().replace('+00:00', 'Z'))
            entry['recovered'] = True
            idx[name] = entry

    recovered = sum(stats.values())
    print(f'recovered {recovered}/{len(orphans)}: {stats}')
    if not recovered:
        return
    backup = f'{INDEX}.pre-recovery-{int(time.time())}'
    shutil.copyfile(INDEX, backup)
    tmp = INDEX + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(idx, fh, indent=2)
    os.replace(tmp, INDEX)
    print(f'index written ({len(idx)} entries); backup at {backup}')


if __name__ == '__main__':
    main()
