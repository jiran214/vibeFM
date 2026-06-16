import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const indexHtml = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const showHtml = await readFile(new URL('./show.html', import.meta.url), 'utf8');
const appCss = await readFile(new URL('./css/app.css', import.meta.url), 'utf8');

test('home exposes the VibeFM station identity and source console', () => {
  assert.match(indexHtml, /class="station-ident"/);
  assert.match(indexHtml, /AI RADIO STATION/);
  assert.match(indexHtml, /class="source-console-head"/);
  assert.match(indexHtml, /SOURCE INPUT/);
});

test('home show cards expose episode and transmission state metadata', () => {
  assert.match(indexHtml, /show-episode/);
  assert.match(indexHtml, /show-signal/);
  assert.match(indexHtml, /show-card--ready/);
  assert.match(indexHtml, /show-card--generating/);
});

test('home does not load the unused Tailwind CDN runtime', () => {
  assert.doesNotMatch(indexHtml, /cdn\.tailwindcss\.com/);
});

test('player has a portrait layout and touch-sized primary controls', () => {
  assert.match(showHtml, /@media \(max-width: 820px\)/);
  assert.match(showHtml, /min-height:\s*100svh/);
  assert.match(showHtml, /\.play-button\s*\{[^}]*min-width:\s*44px/s);
  assert.match(showHtml, /\.back-btn\s*\{[^}]*min-width:\s*44px/s);
});

test('player progress exposes slider semantics', () => {
  assert.match(showHtml, /role="slider"/);
  assert.match(showHtml, /aria-valuenow="0"/);
  assert.match(showHtml, /setAttribute\('aria-valuenow'/);
});

test('player visual effects react to playback state', () => {
  assert.match(showHtml, /class="ambient-field"/);
  assert.match(showHtml, /class="vinyl-grooves"/);
  assert.match(showHtml, /class="vinyl-reflection"/);
  assert.match(showHtml, /classList\.add\('is-playing'\)/);
  assert.match(showHtml, /classList\.remove\('is-playing'\)/);
  assert.match(showHtml, /\.stage:not\(\.is-playing\) \.bar/);
});

test('player animates only when the active subtitle cue changes', () => {
  assert.match(showHtml, /let activeCueIndex = -1/);
  assert.match(showHtml, /activeCueIndex === currentIndex/);
  assert.match(showHtml, /classList\.remove\('is-entering'\)/);
  assert.match(showHtml, /classList\.add\('is-entering'\)/);
});

test('shared theme defines a radio-specific mono face and status colors', () => {
  assert.match(appCss, /--mono:/);
  assert.match(appCss, /--warning:/);
  assert.match(appCss, /--danger:/);
});
