// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Command Center REST routes — household management endpoints
import { Router } from 'express';
import * as cc from '../services/cc.js';
import { getAerieConfig } from '../config.js';

const router = Router();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

router.get('/config', (_req, res) => {
  const cfg = getAerieConfig().command_center;
  res.json({ ok: true, default_person: cfg.default_person, currency_symbol: cfg.currency_symbol, care_categories: cfg.care_categories });
});

// ---------------------------------------------------------------------------
// Status aggregator
// ---------------------------------------------------------------------------

router.get('/status', (_req, res) => {
  try {
    const status = cc.getCcStatus();
    res.json({ ok: true, status });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Care entries
// ---------------------------------------------------------------------------

router.get('/care', (req, res) => {
  const { date, person } = req.query as { date?: string; person?: string };
  if (!date) return res.status(400).json({ ok: false, error: 'date required' });
  res.json({ ok: true, entries: cc.getCareEntries(date, person) });
});

router.get('/care/history', (req, res) => {
  const { person, days } = req.query as { person?: string; days?: string };
  if (!person) return res.status(400).json({ ok: false, error: 'person required' });
  res.json({ ok: true, entries: cc.getCareHistory(person, days ? parseInt(days) : 7) });
});

router.put('/care', (req, res) => {
  const entry = cc.upsertCareEntry(req.body);
  res.json({ ok: true, entry });
});

router.delete('/care/:id', (req, res) => {
  const deleted = cc.deleteCareEntry(req.params.id);
  res.json({ ok: true, deleted });
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

router.get('/tasks', (req, res) => {
  const { status, project, date, person, due_before, carry_forward } = req.query as Record<string, string>;
  const tasks = cc.listTasks({
    status, project, date, person, due_before,
    carry_forward: carry_forward === 'true',
  });
  res.json({ ok: true, tasks });
});

router.post('/tasks', (req, res) => {
  const task = cc.addTask(req.body);
  res.json({ ok: true, task });
});

router.put('/tasks/:id', (req, res) => {
  const updated = cc.updateTask(req.params.id, req.body);
  res.json({ ok: true, updated });
});

router.put('/tasks/:id/complete', (req, res) => {
  const result = cc.completeTask(req.params.id);
  res.json({ ok: true, result });
});

router.delete('/tasks/:id', (req, res) => {
  const result = cc.updateTask(req.params.id, { status: 'deleted' });
  res.json({ ok: true, deleted: result });
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

router.get('/projects', (req, res) => {
  const { status } = req.query as { status?: string };
  res.json({ ok: true, projects: cc.listProjects(status) });
});

router.post('/projects', (req, res) => {
  const project = cc.addProject(req.body);
  res.json({ ok: true, project });
});

router.put('/projects/:id', (req, res) => {
  const updated = cc.updateProject(req.params.id, req.body);
  res.json({ ok: true, updated });
});

router.delete('/projects/:id', (req, res) => {
  const deleted = cc.deleteProject(req.params.id);
  res.json({ ok: true, deleted });
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

router.get('/events', (req, res) => {
  const { start_date, end_date, category } = req.query as Record<string, string>;
  res.json({ ok: true, events: cc.listEvents({ start_date, end_date, category }) });
});

router.post('/events', (req, res) => {
  const event = cc.addEvent(req.body);
  res.json({ ok: true, event });
});

router.put('/events/:id', (req, res) => {
  const updated = cc.updateEvent(req.params.id, req.body);
  res.json({ ok: true, updated });
});

router.delete('/events/:id', (req, res) => {
  const deleted = cc.deleteEvent(req.params.id);
  res.json({ ok: true, deleted });
});

// ---------------------------------------------------------------------------
// Cycle
// ---------------------------------------------------------------------------

router.get('/cycle/status', (_req, res) => {
  res.json({ ok: true, ...cc.getCycleStatus() });
});

router.get('/cycle/history', (req, res) => {
  const { limit } = req.query as { limit?: string };
  res.json({ ok: true, cycles: cc.getCycleHistory(limit ? parseInt(limit) : 6) });
});

router.get('/cycle/predict', (_req, res) => {
  res.json({ ok: true, ...cc.getCyclePredict() });
});

router.post('/cycle/period/start', (req, res) => {
  const result = cc.startPeriod(req.body.date, req.body.notes);
  res.json({ ok: true, result });
});

router.post('/cycle/period/end', (req, res) => {
  const result = cc.endPeriod(req.body.date);
  res.json({ ok: true, result });
});

router.post('/cycle/log', (req, res) => {
  const result = cc.logCycleDaily(req.body);
  res.json({ ok: true, result });
});

// ---------------------------------------------------------------------------
// Pets
// ---------------------------------------------------------------------------

router.get('/pets', (_req, res) => {
  res.json({ ok: true, pets: cc.listPets() });
});

router.post('/pets', (req, res) => {
  const pet = cc.addPet(req.body);
  res.json({ ok: true, pet });
});

router.post('/pets/events', (req, res) => {
  const result = cc.logPetEvent(req.body);
  res.json({ ok: true, result });
});

router.post('/pets/medications', (req, res) => {
  const result = cc.addPetMedication(req.body);
  res.json({ ok: true, result });
});

router.post('/pets/medications/given', (req, res) => {
  const result = cc.markMedGiven(req.body);
  res.json({ ok: true, result });
});

router.get('/pets/upcoming', (req, res) => {
  const { days } = req.query as { days?: string };
  res.json({ ok: true, items: cc.upcomingPetCare(days ? parseInt(days) : 7) });
});

router.put('/pets/:id', (req, res) => {
  const updated = cc.updatePet(req.params.id, req.body);
  res.json({ ok: true, updated });
});

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

router.get('/lists', (_req, res) => {
  res.json({ ok: true, lists: cc.getAllLists() });
});

router.post('/lists', (req, res) => {
  const list = cc.createList(req.body);
  res.json({ ok: true, list });
});

router.get('/lists/:id', (req, res) => {
  const list = cc.getListWithItems(req.params.id);
  if (!list) return res.status(404).json({ ok: false, error: 'List not found' });
  res.json({ ok: true, list });
});

router.delete('/lists/:id', (req, res) => {
  const deleted = cc.deleteLst(req.params.id);
  res.json({ ok: true, deleted });
});

router.post('/lists/:id/items', (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [req.body.item].filter(Boolean);
  const count = cc.addListItems(req.params.id, items, req.body.added_by);
  res.json({ ok: true, count });
});

router.put('/lists/items/:itemId', (req, res) => {
  if (req.body.text !== undefined) {
    const updated = cc.updateListItem(req.params.itemId, { text: req.body.text, checked: req.body.checked });
    res.json({ ok: true, updated });
  } else {
    const checked = cc.checkListItem(req.params.itemId, req.body.checked ?? true);
    res.json({ ok: true, checked });
  }
});

router.delete('/lists/items/:itemId', (req, res) => {
  const deleted = cc.deleteListItem(req.params.itemId);
  res.json({ ok: true, deleted });
});

router.delete('/lists/:id/items', (req, res) => {
  const { all } = req.query as { all?: string };
  const count = cc.clearListItems(req.params.id, all === 'true');
  res.json({ ok: true, cleared: count });
});

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

router.get('/expenses', (req, res) => {
  const { start_date, end_date, category, paid_by, limit } = req.query as Record<string, string>;
  const result = cc.listExpenses({ start_date, end_date, category, paid_by, limit: limit ? parseInt(limit) : undefined });
  res.json({ ok: true, ...result });
});

router.post('/expenses', (req, res) => {
  const expense = cc.addExpense(req.body);
  res.json({ ok: true, expense });
});

router.get('/expenses/stats', (req, res) => {
  try {
    const { period } = req.query as { period?: string };
    res.json({ ok: true, ...cc.getExpenseStats(period) });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Countdowns
// ---------------------------------------------------------------------------

router.get('/countdowns', (_req, res) => {
  res.json({ ok: true, countdowns: cc.listCountdowns() });
});

router.post('/countdowns', (req, res) => {
  const countdown = cc.addCountdown(req.body);
  res.json({ ok: true, countdown });
});

router.delete('/countdowns/:id', (req, res) => {
  const deleted = cc.deleteCountdown(req.params.id);
  res.json({ ok: true, deleted });
});

// ---------------------------------------------------------------------------
// Daily wins
// ---------------------------------------------------------------------------

router.get('/wins', (req, res) => {
  const { date } = req.query as { date?: string };
  res.json({ ok: true, wins: cc.getDailyWins(date) });
});

router.post('/wins', (req, res) => {
  const win = cc.upsertDailyWin(req.body);
  res.json({ ok: true, win });
});

// ---------------------------------------------------------------------------
// Scratchpad (daily plan)
// ---------------------------------------------------------------------------

router.get('/scratchpad', (_req, res) => {
  res.json({ ok: true, ...cc.getScratchpad() });
});

router.post('/scratchpad/notes', (req, res) => {
  const { text, created_by } = req.body;
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });
  const note = cc.addScratchpadNote(text, created_by);
  res.json({ ok: true, note });
});

router.put('/scratchpad/notes/:id', (req, res) => {
  try {
    const note = cc.updateScratchpadNote(req.params.id, req.body.text);
    res.json({ ok: true, note });
  } catch (e: any) {
    res.status(404).json({ ok: false, error: e.message });
  }
});

router.delete('/scratchpad/notes/:id', (req, res) => {
  const deleted = cc.deleteScratchpadNote(req.params.id);
  res.json({ ok: true, deleted });
});

router.delete('/scratchpad/notes', (_req, res) => {
  const cleared = cc.clearScratchpadNotes();
  res.json({ ok: true, cleared });
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

router.get('/stats/tasks', (req, res) => {
  const { days } = req.query as { days?: string };
  try {
    res.json({ ok: true, ...cc.getTaskStats(days ? parseInt(days) : 14) });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/stats/care', (req, res) => {
  const { person, days } = req.query as { person?: string; days?: string };
  try {
    res.json({ ok: true, ...cc.getCareStats(person || getAerieConfig().command_center.default_person, days ? parseInt(days) : 14) });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/stats/cycle', (_req, res) => {
  try {
    res.json({ ok: true, ...cc.getCycleStats() });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
