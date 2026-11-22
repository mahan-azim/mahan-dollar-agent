import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets/app.js');
const source = readFileSync(file, 'utf8');
const start = source.indexOf('  const safeText =');
const end = source.indexOf('  function changeClass(', start);
assert.ok(start > -1 && end > start, 'UI normalization functions must exist');
// Evaluate the exact standalone formatting functions from the deployed frontend code.
const { normalize, marketTableRows } = new Function(source.slice(start, end) + '\nreturn { normalize, marketTableRows };')();

test('site shows actual server receipt time instead of generated time', () => {
  const packet = normalize({
    generated_at: '2026-11-22T20:00:00.000Z',
    server_received_at: '2026-11-22T20:01:30.000Z',
    assets: []
  });
  assert.equal(packet.generated_at, '2026-11-22T20:00:00.000Z');
  assert.equal(packet.received_at, '2026-11-22T20:01:30.000Z');
});

test('market assets remain visible without separately structured forecasts', () => {
  const packet = normalize({
    generated_at: '2026-11-22T20:00:00Z',
    assets: [{ symbol: 'USD', name: 'دلار آمریکا', price: 102000, unit: 'تومان' }]
  });
  const rows = marketTableRows(packet);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'دلار آمریکا');
  assert.equal(rows[0].current, 102000);
  assert.equal(rows[0].predicted, null);
});

test('real forecasts take precedence when provided', () => {
  const packet = normalize({
    assets: [{ symbol: 'USD', price: 102000 }],
    forecasts: [{ name: 'دلار آمریکا', current_price: 102000, predicted_price: 103500 }]
  });
  const rows = marketTableRows(packet);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].predicted, 103500);
});

test('empty API response does not invent prices or predictions', () => {
  const packet = normalize({});
  assert.deepEqual(Array.from(marketTableRows(packet)), []);
  assert.equal(packet.received_at, null);
});
