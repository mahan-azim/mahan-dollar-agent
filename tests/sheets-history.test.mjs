import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createSheetsHistoryReader, mergeMarketHistory } from '../lib/google-sheets-history.mjs';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const account = JSON.stringify({ type: 'service_account', client_email: 'sheets-reader@example-project.iam.gserviceaccount.com', private_key: privateKey });
const spreadsheetId = '1SttggF6pfCaDAnXR9Tiqsjb9ZQK0aX-FhumkiYqul6w';

test('private Google Sheets reader requests only time and actual price columns and caches ten minutes', async () => {
  const requests = [];
  let clock = Date.parse('2026-11-22T22:30:00Z');
  const mockFetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.match(options.body, /grant_type=/);
      return Response.json({ access_token: 'test-token', expires_in: 3600 });
    }
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    if (String(url).includes('/values:batchGet?')) {
      const ranges = new URL(url).searchParams.getAll('ranges');
      assert.equal(ranges.length, 3);
      assert.match(ranges[0], /!A2:A$/);
      assert.match(ranges[1], /!B2:B$/);
      assert.match(ranges[2], /!F2:F$/);
      // Neither the paid nor free analysis column is ever fetched.
      assert.ok(!ranges.some(range => /![DE]2:[DE]$/.test(range)));
      return Response.json({ valueRanges: [
        { values: [['2026-11-22T14:17:11.321-08:00'], ['2026-11-22T14:27:11.321-08:00']] },
        { values: [['2,687,800'], ['2,700,000']] },
        { values: [['3,100,000'], ['3,200,000']] }
      ] });
    }
    assert.match(String(url), /!A1%3AAZ1/);
    return Response.json({ values: [[
      'timestamp', 'USD_actual_price', 'USD_predicted_price',
      'free_output', 'paid_output', 'EUR_actual_price', 'EUR_predicted_price'
    ]] });
  };
  const reader = createSheetsHistoryReader({
    spreadsheetId, sheetName: 'Market History', serviceAccountJson: account,
    fetchImpl: mockFetch, now: () => clock
  });
  assert.equal(reader.configured, true);
  const history = await reader.getHistory();
  assert.deepEqual(Object.keys(history).sort(), ['EUR', 'USD']);
  assert.deepEqual(history.USD.map(p => p.price), [2687800, 2700000]);
  assert.equal(history.USD[0].time, '2026-11-22T22:17:11.321Z');
  assert.deepEqual(history.EUR.map(p => p.price), [3100000, 3200000]);
  assert.equal(requests.length, 3);

  await reader.getHistory();
  assert.equal(requests.length, 3, 'Cached history must not refetch for each page view');
  clock += 11 * 60 * 1000;
  await reader.getHistory();
  assert.equal(requests.length, 5, 'Cache expiry should fetch headers and actual prices again, reusing OAuth token');
});

test('Google Sheets data augments existing market, retains live price, and never exposes private analysis', () => {
  const history = { USD: [
    { time: '2026-11-22T22:17:11Z', price: 2687800 },
    { time: '2026-11-22T22:27:11Z', price: 2700000 }
  ] };
  const live = {
    analysis: 'Public free market summary',
    assets: [{
      symbol: 'USD', price: 2750000,
      history: [{ time: '2026-11-22T22:37:11Z', price: 2750000 }]
    }],
    news: []
  };
  const combined = mergeMarketHistory(live, history);
  assert.equal(combined.analysis, live.analysis);
  assert.equal(combined.assets[0].price, 2750000);
  assert.deepEqual(combined.assets[0].history.map(p => p.price), [2687800, 2700000, 2750000]);
  const historicalOnly = mergeMarketHistory(null, history);
  assert.equal(historicalOnly.assets[0].price, 2700000);
  assert.equal(historicalOnly.analysis, '');
  assert.equal(historicalOnly.assets[0].unit, 'ریال');
});

test('reader without private credentials stays inactive', async () => {
  const reader = createSheetsHistoryReader({ spreadsheetId, serviceAccountJson: '' });
  assert.equal(reader.configured, false);
  assert.equal(await reader.getHistory(), null);
});
