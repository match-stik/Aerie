# Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
"""Writes packages/phone/src/lib/emoji.ts from Unicode's emoji-test.txt.

Every fully-qualified emoji, minus the skin-tone variants and the bare
components, in the sections a phone keyboard uses. Run it again when Unicode
publishes a new version:

  curl -sL -o /tmp/emoji-test.txt https://unicode.org/Public/emoji/latest/emoji-test.txt
  python3 tools/emoji/build-emoji-list.py /tmp/emoji-test.txt
"""
import json
import re
import sys
from pathlib import Path

SECTIONS = ['Smileys & Emotion', 'People & Body', 'Animals & Nature', 'Food & Drink',
            'Activities', 'Travel & Places', 'Objects', 'Symbols', 'Flags']
SKIN = {chr(c) for c in range(0x1F3FB, 0x1F400)}
HEADER = ('// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? '
          'Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.')


def main(src: str) -> None:
    text = Path(src).read_text(encoding='utf-8')
    version = re.search(r'^# Version: (\S+)', text, re.M).group(1)
    by_section = {s: [] for s in SECTIONS}
    group = None
    for line in text.splitlines():
        if line.startswith('# group:'):
            group = line.split(':', 1)[1].strip()
            continue
        if '; fully-qualified' not in line or group not in by_section:
            continue
        emoji = re.search(r'#\s(\S+)\sE\d+\.\d+\s', line).group(1)
        if any(ch in SKIN for ch in emoji):
            continue
        by_section[group].append(emoji)

    out = [HEADER,
           '// Standard emoji palette used by the chat-input picker and the message',
           '// reaction picker, in the sections a phone keyboard uses.',
           '//',
           f"// GENERATED from Unicode's emoji-test.txt, Emoji {version}, by",
           '// tools/emoji/build-emoji-list.py. Do not edit by hand; run the script.',
           '// Every fully-qualified emoji except skin-tone variants and bare components.',
           '// The trays hide any the phone cannot draw (lib/emoji-support.ts).',
           '',
           'export interface EmojiSection {',
           '  label: string;',
           '  emojis: string[];',
           '}',
           '',
           f"export const EMOJI_DATA_VERSION = '{version}';",
           '',
           'export const EMOJI_SECTIONS: EmojiSection[] = [']
    total = 0
    for label in SECTIONS:
        emojis = by_section[label]
        total += len(emojis)
        out.append('  {')
        out.append(f'    label: {json.dumps(label)},')
        out.append('    emojis: [')
        for i in range(0, len(emojis), 12):
            out.append('      ' + ' '.join(json.dumps(e, ensure_ascii=False) + ',' for e in emojis[i:i + 12]))
        out.append('    ],')
        out.append('  },')
    out.append('];')
    out.append('')
    out.append('// Flat list, for callers that want one bag of emojis.')
    out.append('export const STANDARD_EMOJIS: string[] = EMOJI_SECTIONS.flatMap((s) => s.emojis);')
    out.append('')
    dest = Path(__file__).resolve().parents[2] / 'packages/phone/src/lib/emoji.ts'
    dest.write_text('\n'.join(out), encoding='utf-8')
    print(f'Emoji {version}: {total} emoji in {len(SECTIONS)} sections -> {dest}')
    for label in SECTIONS:
        print(f'  {label}: {len(by_section[label])}')


if __name__ == '__main__':
    main(sys.argv[1])
