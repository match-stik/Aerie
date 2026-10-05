// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { GeneratedImage } from './types';

const MAX_PERSON_TAG_LENGTH = 40;

// A scratch reference drawer named `<person>-temp` is still that person, so it
// groups with them in the gallery instead of splitting into a second cast.
const TEMP_DRAWER_SUFFIX = /-temp$/;

/** Mirror the Gallery API's stable, URL-safe representation for a person. */
export function personTagSlug(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(',') || Array.from(trimmed).length > MAX_PERSON_TAG_LENGTH * 2) return '';
  const slug = trimmed
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug || slug.length > MAX_PERSON_TAG_LENGTH) return '';
  const merged = slug.replace(TEMP_DRAWER_SUFFIX, '');
  return merged || slug;
}

/** Turn a stored tag such as `ivy-marie` back into a clean UI label. */
export function personTagLabel(value: string): string {
  return personTagSlug(value)
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function canonicalCast(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(
    values
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(personTagSlug)
      .filter(Boolean),
  )).sort();
}

export function galleryItemToImage(item: any): GeneratedImage {
  const referenceDrawers = Array.isArray(item.referenceDrawers)
    ? item.referenceDrawers
    : Array.isArray(item.references)
      ? item.references
      : [];
  return {
    id: String(item.filename ?? item.id ?? ''),
    src: String(item.url ?? item.src ?? ''),
    prompt: typeof item.prompt === 'string' ? item.prompt : '',
    sourcePrompt: typeof item.sourcePrompt === 'string' ? item.sourcePrompt : undefined,
    styleId: typeof item.styleId === 'string' ? item.styleId : undefined,
    model: typeof item.model === 'string' && item.model ? item.model : 'gpt-image-2',
    backend: typeof item.backend === 'string' && item.backend ? item.backend : 'codex',
    width: Number(item.width) || 1024,
    height: Number(item.height) || 1024,
    timestamp: typeof item.createdAt === 'number'
      ? item.createdAt
      : new Date(item.createdAt ?? Date.now()).getTime(),
    folderId: typeof item.folderId === 'string' ? item.folderId : undefined,
    aspectRatio: typeof item.aspectRatio === 'string' ? item.aspectRatio : undefined,
    references: referenceDrawers,
    referenceDrawers,
    // Preserve the difference between an unclassified legacy image (no cast
    // field) and an image explicitly marked as containing no people ([]).
    cast: Array.isArray(item.cast) ? canonicalCast(item.cast) : undefined,
    castSource: ['selected-references', 'manual', 'none', 'unknown'].includes(item.castSource)
      ? item.castSource
      : undefined,
    mediaType: item.mediaType === 'video' ? 'video' : 'image',
  };
}

export function exactCastKey(cast: string[]): string {
  return canonicalCast(cast).join(',');
}

/**
 * The two groupings worth naming — the whole house, and the companions on their
 * own. A house that has its own words for those puts them in config; otherwise
 * they get described plainly.
 */
export interface HouseCastGroups {
  residents: string[];
  companionSlugs: string[];
  labels: { everyone: string; companions: string };
}

export function castCollectionLabel(
  cast: string[],
  labelFor: (slug: string) => string,
  house?: HouseCastGroups,
): string {
  const normalized = canonicalCast(cast);
  const key = normalized.join(',');
  if (house && normalized.length > 1) {
    if (house.residents.length && key === exactCastKey(house.residents)) {
      return house.labels.everyone || 'Everyone';
    }
    if (house.companionSlugs.length && key === exactCastKey(house.companionSlugs)) {
      return house.labels.companions || 'The Companions';
    }
  }
  if (normalized.length === 1) return `Just ${labelFor(normalized[0])}`;
  return normalized
    .map(labelFor)
    .sort((a, b) => a.localeCompare(b))
    .join(' + ');
}

export async function copyStudioText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}
