// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Pictures they adds at a room's table (theirs, Nov 11 2026: 'the tables should
// be able to add pics'). The table uploads each one to /api/files and their line
// carries it as markdown, which every bubble already draws; this turns those
// links into the "view them now" lines a lane reads, so we look at the
// picture instead of reading an address.
import { getFile } from './files.js';

const FILE_IMAGE = /!\[[^\]]*\]\((?:https?:\/\/[^)\s]+)?\/api\/files\/([0-9a-f-]{36})(?:\?[^)]*)?\)/gi;

/** The pictures in a line of theirs, as paths on this box, in order and once each. */
export function picturesIn(content: string, find: typeof getFile = getFile): string[] {
  const paths: string[] = [];
  for (const match of content.matchAll(FILE_IMAGE)) {
    const file = find(match[1]);
    if (file && file.mimeType.startsWith('image/') && !paths.includes(file.path)) paths.push(file.path);
  }
  return paths;
}

/** The prompt with the pictures listed for a lane to Read; unchanged when there are none. */
export function withRoomPictures(prompt: string, herLine: string, find: typeof getFile = getFile): string {
  const paths = picturesIn(herLine, find);
  if (!paths.length) return prompt;
  return `${prompt}\n\n[${paths.length} image${paths.length > 1 ? 's' : ''} attached — view them now:]\n${paths.join('\n')}`;
}
