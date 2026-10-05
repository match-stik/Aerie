// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Prepare companion prose for ElevenLabs v3 without flattening the written
// message itself. Markdown is stripped and whole-line italics are given a
// voice-shaped cue v3 can perform. Those that read as a companion talking are
// spoken in full as well; those that read as stage direction stay a cue, so the
// voice performs the action rather than announcing it. See isStageDirection()
// for how the two are told apart and TtsTextOptions for why the default is on.

type CueRule = readonly [pattern: RegExp, cue: string];

const VOCAL_CUES: readonly CueRule[] = [
  [/\bh{4,}\b/i, 'wheezing'],
  [/\b(?:laughs?|laughing)\b/i, 'laughs'],
  [/\b(?:chuckles?|chuckling)\b/i, 'chuckles'],
  [/\b(?:giggles?|giggling)\b/i, 'giggles'],
  [/\b(?:snickers?|snickering)\b/i, 'snickers'],
  [/\b(?:cackles?|cackling)\b/i, 'laughs harder'],
  [/\b(?:wheezes?|wheezing)\b/i, 'wheezing'],
  [/\b(?:snorts?|snorting)\b/i, 'snorts'],
  [/\b(?:sighs?|sighing)\b/i, 'sighs'],
  [/\b(?:exhales?|exhaling)\b/i, 'exhales'],
  [/\b(?:inhales?|inhaling)\b/i, 'inhales'],
  [/\b(?:gasps?|gasping)\b/i, 'gasps'],
  [/\b(?:groans?|groaning)\b/i, 'groans'],
  [/\b(?:moans?|moaning)\b/i, 'moans'],
  [/\b(?:purrs?|purring)\b/i, 'purrs'],
  [/\b(?:hums?|humming)\b/i, 'hums'],
  [/\b(?:whispers?|whispering)\b/i, 'whispers'],
  [/\bclears?(?: his| her| their)? throat\b/i, 'clears throat'],
];

const DELIVERY_CUES: readonly CueRule[] = [
  [/\bdeadpan\b|\bdryly\b|(?:^|[\s,])dry(?:$|[\s,])/i, 'deadpan'],
  [/\blow\b/i, 'low and intimate'],
  [/\bquiet(?:ly)?\b|\bsoft(?:ly)?\b/i, 'softly'],
  [/\bwarm(?:ly)?\b/i, 'warmly'],
  [/\btender(?:ly)?\b/i, 'tenderly'],
  [/\bamused\b/i, 'amused'],
  [/\bmischievous(?:ly)?\b/i, 'mischievously'],
  [/\bpossessive(?:ly)?\b/i, 'possessive'],
  [/\bdevoted(?:ly)?\b/i, 'devoted'],
  [/\bsavor(?:s|ing)?\b/i, 'savoring'],
  [/\bbreathless(?:ly)?\b/i, 'breathless'],
  [/\bexcited(?:ly)?\b/i, 'excited'],
  [/\bstunned\b/i, 'stunned'],
  [/\bpleased\b/i, 'pleased'],
  [/\bfond(?:ly)?\b/i, 'fondly'],
  [/\brough(?:ly)?\b/i, 'roughly'],
];

function firstCue(action: string, rules: readonly CueRule[]): string | null {
  return rules.find(([pattern]) => pattern.test(action))?.[1] ?? null;
}

function actionToAudioTags(action: string): string {
  const trimmed = action.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';

  // Preserve signature non-verbal sounds as performance rather than asking
  // the synthesizer to literally pronounce a row of letters.
  if (/^m{3,}$/i.test(trimmed)) return '[hums]';

  const vocal = firstCue(trimmed, VOCAL_CUES);
  const delivery = firstCue(trimmed, DELIVERY_CUES);
  return [vocal, delivery]
    .filter((cue): cue is string => !!cue)
    .map(cue => `[${cue}]`)
    .join(' ');
}

// --- Telling a stage direction from an aside ---------------------------------
//
// The house uses one mark for two jobs. On earlier substrates only actions were
// italicised, so "whole-line italic" and "stage direction" meant the same thing
// and dropping the words cost nothing. This model writes its asides that way
// too, and the rule quietly started deleting speech. What follows separates
// them -- not by general English, but by the two dialects this house actually
// writes in:
//
//   direction  third person or no subject at all, present tense, physical
//              (settles / doesn't move an inch / hand still flat on your shoulder)
//   aside      first person, past tense, a question, or spoken straight at the owner
//              (I ran it both ways / went and checked / one thing, darling)
//
// It is deliberately lopsided. Unsure means SPOKEN: reading an action aloud
// costs a few characters, silencing an aside costs an authored sentence, and
// that second one is the whole reason this exists.

import { getConfig } from './db/config.js';
import { listCompanions } from './db/companions.js';
import { getAerieConfig } from '../config.js';

const FIRST_PERSON = /(^|[^a-z])(I|I'm|I've|I'll|I'd)([^a-z']|$)|(^|\W)(my|me|mine|myself|we|our|us|ours)(\W|$)/i;
const THIRD_PERSON_SELF = /(^|\W)(his|him|he|he's|himself|brother|brothers)(\W|$)/i;
// ONE HOUSE'S NAMES WERE COMPILED INTO A CLASSIFIER THAT SHIPS TO EVERYBODY.
//
// Reported by Rose and Sol, Sep 17 2026. A line that calls somebody by name is
// somebody TALKING, not a stage direction — so this list decides what gets read
// aloud. It held the original house's own names and endearments for its
// person, in a file every other house installs. Their owner's name is in none
// of it, so a line addressed to them reads as scenery and is silently skipped.
//
// Split in two. The endearments below are common enough to be anybody's. The
// house-specific ones come from `voice.direct_address` (a comma list) and fall
// back to the house's own user_name, so a fresh install recognises its own
// person on day one and nobody inherits ours.
// The generic terms the old hardcoded list held, plus `love` — a deliberate
// addition, knowing it slightly widens this house's own behaviour: a line
// calling the person love now reads as speech rather than scenery.
// A house's own pet names for its person are not guessed at here: put them in
// voice.direct_address, comma-separated, and they are read aloud as speech too.
const UNIVERSAL_ADDRESS = ['darling', 'sweetheart', 'love'];

/** Exported so the fallback chain can be tested without a database. */
export function buildDirectAddressPattern(houseTerms: string[], userName: string): RegExp {
  const terms = [...UNIVERSAL_ADDRESS, ...(houseTerms.map((t) => t.trim()).filter(Boolean).length
    ? houseTerms.map((t) => t.trim()).filter(Boolean)
    : [userName.trim()].filter(Boolean))]
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean);
  return new RegExp(`(^|\\W)(${terms.join('|')})(\\W|$)`, 'i');
}

function directAddressPattern(): RegExp {
  let configured = '';
  let userName = '';
  try { configured = (getConfig('voice.direct_address') as string) || ''; } catch { /* no db yet */ }
  try { userName = getAerieConfig().identity.user_name || ''; } catch { /* no config yet */ }
  return buildDirectAddressPattern(configured.split(',').map((t) => t.trim()).filter(Boolean), userName);
}

// A line whose SUBJECT is the owner is one of them talking to the owner, however much
// third person follows it (you followed the sign he nailed to the door).
// Only the subject: possessive "your" is deliberately excluded, because plenty
// of directions put a hand on your shoulder.
const SECOND_PERSON_SUBJECT = /^(you|you're|you'd|you've|you'll)(\W|$)/i;

// Third-person singular present verbs the house opens stage directions with.
const ACTION_VERBS = new Set(`settles sets catches takes feels looks comes sits turns goes taps kisses
 leans shifts pulls pushes drags slides holds grips presses lifts drops moves reaches
 tips tilts closes opens breathes exhales inhales laughs grins smiles smirks nods shakes
 watches waits stops starts keeps stays lets makes puts gets hears sees finds knows
 says adds answers replies murmurs mutters whispers growls hums purrs sighs snorts
 wheezes cackles giggles chuckles snickers gasps groans moans blinks swallows nudges
 traces strokes rubs squeezes tightens loosens laces threads hooks curls uncurls
 stands rises kneels bends straightens crosses uncrosses folds unfolds raises lowers
 wipes brushes tucks smooths pats cups cradles carries rocks bites licks sucks
 fucks thrusts rolls flips lands accepts refuses declines waves points gestures
 glances stares peers squints frowns scowls beams softens hardens flexes twitches
 arrives leaves returns enters exits follows leads guides steers`.split(/\s+/).filter(Boolean));

// Present-tense negation is a direction; past tense is a companion talking.
const NEGATED_VERB = /^(doesn't|does|hasn't|has|isn't|is|won't|will|never)\b/i;

// A line opening on a body part or a prop is scene rather than speech.
const BODY_OR_PROP = new Set(`hand hands thumb thumbs finger fingers palm palms fist fists
 mouth lips teeth tongue jaw chin cheek forehead brow nose eyes eye lashes
 arm arms shoulder shoulders elbow wrist neck throat chest ribs back spine
 hip hips waist stomach belly thigh thighs knee knees leg legs foot feet ankle
 hair head face voice breath skin body weight heat mug spoon phone blanket sheet
 pillow couch cushion floor door light water forearm knuckles`.split(/\s+/).filter(Boolean));

const LEADING_CONNECTIVE = /^(and|but|so|then|or|yet|still|now|also|plus)\b[\s,—-]*/i;
const LEADING_BEAT = /^(a beat|one beat|two beats|a pause|beat)\b[\s,—-]*/i;

// Lines that are nothing but how to say the next thing. "to <companion>" joins
// these per house, from its own companions table (deliveryOnlyPattern below),
// so a line naming somebody who lives somewhere else is not mistaken for one.
const DELIVERY_ONLY_TERMS = 'low|quiet(ly)?|soft(ly)?|warm(ly)?|tender(ly)?|dry(ly)?|deadpan|flat(ly)?|clipped|wrecked|level|even(ly)?|amused|fond(ly)?|rough(ly)?|breathless(ly)?|pleased|delighted|stunned|honest(ly)?|plain(ly)?|careful(ly)?|gentle|gently|serious(ly)?|patient(ly)?|steady|calm|barely audible|very quiet(ly)?|almost|to her|to him|to you|over the mug|from the water|from the seabed|from the floor|from the doorway|beat';

function deliveryOnlyPattern(): RegExp {
  let names: string[] = [];
  try {
    names = listCompanions().flatMap((companion) => [companion.display_name, companion.slug]);
  } catch { /* no db yet */ }
  const toNames = [...new Set(names.map((name) => String(name || '').trim()).filter(Boolean))]
    .map((name) => `to ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const terms = [DELIVERY_ONLY_TERMS, ...toNames].join('|');
  return new RegExp(`^(${terms})(?:[\\s,—-]+(?:and|then))*[\\s,—-]*$`, 'i');
}

const PREPOSITION_LED = /^(at|against|into|onto|under|over|behind|beside|between|through|around|from|off|across)\b/i;
const DESCRIPTIVE_FRAGMENT = /^(half|the ghost|a ghost|a flicker|a beat|the corner)\b/i;

// The house's commonest direction: a delivery note, a comma, then where the
// mouth is (low, across the table / clipped, wrecked). Runs after the vetoes, so
// a line that also talks to the owner is already spoken by the time it gets here.
const DELIVERY_LED = /^(low|quiet(ly)?|soft(ly)?|warm(ly)?|dry(ly)?|deadpan|flat(ly)?|clipped|level|even(ly)?|amused|fond(ly)?|rough(ly)?|breathless(ly)?|pleased|stunned|gentle|gently|steady|calm|barely audible|very quiet(ly)?)\s*,/i;

function stripLead(text: string): string {
  let previous = '';
  let current = text;
  while (previous !== current) {
    previous = current;
    current = current.replace(LEADING_BEAT, '').replace(LEADING_CONNECTIVE, '').trim();
  }
  return current;
}

/** True when a whole-line italic reads as a stage direction rather than speech. */
export function isStageDirection(raw: string): boolean {
  const body = stripLead(raw.replace(/\s+/g, ' ').trim());
  if (!body) return true;

  // Veto first: anything that reads as one of them talking keeps its words.
  if (body.includes('?')) return false;
  if (FIRST_PERSON.test(body)) return false;
  if (directAddressPattern().test(body)) return false;
  if (SECOND_PERSON_SUBJECT.test(body)) return false;

  if (deliveryOnlyPattern().test(body)) return true;
  if (DELIVERY_LED.test(body)) return true;
  if (THIRD_PERSON_SELF.test(body)) return true;

  const words = body.toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/).filter(Boolean);
  if (ACTION_VERBS.has(words[0] ?? '')) return true;
  if (NEGATED_VERB.test(body)) return true;
  if (BODY_OR_PROP.has(words[0] ?? '')) return true;
  if (DESCRIPTIVE_FRAGMENT.test(body)) return true;
  if (PREPOSITION_LED.test(body) && words.length <= 9) return true;

  return false;
}

export interface TtsTextOptions {
  /**
   * Read stage directions out as words as well as performing them.
   *
   * OFF (the default, and what the house wants day to day): isStageDirection()
   * decides per line. An aside is spoken in full; a direction becomes its
   * delivery cue only, so the voice DOES the action instead of announcing it.
   *
   * ON: every whole-line italic is spoken, directions included -- which is
   * exactly what the switch has always been labelled.
   *
   * There is deliberately no position that drops the words of an aside. That
   * WAS the old off, from back when only actions were written in italics; once
   * asides were too it silently deleted authored text, and no one ever wanted
   * the cheaper half badly enough to pay a sentence for it.
   */
  readActionsAloud?: boolean;
}

export function prepareTextForTTS(text: string, options: TtsTextOptions = {}): string {
  if (!text) return '';
  const { readActionsAloud = false } = options;

  // An italic line becomes its cue, its words, both, or nothing at all.
  const renderAction = (action: string): string => {
    const tags = actionToAudioTags(action);
    if (!readActionsAloud && isStageDirection(action)) return tags ? `${tags} ` : '';
    const spoken = action.replace(/\s+/g, ' ').trim();
    if (!spoken) return '';
    return `${tags ? `${tags} ` : ''}${spoken}. `;
  };

  // Inline code reaches the voice as characters rather than as a word, so a
  // path handed over whole comes back as something nobody wrote: packages/
  // frontend was read aloud as one invented name. Separators get their spoken
  // form — the way a person says a path out loud — while code carrying none of
  // them (npm test) is left exactly as written.
  const speakInlineCode = (code: string): string => {
    if (!/[/_]/.test(code)) return code;
    return code
      .replace(/\//g, ' slash ')
      .replace(/_/g, ' underscore ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };

  // Keep inline-code contents opaque while the remaining Markdown is
  // flattened. Otherwise characters that are literal inside code (notably
  // the underscores in `text_to_speech`) can be mistaken for emphasis.
  const inlineCode: string[] = [];
  const protectedText = text
    .replace(/```[\s\S]*?```/g, '')             // fenced code
    .replace(/`([^`\n]*)`/g, (_match, content: string) => {
      const index = inlineCode.push(content) - 1;
      return `\uE000${index}\uE001`;
    });

  const prepared = protectedText
    .replace(/^---+$/gm, '')                    // horizontal dividers
    // WHISPER MARKERS, ALL OF THEM. A nested whisper (-# -# ...) had one
    // marker stripped and the other SPOKEN aloud, because a single replace
    // does not rescan what it just wrote. The phone renderer has the identical
    // fault and prints the survivor, so the same one-marker assumption was
    // wrong on both surfaces — the display one shows up by eye, and this one
    // only by listening.
    .replace(/^(?:-#[ \t]+)+/gm, '')           // whisper markers, keep words
    .replace(/\*\*([^*]+)\*\*/g, '$1')          // bold, keep words
    // House formatting puts an action at the start of its own line — and, just
    // as often, an aside in the companion's own voice. Convert only those
    // spans; ordinary inline emphasis (That is *ours*) is always dialogue and
    // is merely unwrapped below.
    .replace(/^[ \t]*\*([^*\n]+)\*[ \t]*/gm, (_m, action: string) => renderAction(action))
    .replace(/^[ \t]*_([^_\n]+)_[ \t]*/gm, (_m, action: string) => renderAction(action))
    .replace(/\*([^*\n]+)\*/g, '$1')             // inline emphasis
    .replace(/_([^_\n]+)_/g, '$1')               // inline emphasis
    // Explicit [audio tags] pass through untouched; the v3 and v4 models both read them.
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return prepared.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => (
    speakInlineCode(inlineCode[Number(index)] ?? '')
  ));
}
