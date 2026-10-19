import { createHmac, randomUUID } from 'node:crypto';

const baseUrl = (process.env.SITE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const secret = process.env.N8N_PUSH_SECRET || '';
if (Buffer.byteLength(secret, 'utf8') < 32) {
  console.error('N8N_PUSH_SECRET داخل فایل .env باید حداقل ۳۲ بایت باشد.');
  process.exit(1);
}

const now = new Date();
const payload = {
  generated_at: now.toISOString(),
  assets: [{ symbol: 'USD-IRR-DEMO', name: 'دلار آزمایشی', price: 1085000, unit: 'تومان', change_percent: 0.7 }],
  news: [{ title: 'خبر آزمایشی برای بررسی امنیت و نمایش سایت', source: 'LOCAL TEST', published_at: now.toISOString(), description: 'این خبر ساختگی و صرفاً برای تست محلی است.' }],
  analysis: 'این یک تحلیل آزمایشی است و دادهٔ واقعی بازار نیست.',
  sources: { local_test: true }
};
const body = JSON.stringify(payload);
const timestamp = String(Math.floor(Date.now() / 1000));
const eventId = randomUUID();
const signature = createHmac('sha256', secret).update(`${timestamp}.${eventId}.${body}`, 'utf8').digest('hex');
try {
  const response = await fetch(`${baseUrl}/api/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mahan-Timestamp': timestamp, 'X-Mahan-Event-Id': eventId, 'X-Mahan-Signature': signature },
    body
  });
  const responseBody = await response.text();
  console.log(`HTTP ${response.status}\n${responseBody}`);
  if (!response.ok) process.exitCode = 1;
} catch (error) {
  console.error(`ارسال آزمایشی ناموفق بود: ${error.message}`);
  console.error('بررسی کن npm start در حال اجرا باشد و SITE_BASE_URL درست باشد.');
  process.exitCode = 1;
}
