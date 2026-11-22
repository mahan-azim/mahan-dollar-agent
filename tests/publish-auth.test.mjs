import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testSecret = 'integration-test-only-secret-0123456789-abcdefghijklmnopqrstuvwxyz';

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise(resolve => server.close(resolve));
  return address.port;
}

async function waitForReady(url, child, getLogs) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Test server stopped: ' + getLogs());
    try {
      const response = await fetch(url + '/api/auth/config', { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch { /* Server has not started yet. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Test server did not start: ' + getLogs());
}

test('invalid requests cannot consume the authenticated publisher rate limit', { timeout: 30000 }, async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mahan-api-test-'));
  const port = await freePort();
  const baseUrl = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      N8N_PUSH_SECRET: testSecret
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  const body = JSON.stringify({ analysis: 'local integration test, not market data' });

  try {
    await waitForReady(baseUrl, child, () => logs);

    // More than the global 120/minute cap. Wrong credentials must return 401, not 429.
    for (let i = 0; i < 125; i += 1) {
      const response = await fetch(baseUrl + '/api/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'wrong-test-key' },
        body
      });
      assert.equal(response.status, 401, 'Invalid request #' + (i + 1) + ' must be rejected without throttling');
      await response.arrayBuffer();
    }

    const keyResponse = await fetch(baseUrl + '/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': testSecret },
      body
    });
    assert.equal(keyResponse.status, 200, 'Valid API key should retain access after invalid traffic');
    await keyResponse.arrayBuffer();

    const timestamp = String(Math.floor(Date.now() / 1000));
    const eventId = randomUUID();
    const signature = createHmac('sha256', testSecret).update(timestamp + '.' + eventId + '.' + body, 'utf8').digest('hex');
    const signedResponse = await fetch(baseUrl + '/api/publish', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mahan-timestamp': timestamp,
        'x-mahan-event-id': eventId,
        'x-mahan-signature': signature
      },
      body
    });
    assert.equal(signedResponse.status, 200, 'Valid HMAC signature should remain supported');
    await signedResponse.arrayBuffer();
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});
