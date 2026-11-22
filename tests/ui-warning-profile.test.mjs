import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'public/index.html'), 'utf8');
const script = readFileSync(path.join(root, 'public/assets/app.js'), 'utf8');
const css = readFileSync(path.join(root, 'public/assets/style.css'), 'utf8');

test('profile coming soon is visible, disabled and cannot be opened', () => {
  assert.match(html, /class="nav-link nav-link-disabled" id="profile-nav" role="link" aria-disabled="true"/);
  assert.match(html, /پروفایل \(به‌زودی\)<\/span>/);
  assert.doesNotMatch(html, /id="profile-nav"[^>]*href=/);
  assert.doesNotMatch(html, /id="profile-nav"[^>]*data-view=/);
  assert.match(html, /class="view hidden" id="view-profile" aria-hidden="true" inert/);
  assert.match(html, /id="profile-username"[^>]*disabled/);
  assert.match(script, /if \(view === "profile"\) return/);
  assert.doesNotMatch(script, /\["dashboard","settings","profile"/);
  assert.match(css, /\.nav-link\.nav-link-disabled[^\n]*pointer-events:none/);
});

test('warning is easily distinguishable in light mode', () => {
  assert.match(css, /body\[data-theme-mode="light"\] \.prediction-warning\{background:#37131e;border:2px solid #c02949;color:#fff0f2/);
  assert.match(css, /body\[data-theme-mode="light"\] \.prediction-warning strong\{color:#ffc5cc\}/);
  assert.match(html, /prediction-warning" role="alert"/);
});

test('existing refresh button is preserved', () => {
  assert.match(html, /id="refresh-btn" class="button button-outline">↻ بروزرسانی<\/button>/);
  assert.match(script, /\$\("#refresh-btn"\)\.addEventListener\("click", refresh\)/);
});

test('updated JS and CSS are requested with fresh asset versions', () => {
  assert.match(html, /\/assets\/style\.css\?v=20261122-profile-disabled/);
  assert.match(html, /\/assets\/app\.js\?v=20261122-profile-disabled/);
});
