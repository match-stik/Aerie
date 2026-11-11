// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Discord emotes written into a message, drawn as pictures at home (Oct 24
// 2026: 'we gotta fix the header and emoji IDs showing'). Our own Discord
// replies hold <:name:id> tokens, sometimes on a '# ' line so Discord draws
// them bigger, and the bubble only ever drew the tokens on guests' messages,
// so ours showed the raw ID under a giant heading. Every message gets the
// same treatment now: a heading line holding nothing but emotes loses its
// hashes and its emotes come out big, and any other emote becomes an inline
// picture. The bubble's img renderer reads the alt: 'demoji:<name>' for an
// inline emote, 'demoji-big:<name>' for one off a heading line.

const EMOTE = /<(a?):(\w+):(\d+)>/g;
const HEADING_EMOTES = /^#{1,3} +((?:<a?:\w+:\d+>\s*)+)$/;

function emoteUrl(animated: boolean, id: string): string {
  return `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=48`;
}

export function discordEmotesToMarkdown(text: string): string {
  if (!text.includes('<')) return text;
  return text
    .split('\n')
    .map((line) => {
      const big = HEADING_EMOTES.test(line.trimEnd());
      const body = big ? line.trimEnd().replace(/^#{1,3} +/, '') : line;
      return body.replace(EMOTE, (_m, anim: string, name: string, id: string) =>
        `![${big ? 'demoji-big' : 'demoji'}:${name}](${emoteUrl(anim === 'a', id)})`);
    })
    .join('\n');
}
