# Mahan Market Agent | نسخهٔ Railway

این پروژه با نام **Mahan Market Agent** برای اجرا به‌عنوان سرویس Node.js روی Railway آماده شده است. ورود کاربران و پنل مدیریت از Supabase Auth استفاده می‌کند؛ نام ریپازیتوری mahan-dollar-agent عمداً حفظ شده است. معماری **Push** است: پس از آماده‌شدن تحلیل، n8n خودش با `POST /api/publish` داده را به سایت می‌فرستد. سایت فقط دادهٔ تأییدشده را ذخیره و در داشبورد نمایش می‌دهد؛ تحلیل هوش مصنوعی داخل سایت انجام نمی‌شود.

## اجزای پروژه

- `server.mjs`: سرور سایت، API دریافت داده، بررسی نشست Supabase، نقش‌های مدیر و کنترل امن ورک‌فلو.
- `public/`: HTML، CSS، SVG لوگو و JavaScript عمومی سایت. فقط کلید عمومی Supabase در مرورگر مصرف می‌شود؛ کلیدهای محرمانه در فرانت‌اند قرار نمی‌گیرند.
- `.env.example`: نمونهٔ متغیرهای محیطی برای توسعهٔ محلی؛ مقادیر واقعی را وارد Git نکن.
- `n8n/Code-Prepare-Signed-Push.js`: کد آماده‌سازی بسته‌ای که n8n ارسال می‌کند.
- `scripts/send-test.mjs`: ارسال بستهٔ آزمایشی با امضای معتبر.
- `scripts/generate-secret.mjs`: تولید کلید تصادفی قوی.
- `railway.json`: فرمان شروع و Health Check مخصوص Railway.

## امنیت API

1. امضای درخواست با HMAC-SHA256 و یک کلید مخفی تصادفی مشترک بین n8n و سرور.
2. محدودیت اعتبار زمانی امضا؛ درخواست قدیمی رد می‌شود.
3. شناسهٔ یکتای رویداد و رد ارسال دوبارهٔ همان رویداد، حتی بعد از راه‌اندازی مجدد سرور.
4. مقایسهٔ امضا با `timingSafeEqual`.
5. محدودیت بدنهٔ درخواست، بررسی ساختار JSON و محدودکنندهٔ سادهٔ نرخ درخواست.
6. کلید فقط در متغیر محیطی سرور و Credential مربوط در n8n نگه داشته می‌شود.

`GET /api/market` عمداً عمومی و فقط‌خواندنی است تا مرورگر بتواند داشبورد عمومی را نمایش دهد. مسیر تغییر داده یعنی `POST /api/publish` فقط درخواست امضاشده را می‌پذیرد. امضا ثابت نمی‌کند یک خبر از نظر واقعی‌بودن درست است؛ فقط نشان می‌دهد بسته را دارندهٔ کلید مورد اعتماد فرستاده است.


## ورود کاربران و کنترل دسترسی مدیر

### روش‌های ورود پشتیبانی‌شده

صفحهٔ ورود شامل Google، Microsoft، Apple، GitHub، کد یک‌بارمصرف ایمیل و کد پیامک است. این گزینه‌ها از طریق Supabase Auth کار می‌کنند. فعال‌کردن هر ارائه‌دهنده در Supabase و ساخت Client ID/Secret از سوی مالک حساب لازم است؛ کد سایت به‌تنهایی نمی‌تواند حساب OAuth یا سرویس پیامک ایجاد کند.

1. در Supabase یک پروژه بساز و از بخش Project Settings مقدار Project URL و کلید عمومی anon/publishable را بردار.
2. در Authentication → URL Configuration آدرس Railway و http://localhost:3000 را به فهرست Redirect URLs اضافه کن. آدرس callback پایه برای این برنامه همان دامنه است.
3. در Authentication → Providers، ارائه‌دهندگان Google، Azure (Microsoft)، Apple و GitHub را فعال کن و Client ID/Secret رسمی هرکدام را وارد کن. مستندات: https://supabase.com/docs/guides/auth/social-login
4. برای کد ایمیل، در قالب ایمیل Supabase از متغیر {{ .Token }} استفاده کن تا پیام شامل کد یک‌بارمصرف باشد؛ لینک پیش‌فرض به‌تنهایی فرم ورود کد را کامل نمی‌کند. مستندات: https://supabase.com/docs/guides/auth/auth-email-passwordless
5. برای ورود تلفنی، SMS provider و قالب پیامک را در Supabase تنظیم کن. تحویل پیامک نیازمند سرویس پیامک و اعتبار آن است. مستندات: https://supabase.com/docs/guides/auth/phone-login

### نقش‌ها

- مدیر اصلی از متغیر ADMIN_EMAIL تعیین می‌شود؛ پیش‌فرض آن mahaneli1394@gmail.com است. ورود باید به ایمیل تأییدشده منتهی شود.
- فقط مدیر اصلی اجازهٔ افزودن یا حذف ایمیل مدیران دیگر را دارد.
- مدیران اضافی هم باید با همان ایمیل تأییدشده وارد شوند؛ صرف داشتن حساب Supabase دسترسی مدیریتی نمی‌دهد.
- بخش وضعیت API، زمان آخرین ارسال و کنترل ورک‌فلو پشت بررسی نشست و نقش مدیر قرار دارد. کلیدها و توکن‌های سرویس در پاسخ API یا رابط کاربری نمایش داده نمی‌شوند.
- مسیر GET /api/market عمومی و فقط‌خواندنی باقی می‌ماند تا داشبورد بازار برای بازدیدکنندگان کار کند. مسیر انتشار POST /api/publish فقط Push معتبر با HMAC را می‌پذیرد.
- مالکیت سرویس Supabase، تنظیمات ارائه‌دهندگان OAuth، SMS و Railway همچنان در پنل‌های خودشان مدیریت می‌شود؛ سایت جایگزین مدیریت Railway نیست.

### تنظیمات محیطی احراز هویت و کنترل n8n

در Railway → Service → Variables این موارد را تنظیم کن:

| نام | مقدار |
|---|---|
| ADMIN_EMAIL | mahaneli1394@gmail.com |
| SUPABASE_URL | Project URL پروژهٔ Supabase |
| SUPABASE_ANON_KEY | کلید عمومی anon/publishable پروژهٔ Supabase |
| N8N_API_BASE_URL | آدرس پایهٔ n8n برای کنترل واقعی Workflow |
| N8N_API_KEY | کلید API با scopeهای workflow:read و workflow:activate |
| N8N_WORKFLOW_ID | شناسهٔ Workflow قابل‌کنترل |

متغیرهای N8N_API_BASE_URL، N8N_API_KEY و N8N_WORKFLOW_ID برای کنترل واقعی Workflow لازم‌اند. اگر تنظیم نشده باشند، پنل به‌جای وانمودکردن به موفقیت، وضعیت «تنظیم نشده» نشان می‌دهد. در n8n کلید API با کمترین دسترسی لازم بساز؛ مستند رسمی: https://docs.n8n.io/api/authentication/

کلید عمومی Supabase برای استفاده در مرورگر طراحی شده است؛ اما service_role، کلید مدیریت n8n، کلید HMAC و کلیدهای OAuth باید محرمانه بمانند. هرگز این مقادیر را داخل فایل‌های public/ یا Git قرار نده.
## تست محلی در ویندوز

نیاز به Node.js نسخهٔ ۲۰٫۶ یا جدیدتر است.

1. پوشه را از ZIP استخراج کن.
2. در File Explorer وارد پوشه شو، روی نوار آدرس کلیک کن، `powershell` بنویس و Enter بزن.
3. این دستور را اجرا کن تا فایل تنظیمات محلی ساخته شود:

   ```powershell
   Copy-Item .env.example .env
   ```

4. کلید امن بساز:

   ```powershell
   npm run new-secret
   ```

   رشتهٔ خروجی را در فایل `.env`، روبه‌روی `N8N_PUSH_SECRET=` قرار بده. مقدار نمونه را جایگزین کن. کلید واقعی را در GitHub یا کدهای عمومی قرار نده.

5. سرور را اجرا کن:

   ```powershell
   npm run dev
   ```

6. در مرورگر باز کن: `http://localhost:3000`
7. برای تست در یک پنجرهٔ PowerShell دیگر که در همین پوشه باز شده است، اجرا کن:

   ```powershell
   npm run test:push
   ```

8. صفحهٔ سایت را Refresh کن. باید دارایی و خبر آزمایشی را ببینی. این اطلاعات ساختگی‌اند و قیمت واقعی بازار نیستند. API خواندنی در `http://localhost:3000/api/market` و Health Check در `http://localhost:3000/health` است.

اطلاعات لوکال در پوشهٔ `.local-data` ذخیره می‌شود. اگر آن پوشه را حذف کنی، تاریخچه و آخرین خروجی پاک می‌شود.

## انتشار روی Railway

### روش پیشنهادی: اتصال GitHub

1. ZIP پروژه را استخراج کن.
2. یک مخزن جدید در GitHub بساز و همهٔ فایل‌های داخل پوشهٔ استخراج‌شده را در ریشهٔ مخزن قرار بده. فایل `.env` و پوشهٔ `.local-data` را آپلود نکن؛ این‌ها فقط برای تست محلی‌اند.
3. وارد [Railway](https://railway.com/) شو و یک Project بساز.
4. در Railway گزینهٔ ساخت سرویس از GitHub Repository را انتخاب و مخزن پروژه را متصل کن.
5. `railway.json` فرمان `npm start` و مسیر Health Check را مشخص کرده است؛ نیازی به فرمان شروع سفارشی نیست مگر اینکه تنظیمات را خودت تغییر داده باشی.
6. در تنظیمات سرویس، بخش Variables، این متغیرها را اضافه کن:

   | نام | مقدار |
   |---|---|
   | `ADMIN_EMAIL` | `mahaneli1394@gmail.com` |
   | `SUPABASE_URL` | Project URL پروژهٔ Supabase |
   | `SUPABASE_ANON_KEY` | کلید عمومی anon/publishable پروژهٔ Supabase |
   | `N8N_API_BASE_URL` | آدرس پایهٔ n8n برای کنترل واقعی Workflow |
   | `N8N_API_KEY` | API key با scopeهای `workflow:read` و `workflow:activate` |
   | `N8N_WORKFLOW_ID` | شناسهٔ Workflow قابل‌کنترل |
   | `N8N_PUSH_SECRET` | کلید تصادفی جدید با حداقل ۳۲ بایت |
   | `N8N_MAX_CLOCK_SKEW_SECONDS` | `300` |
   | `DATA_DIR` | `/data` |

   در Railway، `PORT` را خودت تنظیم نکن؛ Railway آن را برای سرویس فراهم می‌کند.

7. **ذخیره‌سازی پایدار:** از بخش Volumes یک Volume به همین سرویس وصل کن و Mount Path را دقیقاً `/data` بگذار. مقدار `DATA_DIR=/data` باید با همین مسیر منطبق باشد. بدون Volume، فایل‌ها روی دیسک موقت سرویس ممکن است با انتشار مجدد از بین بروند.
8. Deploy را اجرا کن. پس از موفقیت، در Networking دامنهٔ عمومی Railway را بساز.
9. آدرس `https://YOUR-DOMAIN/health` را باز کن؛ باید JSON با `"ok":true` بگیری. سایت روی خود دامنه و API خواندنی در `/api/market` در دسترس است.

### روش جایگزین: ارسال مستقیم از پوشه با Railway CLI

اگر نمی‌خواهی GitHub را متصل کنی، ابتدا در پنل Railway یک Project و یک Empty Service بساز. سپس در PowerShell این دستورات را اجرا کن:

```powershell
npm install -g @railway/cli
railway login
railway link
railway up
```

در مرحلهٔ `railway link` همان Project و Service را انتخاب کن. بعد متغیرها، Volume و دامنه را طبق مراحل بالا تنظیم کن.

برای نسخهٔ فایل‌محور این پروژه، فقط **یک Replica** اجرا کن تا همهٔ درخواست‌ها به همان فایل داده و فهرست رویدادهای دریافت‌شده دسترسی داشته باشند.

## اتصال n8n به سایت Railway

### ۱. کلید مشترک

یک کلید تصادفی برای Railway بساز؛ بهتر است دستور `npm run new-secret` را در پوشهٔ پروژه اجرا کنی و مقدار تازه را کپی کنی. همان مقدار را در متغیر Railway به نام `N8N_PUSH_SECRET` و در Credential مربوط به HMAC در n8n قرار بده. در محیط production از کلید تست محلی دوباره استفاده نکن.

### ۲. ترتیب نودها

به انتهای Workflow که تحلیل نهایی را تولید می‌کند این نودها را اضافه کن:

1. **Code** با نام دلخواه، مثلاً `Prepare Signed Push`. محتوای فایل `n8n/Code-Prepare-Signed-Push.js` را در آن قرار بده. عبارت `$('Code in JavaScript1')` باید دقیقاً با نام نود نرمال‌سازی داده‌های بازار در Workflow تو هماهنگ باشد.
2. **Crypto** بعد از Code:
   - Action: `Hmac`
   - Type: `SHA256`
   - Value: `{{$json.signingString}}`
   - Property Name: `signature`
   - Encoding: `HEX`
   - Hmac Secret: همان مقدار `N8N_PUSH_SECRET`، داخل Credential و نه به‌شکل متن در کد.
3. **HTTP Request** بعد از Crypto:
   - Method: `POST`
   - URL: `https://YOUR-DOMAIN/api/publish`
   - Send Body: روشن
   - Body Content Type: `Raw`
   - Content-Type: `application/json`
   - Body: `{{$json.bodyString}}`
   - Header `X-Mahan-Timestamp`: `{{$json.timestamp}}`
   - Header `X-Mahan-Event-Id`: `{{$json.eventId}}`
   - Header `X-Mahan-Signature`: `{{$json.signature}}`

**بدنه باید به‌صورت Raw و بدون JSON.stringify یا قالب‌بندی مجدد ارسال شود.** امضا دقیقاً روی بدنهٔ خام ساخته می‌شود؛ تغییر حتی یک فاصله، امضا را نامعتبر می‌کند. در صورت موفقیت، پاسخ API شامل `"ok":true` خواهد بود. تکرار همان شناسه رویداد پاسخ `409` می‌گیرد که رفتار امنیتی مورد انتظار است.

### آدرس برای تست محلی n8n

اگر n8n روی همان ویندوز اجرا می‌شود، موقتاً URL را به `http://localhost:3000/api/publish` تغییر بده. اگر n8n داخل Docker یا روی دستگاه دیگری است، `localhost` لزوماً به رایانهٔ میزبان اشاره نمی‌کند؛ آدرس شبکهٔ مناسب باید تنظیم شود.

## قالب داده

API بسته‌هایی با فیلدهایی مانند این‌ها را می‌پذیرد:

```json
{
  "generated_at": "2026-10-19T12:30:00.000Z",
  "assets": [
    {
      "symbol": "USD-IRR",
      "name": "دلار آزاد",
      "price": 1085000,
      "unit": "تومان",
      "change_percent": 0.7
    }
  ],
  "news": [],
  "analysis": "متن تحلیل نهایی تولیدشده در n8n",
  "sources": { "tgju": true, "newsapi": true }
}
```

این JSON نمونه است و قیمت واقعی نیست. با هر Push معتبر، سرور آخرین بسته را ذخیره می‌کند و تا ۵۰۰ نقطهٔ تاریخچه برای هر دارایی نگه می‌دارد. برای افزودن ارز، کافی است دارایی جدیدی با `symbol` یکتا و قیمت در آرایهٔ `assets` بفرستی.

## مسیرهای API

- `GET /health`: وضعیت آماده‌به‌کار سرور برای Railway.
- `GET /api/market`: خواندن آخرین بستهٔ ذخیره‌شده برای داشبورد.
- `GET /api/auth/config`: فقط تنظیمات عمومی Supabase را به فرانت‌اند می‌دهد؛ هیچ کلید مدیریتی‌ای برنمی‌گرداند.
- `GET /api/auth/me`: هویت و نقش نشست فعلی را از سمت سرور بررسی می‌کند.
- `/api/admin/overview`, `/api/admin/workflow`, `/api/admin/admins`: مسیرهای مدیریت که فقط مدیران تأییدشده به آن‌ها دسترسی دارند؛ افزودن/حذف مدیر فقط برای مالک اصلی ممکن است.
- `POST /api/publish`: انتشار بستهٔ جدید، فقط با سه هدر امضا‌شده.

کلید API سرویس‌های خبر، توکن Telegram یا `N8N_PUSH_SECRET` را داخل `public/` یا کد فرانت‌اند قرار نده. اگر کلیدهای Workflow قبلی جایی عمومی شده‌اند، آن‌ها را rotate کن.
