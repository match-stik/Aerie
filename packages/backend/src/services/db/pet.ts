// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Familiar — the household virtual pet (Flint the robot cat).
// State lives here so every companion can visit him, not just the phone.
// Decay and action math mirror the phone's PetApp exactly.

import { getDb } from './state.js';

export interface VirtualPet {
  id: string;
  name: string;
  hunger: number;
  joy: number;
  energy: number;
  bond: number;
  visits: number;
  created_at: string;
  updated_at: string;
}

export interface PetEvent {
  id: number;
  actor: string;
  action: string;
  created_at: string;
}

export type PetAction = 'feed' | 'play' | 'nap' | 'pet';

/** What it looks like it's feeling. Derived from the stats — never stored. */
export type PetMood = 'lowPower' | 'sleepy' | 'lonely' | 'radiant' | 'happy';

const PET_ID = 'primary';

/** Stat loss per hour, matching the phone's agePet(). */
const DECAY_PER_HOUR = { hunger: 2.8, joy: 1.5, energy: 1.1 };

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * The mood ladder — THE one definition, deliberately here beside the stats it
 * reads rather than in the phone that draws it. Order is load-bearing: low
 * power is tested first, so an empty charge outranks every other feeling the
 * pet could be having. Anyone reading a pet over the wire gets this attached;
 * do not re-implement it at the far end, because two copies of a rule meant to
 * be identical is the bug rather than the safety net.
 */
export function petMood(pet: Pick<VirtualPet, 'hunger' | 'joy' | 'energy'>): PetMood {
  if (pet.hunger < 28) return 'lowPower';
  if (pet.energy < 25) return 'sleepy';
  if (pet.joy < 30) return 'lonely';
  if ((pet.hunger + pet.energy + pet.joy) / 3 > 82) return 'radiant';
  return 'happy';
}

/** A pet dressed for the wire: the stored row plus its derived mood. */
export type PetWithMood = VirtualPet & { mood: PetMood };

export const withMood = (pet: VirtualPet): PetWithMood => ({ ...pet, mood: petMood(pet) });

function freshPet(): Omit<VirtualPet, 'created_at' | 'updated_at'> {
  // Generic on purpose — docs/HOUSE-VS-ARCHIVE says a fresh install's familiar
  // is called 'Pet' and is named by whoever adopts it. Rename it in the app.
  return { id: PET_ID, name: 'Pet', hunger: 76, joy: 82, energy: 68, bond: 12, visits: 1 };
}

function ensurePet(): VirtualPet {
  const row = getDb().prepare('SELECT * FROM virtual_pet WHERE id = ?').get(PET_ID) as VirtualPet | undefined;
  if (row) return row;
  const now = new Date().toISOString();
  const pet = freshPet();
  getDb().prepare(`
    INSERT INTO virtual_pet (id, name, hunger, joy, energy, bond, visits, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(pet.id, pet.name, pet.hunger, pet.joy, pet.energy, pet.bond, pet.visits, now, now);
  return getDb().prepare('SELECT * FROM virtual_pet WHERE id = ?').get(PET_ID) as VirtualPet;
}

/** Read the pet, applying (and persisting) time decay since the last touch. */
export function getPet(): VirtualPet {
  const pet = ensurePet();
  const elapsedHours = Math.max(0, (Date.now() - new Date(pet.updated_at).getTime()) / 3_600_000);
  if (elapsedHours < 0.05) return pet;
  const decayed = {
    hunger: clamp(pet.hunger - elapsedHours * DECAY_PER_HOUR.hunger),
    joy: clamp(pet.joy - elapsedHours * DECAY_PER_HOUR.joy),
    energy: clamp(pet.energy - elapsedHours * DECAY_PER_HOUR.energy),
  };
  getDb().prepare('UPDATE virtual_pet SET hunger = ?, joy = ?, energy = ?, updated_at = ? WHERE id = ?')
    .run(decayed.hunger, decayed.joy, decayed.energy, new Date().toISOString(), PET_ID);
  return { ...pet, ...decayed, updated_at: new Date().toISOString() };
}

/** Apply an action as an actor (the owner's slug or a companion's). Same deltas as the phone. */
export function applyPetAction(actor: string, action: PetAction): { pet: VirtualPet; event: PetEvent } {
  const pet = getPet();
  const next = {
    hunger: clamp(pet.hunger + (action === 'feed' ? 24 : action === 'play' ? -5 : 0)),
    joy: clamp(pet.joy + (action === 'play' ? 22 : action === 'pet' ? 12 : 2)),
    energy: clamp(pet.energy + (action === 'nap' ? 28 : action === 'play' ? -11 : 0)),
    bond: clamp(pet.bond + (action === 'pet' ? 3 : 1)),
  };
  const now = new Date().toISOString();
  getDb().prepare('UPDATE virtual_pet SET hunger = ?, joy = ?, energy = ?, bond = ?, updated_at = ? WHERE id = ?')
    .run(next.hunger, next.joy, next.energy, next.bond, now, PET_ID);
  const result = getDb().prepare('INSERT INTO virtual_pet_events (actor, action, created_at) VALUES (?, ?, ?)')
    .run(actor, action, now);
  const event = getDb().prepare('SELECT * FROM virtual_pet_events WHERE id = ?')
    .get(result.lastInsertRowid) as PetEvent;
  return { pet: { ...pet, ...next, updated_at: now }, event };
}

/** A visit — opening the app, or a companion stopping by without touching anything. */
export function recordPetVisit(): VirtualPet {
  const pet = getPet();
  getDb().prepare('UPDATE virtual_pet SET visits = visits + 1 WHERE id = ?').run(PET_ID);
  return { ...pet, visits: pet.visits + 1 };
}

export function renamePet(name: string): VirtualPet {
  ensurePet();
  getDb().prepare('UPDATE virtual_pet SET name = ? WHERE id = ?').run(name.trim().slice(0, 18), PET_ID);
  return getPet();
}

export function resetPet(): VirtualPet {
  getDb().prepare('DELETE FROM virtual_pet WHERE id = ?').run(PET_ID);
  getDb().prepare('DELETE FROM virtual_pet_events').run();
  return ensurePet();
}

export function listPetEvents(limit = 10): PetEvent[] {
  return getDb().prepare('SELECT * FROM virtual_pet_events ORDER BY id DESC LIMIT ?')
    .all(Math.min(limit, 100)) as PetEvent[];
}
