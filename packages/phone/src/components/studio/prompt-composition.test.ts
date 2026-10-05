// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PROMPT_DIRECTIVES, PROMPT_STYLES } from './constants.js';

// The requirement: a directive is not one of the styles, because a style has
// to be addable on top of it. So the two have to COMPOSE, and the directive
// has to lead — it says how to treat the input, and burying it behind the
// picture's own adjectives is the way to make it stop working.
//
// This mirrors buildFullPrompt deliberately in shape but is fed by the real
// tables, so a directive added to the list with an empty body, or a rename that
// breaks the None convention, fails here rather than silently on the owner's screen.
function compose(prompt: string, directiveName: string, styleName: string): string {
  let full = prompt.trim();
  const style = PROMPT_STYLES.find(s => s.name === styleName);
  if (styleName && style?.style) full = `${full}, ${style.style}`;
  const directive = PROMPT_DIRECTIVES.find(d => d.name === directiveName);
  if (directiveName && directive?.directive) full = `${directive.directive}\n\n${full}`;
  return full;
}

test('a directive and a style are both applied and the directive leads', () => {
  const out = compose('a figure on a rooftop', 'Sketch', 'Watercolor');
  assert.ok(out.startsWith('Create an original artwork inspired by the attached sketch.'));
  assert.ok(out.includes('a figure on a rooftop, soft watercolor painting'));
  assert.ok(out.indexOf('attached sketch') < out.indexOf('a figure on a rooftop'));
});

test('either one alone still works', () => {
  assert.equal(compose('a heron', '', ''), 'a heron');
  assert.ok(compose('a heron', '', 'Comic').startsWith('a heron, in a bold comic'));
  assert.ok(compose('a heron', 'Sketch', '').endsWith('a heron'));
});

test('None is the off switch on both lists and neither carries text', () => {
  assert.equal(PROMPT_DIRECTIVES[0].name, 'None');
  assert.equal(PROMPT_DIRECTIVES[0].directive, '');
  assert.equal(PROMPT_STYLES[0].name, 'None');
  assert.equal(PROMPT_STYLES[0].style, '');
});

test('every directive except None actually says something', () => {
  for (const d of PROMPT_DIRECTIVES.slice(1)) {
    assert.ok(d.directive.trim().length > 40, `${d.name} is empty or a stub`);
  }
});

test('the sketch directive is carried verbatim', () => {
  const sketch = PROMPT_DIRECTIVES.find(d => d.name === 'Sketch');
  assert.ok(sketch);
  assert.ok(sketch.directive.includes('Preserve its subject, emotion, and gesture—not its exact strokes or shapes.'));
  assert.ok(sketch.directive.includes('Never trace or retain the original lines'));
  assert.ok(sketch.directive.includes('For simple sketches, invent a richer interpretation.'));
});
