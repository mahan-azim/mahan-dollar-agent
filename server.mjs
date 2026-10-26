import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, '.local-data'));
const STATE_FILE = path.join(DATA_DIR, 'market-state.json');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 1_000_000;
const DEFAULT_CLOCK_SKEW_SECONDS = 300;
const MAX_ASSETS = 200;
const MAX_NEWS = 500;
const MAX_HISTORY_POINTS = 500;
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY'
};
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

const OWNER_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL || 'mahaneli1394@gmail.com') || 'mahaneli1394@gmail.com';
let state = { latest: null, events: {}, adminEmails: [], workflowEnabled: true };
let writeQueue = Promise.resolve();
let publishWindow = { startedAt: Date.now(), count: 0 };
const MAX_PUBLISH_REQUESTS_PER_MINUTE = 120;

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { ...JSON_HEADERS, ...extraHeaders });
  res.end(JSON.stringify(body));
}

function withWriteLock(fn) {
  const current = writeQueue.then(fn);
  writeQueue = current.catch(() => {});
  return current;
}

async function loadState() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    state = {
      latest: parsed?.latest && typeof parsed.latest === 'object' ? parsed.latest : null,
      events: parsed?.events && typeof parsed.events === 'object' ? parsed.events : {},
      adminEmails: Array.isArray(parsed?.adminEmails) ? [...new Set(parsed.adminEmails.map(normalizeEmail).filter(Boolean))] : [],
      workflowEnabled: parsed?.workflowEnabled !== false
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Could not read stored market state:', error.message);
      throw error;
    }
    await saveState(state);
  }
}

async function saveState(nextState) {
  await mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${STATE_FILE}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempFile, JSON.stringify(nextState), { encoding: 'utf8', mode: 0o600 });
  await rename(tempFile, STATE_FILE);
}

function header(req, name) {
  const value = req.headers[name.toLowerCase()];
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

async function readRequestBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error('BODY_TOO_LARGE');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function extractAssets(payload) {
  if (Array.isArray(payload.assets)) return payload.assets;
  if (Array.isArray(payload.currencies)) return payload.currencies;
  if (Array.isArray(payload.prices)) return payload.prices;
  if (payload.prices && typeof payload.prices === 'object') {
    return Object.entries(payload.prices).map(([symbol, value]) => ({
      symbol,
      name: ({ tgju: 'دلار آزاد (TGJU)', tindex_usd: 'دلار آمریکا (Tindex)' })[symbol] || symbol,
      ...(value && typeof value === 'object' && !Array.isArray(value) ? value : { price: value })
    }));
  }
  return [];
}

function symbolOf(asset) {
  return String(asset?.symbol ?? asset?.code ?? asset?.id ?? asset?.slug ?? '').trim();
}

function numericPrice(asset) {
  const value = asset?.price ?? asset?.value ?? asset?.last_price ?? asset?.last ?? asset?.current_price ?? asset?.close;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/[,_\s٬،]/g, ''));
  return Number.isFinite(parsed) && value.trim() !== '' ? parsed : null;
}

function pointOf(point) {
  if (Array.isArray(point) && point.length >= 2) {
    const price = Number(String(point[1]).replace(/[,_\s٬،]/g, ''));
    return point[0] != null && Number.isFinite(price) ? { time: String(point[0]), price } : null;
  }
  if (!point || typeof point !== 'object') return null;
  const time = point.time ?? point.timestamp ?? point.date ?? point.generated_at;
  const value = point.price ?? point.value;
  const price = Number(typeof value === 'string' ? value.replace(/[,_\s٬،]/g, '') : value);
  return time != null && Number.isFinite(price) ? { time: String(time), price } : null;
}

function attachHistory(incomingAssets, previousAssets, receivedAt) {
  const previousBySymbol = new Map((Array.isArray(previousAssets) ? previousAssets : [])
    .map(asset => [symbolOf(asset), asset]).filter(([symbol]) => symbol));
  return incomingAssets.slice(0, MAX_ASSETS).map(original => {
    const asset = original && typeof original === 'object' && !Array.isArray(original) ? { ...original } : { price: original };
    const symbol = symbolOf(asset);
    const previous = previousBySymbol.get(symbol);
    const oldPoints = [
      ...(Array.isArray(previous?.history) ? previous.history : []),
      ...(Array.isArray(asset.history) ? asset.history : [])
    ].map(pointOf).filter(Boolean);
    const currentPrice = numericPrice(asset);
    if (currentPrice !== null) oldPoints.push({ time: receivedAt, price: currentPrice });
    const unique = new Map();
    for (const point of oldPoints) unique.set(`${point.time}|${point.price}`, point);
    const history = [...unique.values()].sort((a, b) => {
      const ta = Date.parse(a.time), tb = Date.parse(b.time);
      if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
      return String(a.time).localeCompare(String(b.time));
    }).slice(-MAX_HISTORY_POINTS);
    return { ...asset, history };
  });
}

function validPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = ['analysis', 'output', 'report', 'ai_analysis', 'news', 'articles', 'assets', 'currencies', 'prices', 'market_context'];
  if (!keys.some(key => payload[key] !== undefined && payload[key] !== null)) return false;
  for (const key of ['news', 'articles', 'assets', 'currencies']) {
    if (payload[key] !== undefined && !Array.isArray(payload[key])) return false;
  }
  if (payload.assets && payload.assets.length > MAX_ASSETS) return false;
  if (payload.news && payload.news.length > MAX_NEWS) return false;
  if (payload.analysis !== undefined && typeof payload.analysis !== 'string' && typeof payload.analysis !== 'object') return false;
  return true;
}

function allowedPublishRate() {
  // Simple instance-wide flood control. Authentication via HMAC is the real security boundary.
  const now = Date.now();
  if (now - publishWindow.startedAt >= 60_000) publishWindow = { startedAt: now, count: 0 };
  publishWindow.count += 1;
  return publishWindow.count <= MAX_PUBLISH_REQUESTS_PER_MINUTE;
}


function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function isOwner(user) {
  return Boolean(user?.emailVerified && user.email && user.email.toLowerCase() === OWNER_EMAIL);
}

function isAdmin(user) {
  if (!user?.emailVerified || !user.email) return false;
  const email = user.email.toLowerCase();
  return email === OWNER_EMAIL || state.adminEmails.includes(email);
}

async function getAuthenticatedUser(req) {
  const token = header(req, 'authorization').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
  if (!token || !supabaseUrl || !anonKey) return null;
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return null;
    const raw = await response.json();
    const identityVerified = Array.isArray(raw.identities) && raw.identities.some(identity => {
      const data = identity?.identity_data || {};
      return data.email_verified === true || data.verified === true;
    });
    return {
      id: String(raw.id || ''),
      email: normalizeEmail(raw.email),
      phone: String(raw.phone || ''),
      emailVerified: Boolean(raw.email_confirmed_at || identityVerified),
      phoneVerified: Boolean(raw.phone_confirmed_at),
      provider: String(raw.app_metadata?.provider || raw.identities?.[0]?.provider || '')
    };
  } catch (error) {
    console.error('Supabase user verification failed:', error.message);
    return null;
  }
}

async function authorize(req, res, ownerOnly = false) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    json(res, 401, { error: 'برای ادامه باید وارد حساب کاربری شوی.', code: 'AUTH_REQUIRED' });
    return null;
  }
  if (!isAdmin(user)) {
    json(res, 403, { error: 'این بخش فقط برای مدیران مجاز است.', code: 'ADMIN_REQUIRED' });
    return null;
  }
  if (ownerOnly && !isOwner(user)) {
    json(res, 403, { error: 'فقط مدیر اصلی اجازهٔ مدیریت دسترسی مدیران را دارد.', code: 'OWNER_REQUIRED' });
    return null;
  }
  return user;
}

async function readJsonBody(req, res) {
  try {
    const raw = await readRequestBody(req);
    return JSON.parse(raw || '{}');
  } catch (error) {
    json(res, error.statusCode || 400, { error: error.statusCode === 413 ? 'حجم درخواست بیش از حد مجاز است.' : 'بدنهٔ درخواست JSON معتبر نیست.' });
    return null;
  }
}

function getN8nConfig() {
  const rawBase = String(process.env.N8N_API_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = String(process.env.N8N_API_KEY || '').trim();
  const workflowId = String(process.env.N8N_WORKFLOW_ID || '').trim();
  if (!rawBase || !apiKey || !workflowId) return null;
  const base = /\/api\/v\d+$/i.test(rawBase) ? rawBase : `${rawBase}/api/v1`;
  return { base, apiKey, workflowId };
}

async function callN8nWorkflow(action = 'read') {
  const config = getN8nConfig();
  if (!config) return { configured: false, active: null, message: 'اتصال مدیریتی n8n هنوز تنظیم نشده است.' };
  const suffix = action === 'read' ? '' : `/${action === 'enable' ? 'activate' : 'deactivate'}`;
  const method = action === 'read' ? 'GET' : 'POST';
  const response = await fetch(`${config.base}/workflows/${encodeURIComponent(config.workflowId)}${suffix}`, {
    method,
    headers: {
      'X-N8N-API-KEY': config.apiKey,
      Accept: 'application/json',
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
    },
    ...(method === 'POST' ? { body: '{}' } : {}),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`n8n API returned HTTP ${response.status}`);
  const workflow = await response.json();
  return {
    configured: true,
    available: true,
    active: Boolean(workflow.active),
    name: String(workflow.name || 'n8n workflow'),
    id: String(workflow.id || config.workflowId),
    updatedAt: workflow.updatedAt || null
  };
}

async function adminApi(req, res, pathname) {
  if (pathname === '/api/admin/overview' && req.method === 'GET') {
    const user = await authorize(req, res);
    if (!user) return;
    return json(res, 200, {
      brand: 'Mahan Market Agent',
      account: { email: user.email, phone: user.phone, provider: user.provider, isOwner: isOwner(user) },
      api: {
        signingKeyConfigured: Buffer.byteLength(process.env.N8N_PUSH_SECRET || '', 'utf8') >= 32,
        lastReceivedAt: state.latest?.received_at || null,
        lastEventId: state.latest?.event_id || null
      },
      data: {
        hasSnapshot: Boolean(state.latest),
        assetCount: Array.isArray(state.latest?.assets) ? state.latest.assets.length : extractAssets(state.latest || {}).length,
        newsCount: Array.isArray(state.latest?.news) ? state.latest.news.length : 0,
        generatedAt: state.latest?.generated_at || null
      },
      services: {
        authenticationConfigured: Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY)),
        n8nManagementConfigured: Boolean(getN8nConfig()),
        persistentVolumeConfigured: Boolean(process.env.DATA_DIR)
      }
    });
  }

  if (pathname === '/api/admin/workflow' && req.method === 'GET') {
    const user = await authorize(req, res);
    if (!user) return;
    try {
      const result = await callN8nWorkflow('read');
      if (result.configured && result.available && typeof result.active === 'boolean' && state.workflowEnabled !== result.active) {
        await withWriteLock(async () => {
          const next = { ...state, workflowEnabled: result.active };
          await saveState(next);
          state = next;
        });
      }
      return json(res, 200, result);
    } catch (error) {
      console.error('Could not read n8n workflow state:', error.message);
      return json(res, 502, { configured: true, available: false, active: null, message: 'وضعیت ورک‌فلو از n8n قابل دریافت نیست. کلید API و شناسهٔ ورک‌فلو را بررسی کن.' });
    }
  }

  if (pathname === '/api/admin/workflow' && req.method === 'POST') {
    const user = await authorize(req, res);
    if (!user) return;
    const body = await readJsonBody(req, res);
    if (!body) return;
    if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'مقدار enabled باید true یا false باشد.' });
    if (!getN8nConfig()) return json(res, 503, { error: 'برای کنترل واقعی ورک‌فلو، N8N_API_BASE_URL، N8N_API_KEY و N8N_WORKFLOW_ID را در Railway تنظیم کن.', code: 'N8N_MANAGEMENT_NOT_CONFIGURED' });
    try {
      const result = await callN8nWorkflow(body.enabled ? 'enable' : 'disable');
      await withWriteLock(async () => {
        const next = { ...state, workflowEnabled: body.enabled };
        await saveState(next);
        state = next;
      });
      return json(res, 200, { ok: true, ...result, active: result.active ?? body.enabled });
    } catch (error) {
      console.error('Could not change n8n workflow state:', error.message);
      return json(res, 502, { error: 'n8n نتوانست وضعیت ورک‌فلو را تغییر دهد. API key و دسترسی workflow:activate را بررسی کن.' });
    }
  }

  if (pathname === '/api/admin/admins' && req.method === 'GET') {
    const user = await authorize(req, res);
    if (!user) return;
    const emails = [...new Set([OWNER_EMAIL, ...state.adminEmails])].filter(Boolean).sort();
    return json(res, 200, { ownerEmail: OWNER_EMAIL, isOwner: isOwner(user), admins: emails.map(email => ({ email, owner: email === OWNER_EMAIL })) });
  }

  if (pathname === '/api/admin/admins' && req.method === 'POST') {
    const user = await authorize(req, res, true);
    if (!user) return;
    const body = await readJsonBody(req, res);
    if (!body) return;
    const email = normalizeEmail(body.email);
    if (!email) return json(res, 400, { error: 'یک نشانی ایمیل معتبر وارد کن.' });
    if (email === OWNER_EMAIL || state.adminEmails.includes(email)) return json(res, 409, { error: 'این ایمیل از قبل دسترسی مدیر دارد.' });
    if (state.adminEmails.length >= 100) return json(res, 409, { error: 'حداکثر ۱۰۰ مدیر قابل ثبت است.' });
    try {
      await withWriteLock(async () => {
        const next = { ...state, adminEmails: [...new Set([...state.adminEmails, email])].slice(0, 100) };
        await saveState(next);
        state = next;
      });
      return json(res, 201, { ok: true, email, message: 'ایمیل مدیر ثبت شد؛ ورود با همین ایمیل و تأیید آن لازم است.' });
    } catch (error) {
      console.error('Could not add admin:', error.message);
      return json(res, 503, { error: 'ذخیرهٔ دسترسی مدیر ناموفق بود.' });
    }
  }

  const removeAdminMatch = pathname.match(/^\/api\/admin\/admins\/([^/]+)$/);
  if (removeAdminMatch && req.method === 'DELETE') {
    const user = await authorize(req, res, true);
    if (!user) return;
    let email;
    try { email = normalizeEmail(decodeURIComponent(removeAdminMatch[1])); }
    catch { return json(res, 400, { error: 'ایمیل نامعتبر است.' }); }
    if (!email) return json(res, 400, { error: 'ایمیل نامعتبر است.' });
    if (email === OWNER_EMAIL) return json(res, 403, { error: 'دسترسی مدیر اصلی قابل حذف نیست.' });
    try {
      await withWriteLock(async () => {
        const next = { ...state, adminEmails: state.adminEmails.filter(item => item !== email) };
        await saveState(next);
        state = next;
      });
      return json(res, 200, { ok: true, email });
    } catch (error) {
      console.error('Could not remove admin:', error.message);
      return json(res, 503, { error: 'حذف دسترسی مدیر ناموفق بود.' });
    }
  }

  return json(res, 404, { error: 'مسیر مدیریت پیدا نشد.' });
}

async function publish(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'فقط درخواست POST پذیرفته می‌شود.' });
  }
  if (state.workflowEnabled === false) return json(res, 423, { error: 'دریافت داده از n8n توسط مدیر غیرفعال شده است.', code: 'WORKFLOW_DISABLED' });
  if (!allowedPublishRate()) return json(res, 429, { error: 'تعداد درخواست‌ها بیش از حد مجاز است.' });

  const secret = process.env.N8N_PUSH_SECRET || '';
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    return json(res, 503, { error: 'کلید N8N_PUSH_SECRET در تنظیمات سرور تعریف نشده یا کوتاه است.' });
  }
  const timestamp = header(req, 'x-mahan-timestamp');
  const eventId = header(req, 'x-mahan-event-id');
  const signature = header(req, 'x-mahan-signature').replace(/^sha256=/i, '').toLowerCase();
  if (!/^\d{10,13}$/.test(timestamp) || !/^[A-Za-z0-9._:-]{16,128}$/.test(eventId) || !/^[a-f0-9]{64}$/.test(signature)) {
    return json(res, 401, { error: 'هدرهای احراز هویت ناقص یا نامعتبر هستند.' });
  }
  const timestampNumber = Number(timestamp.length === 13 ? Math.floor(Number(timestamp) / 1000) : timestamp);
  const maxSkew = Math.max(30, Math.min(900, Number(process.env.N8N_MAX_CLOCK_SKEW_SECONDS) || DEFAULT_CLOCK_SKEW_SECONDS));
  if (!Number.isSafeInteger(timestampNumber) || Math.abs(Math.floor(Date.now() / 1000) - timestampNumber) > maxSkew) {
    return json(res, 401, { error: 'زمان درخواست منقضی شده است؛ ساعت n8n و سرور را بررسی کنید.' });
  }
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_BODY_BYTES) return json(res, 413, { error: 'حجم پیام از حد مجاز بیشتر است.' });

  let rawBody;
  try {
    rawBody = await readRequestBody(req);
  } catch (error) {
    return json(res, error.statusCode || 400, { error: error.statusCode === 413 ? 'حجم پیام از حد مجاز بیشتر است.' : 'خواندن بدنهٔ درخواست ناموفق بود.' });
  }
  const expected = createHmac('sha256', secret).update(`${timestamp}.${eventId}.${rawBody}`, 'utf8').digest();
  const supplied = Buffer.from(signature, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return json(res, 401, { error: 'امضای امنیتی درست نیست؛ پیام پذیرفته نشد.' });
  }
  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return json(res, 400, { error: 'بدنهٔ درخواست JSON معتبر نیست.' }); }
  if (!validPayload(payload)) return json(res, 422, { error: 'ساختار داده با قرارداد API سازگار نیست.' });

  const receivedAt = new Date().toISOString();
  const idHash = createHash('sha256').update(eventId).digest('hex');
  const eventBucket = Math.floor(timestampNumber / 300);
  const eventKey = `${eventBucket}:${idHash}`;
  try {
    const result = await withWriteLock(async () => {
      const nextEvents = { ...state.events };
      const nowBucket = Math.floor(Date.now() / 1000 / 300);
      for (const key of Object.keys(nextEvents)) {
        const bucket = Number(key.slice(0, key.indexOf(':')));
        if (!Number.isFinite(bucket) || bucket < nowBucket - 4) delete nextEvents[key];
      }
      if (nextEvents[eventKey]) return { duplicate: true };

      const previous = state.latest;
      const incomingAssets = extractAssets(payload);
      const previousAssets = previous?.assets || extractAssets(previous || {});
      const enrichedAssets = incomingAssets.length
        ? attachHistory(incomingAssets, previousAssets, receivedAt)
        : previousAssets;
      const nextLatest = {
        ...(previous && typeof previous === 'object' ? previous : {}),
        ...payload,
        generated_at: payload.generated_at ?? payload.updated_at ?? receivedAt,
        assets: enrichedAssets,
        news: Array.isArray(payload.news) ? payload.news.slice(0, MAX_NEWS)
          : Array.isArray(payload.articles) ? payload.articles.slice(0, MAX_NEWS)
          : Array.isArray(previous?.news) ? previous.news : [],
        sources: payload.sources ?? previous?.sources ?? {},
        received_at: receivedAt,
        event_id: eventId,
        server_received_at: receivedAt
      };
      nextEvents[eventKey] = { event_id_hash: idHash, received_at: receivedAt };
      const nextState = { ...state, latest: nextLatest, events: nextEvents };
      await saveState(nextState);
      state = nextState;
      return { duplicate: false, assetCount: enrichedAssets.length };
    });
    if (result.duplicate) return json(res, 409, { error: 'این رویداد قبلاً دریافت شده است.', code: 'DUPLICATE_EVENT' });
    return json(res, 200, { ok: true, received_at: receivedAt, event_id: eventId, asset_count: result.assetCount });
  } catch (error) {
    console.error('market publish failed:', error.message);
    return json(res, 503, { error: 'ذخیره‌سازی داده ناموفق بود؛ پیام با موفقیت منتشر نشد.' });
  }
}

async function serveStatic(req, res, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return json(res, 405, { error: 'این مسیر فقط GET را می‌پذیرد.' });
  }
  let decoded;
  try { decoded = decodeURIComponent(urlPath); }
  catch { return json(res, 400, { error: 'آدرس نامعتبر است.' }); }
  if (decoded === '/') decoded = '/index.html';
  const safePath = path.resolve(PUBLIC_DIR, `.${decoded}`);
  if (safePath !== PUBLIC_DIR && !safePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    return json(res, 403, { error: 'دسترسی غیرمجاز است.' });
  }
  try {
    const data = await readFile(safePath);
    const type = MIME_TYPES[path.extname(safePath).toLowerCase()] || 'application/octet-stream';
    const cache = type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
    if (req.method === 'HEAD') return res.end();
    return res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return json(res, 404, { error: 'صفحه یا فایل پیدا نشد.' });
    console.error('static file error:', error.message);
    return json(res, 500, { error: 'خواندن فایل ناموفق بود.' });
  }
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || 'localhost';
  let pathname;
  try { pathname = new URL(req.url || '/', `http://${host}`).pathname; }
  catch { return json(res, 400, { error: 'آدرس درخواست نامعتبر است.' }); }

  if (pathname === '/health') {
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/auth/config' && req.method === 'GET') {
    const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
    return json(res, 200, {
      configured: Boolean(supabaseUrl && anonKey),
      supabaseUrl: supabaseUrl || null,
      supabaseAnonKey: anonKey || null,
      brand: 'Mahan Market Agent',
      methods: ['google', 'azure', 'apple', 'github', 'email', 'phone']
    });
  }
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = await getAuthenticatedUser(req);
    if (!user) return json(res, 401, { error: 'نشست معتبر نیست یا احراز هویت تنظیم نشده است.', code: 'AUTH_REQUIRED' });
    return json(res, 200, {
      user: { id: user.id, email: user.email, phone: user.phone, emailVerified: user.emailVerified, phoneVerified: user.phoneVerified, provider: user.provider },
      isAdmin: isAdmin(user),
      isOwner: isOwner(user)
    });
  }

  if (pathname.startsWith('/api/admin/')) return adminApi(req, res, pathname);
  if (pathname === '/api/publish') return publish(req, res);
  if (pathname === '/api/market') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return json(res, 405, { error: 'این مسیر فقط برای خواندن داده و با GET در دسترس است.' });
    }
    if (!state.latest) return json(res, 200, { generated_at: null, assets: [], news: [], analysis: '', sources: {} });
    const { received_at, event_id, server_received_at, ...publicSnapshot } = state.latest;
    return json(res, 200, publicSnapshot);
  }
  return serveStatic(req, res, pathname);
});

await loadState();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mahan Market Agent running on 0.0.0.0:${PORT}`);
  console.log(`Persistent data file: ${STATE_FILE}`);
});

function shutdown(signal) {
  console.log(`${signal} received; closing HTTP server.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
