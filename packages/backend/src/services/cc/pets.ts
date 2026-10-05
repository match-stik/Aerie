// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Command Center — Pets

import { getDb } from '../db.js';
import { today, uuid, resolvePetId, calculateNextDue } from './helpers.js';

export function addPet(params: {
  name: string;
  species?: string;
  breed?: string;
  birthday?: string;
  weight?: string;
  notes?: string;
}): any {
  const db = getDb();
  const id = uuid();
  db.prepare('INSERT INTO pets (id, name, species, breed, birthday, weight, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, params.name, params.species || null, params.breed || null, params.birthday || null, params.weight || null, params.notes || null);
  return db.prepare('SELECT * FROM pets WHERE id = ?').get(id);
}

export function listPets(): any[] {
  return getDb().prepare('SELECT * FROM pets ORDER BY name').all();
}

export function logPetEvent(params: {
  pet_id?: string;
  pet_name?: string;
  event_type: string;
  title: string;
  notes?: string;
  date?: string;
  next_due?: string;
}): string {
  const petId = resolvePetId(params.pet_id, params.pet_name);
  if (!petId) return 'Pet not found';
  const id = uuid();
  getDb().prepare('INSERT INTO pet_events (id, pet_id, event_type, title, notes, date, next_due) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, petId, params.event_type, params.title, params.notes || null, params.date || today(), params.next_due || null);
  return `Logged ${params.event_type}: ${params.title}`;
}

export function addPetMedication(params: {
  pet_id?: string;
  pet_name?: string;
  name: string;
  dosage?: string;
  frequency?: string;
  next_due?: string;
  notes?: string;
}): string {
  const petId = resolvePetId(params.pet_id, params.pet_name);
  if (!petId) return 'Pet not found';
  const id = uuid();
  getDb().prepare('INSERT INTO pet_medications (id, pet_id, name, dosage, frequency, next_due, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, petId, params.name, params.dosage || null, params.frequency || 'daily', params.next_due || null, params.notes || null);
  return `Added medication: ${params.name}`;
}

export function markMedGiven(params: {
  med_id?: string;
  med_name?: string;
  pet_id?: string;
  pet_name?: string;
}): string {
  const db = getDb();
  let med: any;
  if (params.med_id) {
    med = db.prepare('SELECT m.*, p.name as pet_name FROM pet_medications m JOIN pets p ON m.pet_id = p.id WHERE m.id = ?').get(params.med_id);
  } else if (params.med_name) {
    const petId = resolvePetId(params.pet_id, params.pet_name);
    if (!petId) return 'Pet not found';
    med = db.prepare('SELECT m.*, p.name as pet_name FROM pet_medications m JOIN pets p ON m.pet_id = p.id WHERE m.pet_id = ? AND LOWER(m.name) = LOWER(?)').get(petId, params.med_name);
  }
  if (!med) return 'Medication not found';

  const newNextDue = calculateNextDue(today(), med.frequency);
  if (newNextDue) {
    db.prepare('UPDATE pet_medications SET next_due = ? WHERE id = ?').run(newNextDue, med.id);
  }
  // Log the event
  const eventId = uuid();
  db.prepare('INSERT INTO pet_events (id, pet_id, event_type, title, notes, date) VALUES (?, ?, ?, ?, ?, ?)').run(
    eventId, med.pet_id, 'medication', `${med.name} given`, med.dosage ? `Dosage: ${med.dosage}` : null, today());
  return `${med.name} given to ${med.pet_name}${newNextDue ? `. Next due: ${newNextDue}` : ''}`;
}

export function upcomingPetCare(days = 7): any[] {
  const db = getDb();
  const untilDate = new Date();
  untilDate.setDate(untilDate.getDate() + days);
  const untilStr = untilDate.toISOString().split('T')[0];
  const todayStr = today();

  const meds = db.prepare(`
    SELECT m.*, p.name as pet_name FROM pet_medications m
    JOIN pets p ON m.pet_id = p.id
    WHERE m.active = 1 AND m.next_due IS NOT NULL AND m.next_due <= ?
    ORDER BY m.next_due
  `).all(untilStr) as any[];

  const events = db.prepare(`
    SELECT e.*, p.name as pet_name FROM pet_events e
    JOIN pets p ON e.pet_id = p.id
    WHERE e.next_due IS NOT NULL AND e.next_due <= ?
    ORDER BY e.next_due
  `).all(untilStr) as any[];

  return [...meds.map(m => ({
    type: 'medication',
    pet: m.pet_name,
    name: m.name,
    frequency: m.frequency,
    due: m.next_due,
    overdue: m.next_due < todayStr,
    isToday: m.next_due === todayStr,
  })), ...events.map(e => ({
    type: 'event',
    pet: e.pet_name,
    name: e.title,
    event_type: e.event_type,
    due: e.next_due,
    overdue: e.next_due < todayStr,
    isToday: e.next_due === todayStr,
  }))].sort((a, b) => a.due.localeCompare(b.due));
}
