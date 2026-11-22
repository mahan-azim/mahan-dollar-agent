import { sign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const API_ORIGIN = 'https://sheets.googleapis.com';
const MAX_HISTORY = 500;
const MAX_CURRENCIES = 20;
const MAX_HEADER_COLUMNS = 52;
const CACHE_MS = 10 * 60 * 1000;

function parseServiceAccount(raw) {
  try {
    const account = JSON.parse(raw || '{}');
    if (typeof account.client_email !== 'string' || !account.client_email.endsWith('.gserviceaccount.com')) return null;
    if (typeof account.private_key !== 'string' || !account.private_key.includes('BEGIN PRIVATE KEY')) return null;
    return { email: account.client_email, privateKey: account.private_key };
  } catch { return null; }
}

function a1Column(index) {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    n -= 1;
    name = String.fromCharCode(65 + n % 26) + name;
    n = Math.floor(n / 26);
  }
  return name;
}

function validatedPrice(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const normalized = String(value).trim().replace(/[,_\s٬،]/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const price = Number(normalized);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function validatedTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value.trim());
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function sanitizeHistory(points) {
  const clean = [];
  const seen = new Set();
  for (const point of points || []) {
    if (!point || typeof point !== 'object') continue;
    const time = validatedTime(String(point.time ?? point.timestamp ?? ''));
    const price = validatedPrice(point.price ?? point.value);
    if (!time || price === null) continue;
    const key = time + ':' + price;
    if (!seen.has(key)) {
      clean.push({ time, price });
      seen.add(key);
    }
  }
  return clean.sort((a, b) => Date.parse(a.time) - Date.parse(b.time)).slice(-MAX_HISTORY);
}

export function mergeMarketHistory(latest, historyBySymbol) {
  const symbols = Object.keys(historyBySymbol || {}).filter(symbol =>
    /^[A-Z0-9]{2,12}$/.test(symbol) && Array.isArray(historyBySymbol[symbol]));
  if (!symbols.length) return latest;
  const originalAssets = Array.isArray(latest?.assets) ? latest.assets : [];
  const bySymbol = new Map(originalAssets
    .filter(asset => asset && typeof asset === 'object')
    .map(asset => [String(asset.symbol ?? asset.code ?? '').toUpperCase(), asset]));
  for (const symbol of symbols) {
    const historicalPoints = sanitizeHistory(historyBySymbol[symbol]);
    if (!historicalPoints.length) continue;
    const old = bySymbol.get(symbol);
    const history = sanitizeHistory([
      ...historicalPoints,
      ...(Array.isArray(old?.history) ? old.history : [])
    ]);
    if (old) {
      bySymbol.set(symbol, { ...old, history });
    } else {
      const last = historicalPoints.at(-1);
      bySymbol.set(symbol, {
        symbol, name: symbol === 'USD' ? 'دلار آمریکا' : symbol,
        price: last.price, unit: 'ریال', history
      });
    }
  }
  const assets = [...bySymbol.values()];
  if (!assets.length) return latest;
  if (latest) return { ...latest, assets };
  const allTimes = assets.flatMap(asset => asset.history?.map(point => point.time) || []).sort();
  return {
    generated_at: allTimes.at(-1) || new Date().toISOString(),
    assets, news: [], analysis: '', sources: {}
  };
}

export function createSheetsHistoryReader({
  spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
  sheetName = process.env.GOOGLE_SHEETS_SHEET_NAME || 'Market History',
  serviceAccountJson = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON,
  fetchImpl = fetch,
  now = () => Date.now(),
  cacheMs = CACHE_MS
} = {}) {
  const account = parseServiceAccount(serviceAccountJson);
  const configured = Boolean(account && /^[a-zA-Z0-9_-]{20,200}$/.test(spreadsheetId || '')
    && typeof sheetName === 'string' && sheetName.length > 0 && sheetName.length <= 100);
  let cachedHistory = null;
  let cacheUntil = 0;
  let inFlight = null;
  let accessToken = null;
  let tokenUntil = 0;
  const quotedTab = "'" + String(sheetName).replace(/'/g, "''") + "'";

  async function token() {
    if (accessToken && now() < tokenUntil) return accessToken;
    const nowSeconds = Math.floor(now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({
      iss: account.email, scope: SHEETS_SCOPE, aud: TOKEN_URL,
      iat: nowSeconds, exp: nowSeconds + 3000
    })).toString('base64url');
    const unsigned = header + '.' + claims;
    const signature = sign('RSA-SHA256', Buffer.from(unsigned), account.privateKey).toString('base64url');
    const form = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: unsigned + '.' + signature
    });
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(), signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Google OAuth returned HTTP ' + response.status);
    const body = await response.json();
    if (!body || typeof body.access_token !== 'string' || !body.access_token) throw new Error('Google OAuth token was not returned');
    accessToken = body.access_token;
    tokenUntil = now() + Math.max(60, Number(body.expires_in) || 3600) * 1000 - 60_000;
    return accessToken;
  }

  async function sheetsJson(url, bearer) {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + bearer, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Google Sheets returned HTTP ' + response.status);
    return response.json();
  }

  async function loadHistory() {
    const bearer = await token();
    const base = API_ORIGIN + '/v4/spreadsheets/' + encodeURIComponent(spreadsheetId);
    const headerRange = quotedTab + '!A1:AZ1';
    const headerUrl = base + '/values/' + encodeURIComponent(headerRange) + '?valueRenderOption=FORMATTED_VALUE';
    const headerResponse = await sheetsJson(headerUrl, bearer);
    const columns = Array.isArray(headerResponse.values?.[0]) ? headerResponse.values[0] : [];
    if (columns[0] !== 'timestamp') throw new Error('Google Sheet header timestamp is missing in column A');
    const currencyColumns = columns.slice(0, MAX_HEADER_COLUMNS).flatMap((header, i) => {
      const match = /^([A-Z0-9]{2,12})_actual_price$/.exec(String(header ?? ''));
      return match ? [{ symbol: match[1], column: a1Column(i) }] : [];
    }).slice(0, MAX_CURRENCIES);
    if (!currencyColumns.length) throw new Error('Google Sheet has no *_actual_price columns');
    const ranges = [quotedTab + '!A2:A', ...currencyColumns.map(x => quotedTab + '!' + x.column + '2:' + x.column)];
    const params = new URLSearchParams({ valueRenderOption: 'FORMATTED_VALUE', majorDimension: 'ROWS' });
    for (const range of ranges) params.append('ranges', range);
    const response = await sheetsJson(base + '/values:batchGet?' + params.toString(), bearer);
    const valueRanges = response.valueRanges;
    if (!Array.isArray(valueRanges) || valueRanges.length !== ranges.length) throw new Error('Incomplete Google Sheets response');
    const times = valueRanges[0].values || [];
    const history = {};
    for (const [i, { symbol }] of currencyColumns.entries()) {
      const prices = valueRanges[i + 1].values || [];
      const points = [];
      for (let row = 0; row < times.length; row += 1) {
        const time = validatedTime(times[row]?.[0]);
        const price = validatedPrice(prices[row]?.[0]);
        if (time && price !== null) points.push({ time, price });
      }
      if (points.length) history[symbol] = sanitizeHistory(points);
    }
    return history;
  }

  async function getHistory() {
    if (!configured) return null;
    if (cachedHistory && now() < cacheUntil) return cachedHistory;
    if (inFlight) return inFlight;
    inFlight = loadHistory().then(history => {
      cachedHistory = history;
      cacheUntil = now() + cacheMs;
      return history;
    }).catch(error => {
      if (cachedHistory) return cachedHistory;
      throw error;
    }).finally(() => { inFlight = null; });
    return inFlight;
  }

  return { configured, getHistory };
}
