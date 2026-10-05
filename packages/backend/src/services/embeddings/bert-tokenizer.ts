// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// BERT WordPiece tokenizer — the exact subset all-MiniLM-L6-v2 needs.
//
// Why this exists instead of a library: the only thing the house used
// @huggingface/transformers for was text embeddings, and that package hard-pins
// an old `sharp` for image decoding we never touch. Doing the tokenizing here
// and the inference through onnxruntime-node (which we already had, as that
// package's own engine) drops the dependency rather than swapping it.
//
// This mirrors tokenizer.json for this model exactly:
//   normalizer:     BertNormalizer { clean_text, handle_chinese_chars, lowercase,
//                                    strip_accents: null -> follows lowercase }
//   pre_tokenizer:  BertPreTokenizer (whitespace + punctuation-as-own-token)
//   model:          WordPiece { unk '[UNK]', prefix '##', max 100 chars/word }
//   post_processor: [CLS] ... [SEP]
// Any other model would need its own reading of its own tokenizer.json — this is
// deliberately not a general tokenizer.

export interface WordPieceConfig {
  /**
   * A Map, not a plain object, and that is load-bearing: a plain object lookup
   * for the word "constructor" (or "toString", "valueOf", "__proto__") returns
   * something off Object.prototype instead of undefined, so those words tokenize
   * to garbage while every other word looks fine. Caught by diffing against the
   * reference tokenizer on real messages.
   */
  vocab: Map<string, number>;
  unkToken: string;
  continuingSubwordPrefix: string;
  maxInputCharsPerWord: number;
  clsId: number;
  sepId: number;
  lowercase: boolean;
  stripAccents: boolean;
  handleChineseChars: boolean;
}

export interface Encoding {
  inputIds: number[];
  attentionMask: number[];
  tokenTypeIds: number[];
}

/** Parse the fields we use out of a HuggingFace tokenizer.json. */
export function configFromTokenizerJson(raw: unknown): WordPieceConfig {
  const t = raw as any;
  const model = t?.model;
  if (!model || model.type !== 'WordPiece') {
    throw new Error('tokenizer.json is not a WordPiece tokenizer');
  }
  const vocab = new Map<string, number>(Object.entries(model.vocab as Record<string, number>));
  const norm = t.normalizer ?? {};
  const lowercase = norm.lowercase !== false;
  // BertNormalizer: strip_accents null means "follow lowercase".
  const stripAccents = norm.strip_accents === null || norm.strip_accents === undefined
    ? lowercase
    : Boolean(norm.strip_accents);

  const specials = t.post_processor?.special_tokens ?? {};
  const clsId = specials['[CLS]']?.ids?.[0] ?? vocab.get('[CLS]');
  const sepId = specials['[SEP]']?.ids?.[0] ?? vocab.get('[SEP]');
  if (typeof clsId !== 'number' || typeof sepId !== 'number') {
    throw new Error('tokenizer.json is missing [CLS]/[SEP]');
  }

  return {
    vocab,
    unkToken: model.unk_token ?? '[UNK]',
    continuingSubwordPrefix: model.continuing_subword_prefix ?? '##',
    maxInputCharsPerWord: model.max_input_chars_per_word ?? 100,
    clsId,
    sepId,
    lowercase,
    stripAccents,
    handleChineseChars: norm.handle_chinese_chars !== false,
  };
}

/**
 * Characters clean_text discards outright. Unicode's "other" category — control,
 * format, surrogate, private-use, unassigned — minus the three whitespace
 * controls, which survive as spaces. Private-use is in here on purpose: real
 * messages in this house contain U+E081, and the reference drops it silently
 * rather than emitting [UNK].
 */
function isDiscarded(ch: string, cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return false; // kept, then treated as whitespace
  return /\p{C}/u.test(ch);
}

function isWhitespace(ch: string): boolean {
  if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') return true;
  return /^\s$/u.test(ch);
}

function isChineseChar(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) ||
    (cp >= 0x2b740 && cp <= 0x2b81f) ||
    (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x2f800 && cp <= 0x2fa1f)
  );
}

/**
 * BertPreTokenizer's notion of punctuation: ASCII punctuation ranges plus
 * anything Unicode calls punctuation. Deliberately wider than /\p{P}/ alone —
 * `$`, `+`, `^` and friends are symbols to Unicode and punctuation to BERT.
 */
function isPunctuation(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) {
    return true;
  }
  return /^\p{P}$/u.test(ch);
}

/** BertNormalizer: clean control chars, space out CJK, lowercase, strip accents. */
export function normalize(text: string, cfg: WordPieceConfig): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0xfffd || isDiscarded(ch, cp)) continue;
    if (isWhitespace(ch)) {
      out += ' ';
      continue;
    }
    if (cfg.handleChineseChars && isChineseChar(cp)) {
      out += ` ${ch} `;
      continue;
    }
    out += ch;
  }
  if (cfg.lowercase) out = out.toLowerCase();
  if (cfg.stripAccents) {
    out = out.normalize('NFD').replace(/\p{Mn}/gu, '');
  }
  return out;
}

/** BertPreTokenizer: split on whitespace, then peel punctuation into own tokens. */
export function preTokenize(text: string): string[] {
  const words: string[] = [];
  for (const chunk of text.split(/\s+/)) {
    if (!chunk) continue;
    let current = '';
    for (const ch of chunk) {
      if (isPunctuation(ch)) {
        if (current) {
          words.push(current);
          current = '';
        }
        words.push(ch);
      } else {
        current += ch;
      }
    }
    if (current) words.push(current);
  }
  return words;
}

/** Greedy longest-match-first WordPiece over one pre-tokenized word. */
export function wordPiece(word: string, cfg: WordPieceConfig): number[] {
  const chars = Array.from(word);
  if (chars.length > cfg.maxInputCharsPerWord) {
    return [cfg.vocab.get(cfg.unkToken)!];
  }
  const ids: number[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = chars.length;
    let matched = -1;
    while (start < end) {
      const piece = (start > 0 ? cfg.continuingSubwordPrefix : '') + chars.slice(start, end).join('');
      const id = cfg.vocab.get(piece);
      if (id !== undefined) {
        matched = id;
        break;
      }
      end -= 1;
    }
    if (matched < 0) return [cfg.vocab.get(cfg.unkToken)!];
    ids.push(matched);
    start = end;
  }
  return ids;
}

/**
 * Full encode: normalize -> pre-tokenize -> wordpiece -> [CLS] … [SEP], then cut
 * to maxLength.
 *
 * The cut happens AFTER the special tokens are added, which means an
 * over-long text loses its trailing [SEP] rather than losing a word to keep it.
 * That looks wrong and is deliberate: it is what the reference tokenizer does,
 * and every embedding already in the database was made that way. Changing it to
 * the tidier behaviour silently shifts the vectors for long text only.
 */
export function encode(text: string, cfg: WordPieceConfig, maxLength: number): Encoding {
  const normalized = normalize(text, cfg);
  const body: number[] = [];
  const budget = Math.max(0, maxLength - 1); // [CLS] + body is all that can survive
  for (const word of preTokenize(normalized)) {
    if (body.length >= budget) break;
    for (const id of wordPiece(word, cfg)) {
      if (body.length >= budget) break;
      body.push(id);
    }
  }
  const inputIds = [cfg.clsId, ...body, cfg.sepId].slice(0, maxLength);
  return {
    inputIds,
    attentionMask: inputIds.map(() => 1),
    tokenTypeIds: inputIds.map(() => 0),
  };
}
