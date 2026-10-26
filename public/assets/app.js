(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const state = { payload: null, chart: null, selectedAsset: "", authClient: null, authConfigured: false, currentUser: null, isAdmin: false, isOwner: false, otpTarget: null, workflowEnabled: null };

  const themeSettings = { mode: "dark", color: "#00ffc4" };
  const themeStorageKey = "mahan-market-agent-theme";
  function normalizeHexColor(value) {
    const raw = String(value ?? "").trim();
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return "";
    return raw.length === 4 ? "#" + [...raw.slice(1)].map(ch => ch + ch).join("").toLowerCase() : raw.toLowerCase();
  }
  function hexToRgba(hex, alpha = 0.12) {
    const color = normalizeHexColor(hex) || "#00ffc4";
    const number = Number.parseInt(color.slice(1), 16);
    const red = (number >> 16) & 255, green = (number >> 8) & 255, blue = number & 255;
    return `rgba(${red},${green},${blue},${alpha})`;
  }
  function setThemeMessage(message, kind = "") {
    const node = $("#theme-settings-message");
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = kind;
  }
  function applyThemeSettings(persist = true) {
    document.body.dataset.themeMode = themeSettings.mode;
    document.documentElement.style.setProperty("--cyan", themeSettings.color);
    document.documentElement.style.setProperty("--theme-accent", themeSettings.color);
    const isLight = themeSettings.mode === "light";
    const toggle = $("#theme-mode-toggle");
    if (toggle) toggle.checked = isLight;
    const title = $("#theme-mode-title");
    const description = $("#theme-mode-description");
    const badge = $("#theme-mode-badge");
    if (title) title.textContent = isLight ? "حالت روشن" : "حالت تاریک";
    if (description) description.textContent = isLight ? "پس‌زمینهٔ روشن برای محیط‌های پرنور" : "پس‌زمینهٔ تیره برای استفاده در محیط کم‌نور";
    if (badge) badge.textContent = isLight ? "حالت روشن" : "حالت تاریک";
    const input = $("#custom-theme-color");
    if (input) input.value = themeSettings.color.toUpperCase();
    const preview = $("#custom-color-preview");
    if (preview) preview.style.backgroundColor = themeSettings.color;
    document.querySelectorAll("[data-theme-color]").forEach(button => {
      const active = normalizeHexColor(button.dataset.themeColor) === themeSettings.color;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.content = isLight ? "#f4f8fb" : "#07111b";
    if (persist) {
      try { localStorage.setItem(themeStorageKey, JSON.stringify(themeSettings)); } catch (error) { console.warn("Theme preferences could not be saved:", error); }
    }
    if (state.chart && state.payload) {
      const index = Number(state.selectedAsset);
      renderChart(state.payload.assets?.[index] || null);
    }
  }
  function initializeThemeSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(themeStorageKey) || "{}");
      themeSettings.mode = saved.mode === "light" ? "light" : "dark";
      themeSettings.color = normalizeHexColor(saved.color) || "#00ffc4";
    } catch (_) {
      themeSettings.mode = "dark";
      themeSettings.color = "#00ffc4";
    }
    applyThemeSettings(false);
    $("#theme-mode-toggle")?.addEventListener("change", event => {
      themeSettings.mode = event.currentTarget.checked ? "light" : "dark";
      applyThemeSettings();
      setThemeMessage(themeSettings.mode === "light" ? "حالت روشن فعال شد." : "حالت تاریک فعال شد.");
    });
    document.querySelectorAll("[data-theme-color]").forEach(button => button.addEventListener("click", () => {
      themeSettings.color = normalizeHexColor(button.dataset.themeColor) || "#00ffc4";
      applyThemeSettings();
      setThemeMessage("رنگ اصلی سایت تغییر کرد.");
    }));
    $("#custom-theme-color")?.addEventListener("input", event => {
      const color = normalizeHexColor(event.currentTarget.value);
      const preview = $("#custom-color-preview");
      if (preview) {
        preview.style.backgroundColor = color || "transparent";
        preview.classList.toggle("invalid", !color);
      }
    });
    $("#theme-color-apply")?.addEventListener("click", () => {
      const color = normalizeHexColor($("#custom-theme-color")?.value);
      if (!color) {
        setThemeMessage("کد رنگ معتبر نیست. نمونهٔ درست: #00FFC4", "error");
        $("#custom-theme-color")?.focus();
        return;
      }
      themeSettings.color = color;
      applyThemeSettings();
      setThemeMessage("رنگ سفارشی با موفقیت اعمال شد.");
    });
  }
  initializeThemeSettings();
  const money = (value) => {
    if (value === null || value === undefined || value === "") return "—";
    const n = Number(String(value).replaceAll(",", ""));
    return Number.isFinite(n) ? new Intl.NumberFormat("fa-IR", {maximumFractionDigits: 4}).format(n) : String(value);
  };
  const safeText = (value, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);
  const pick = (obj, keys, fallback = null) => {
    for (const key of keys) if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
    return fallback;
  };
  function normalize(raw) {
    // Contract پیشنهادی API: {generated_at, assets:[...], news:[...], analysis, sources}
    // این بخش چند نام فیلد رایج را می‌پذیرد؛ تحلیل در مرورگر انجام نمی‌شود.
    const data = raw?.data && !Array.isArray(raw.data) ? {...raw, ...raw.data} : raw || {};
    let assets = pick(data, ["assets", "currencies", "prices"], []);
    if (!Array.isArray(assets)) {
      const p = assets || {};
      assets = Object.entries(p).map(([symbol, value]) => typeof value === "object" ? {symbol, ...value} : {symbol, price:value});
    }
    assets = assets.map((a) => ({
      symbol: safeText(pick(a, ["symbol", "slug", "code", "id"]), "—"),
      name: safeText(pick(a, ["name", "title", "label"]), pick(a, ["symbol", "slug", "code"], "دارایی")),
      price: pick(a, ["price", "value", "last", "last_price"]),
      unit: safeText(pick(a, ["unit", "currency_unit"]), ""),
      change: pick(a, ["change_percent", "change", "percent_change", "changePercentage"]),
      history: Array.isArray(a.history) ? a.history : Array.isArray(a.spark) ? a.spark : []
    }));
    let forecasts = pick(data, ["forecasts", "predictions", "forecast", "price_predictions"], []);
    if (!Array.isArray(forecasts)) forecasts = [];
    forecasts = forecasts.map(f => ({
      name: safeText(pick(f, ["name", "asset_name", "title", "symbol", "asset"]), "—"),
      past: pick(f, ["past_price", "previous_price", "price_past", "price_before"]),
      current: pick(f, ["current_price", "price", "latest_price"]),
      predicted: pick(f, ["predicted_price", "forecast_price", "price_prediction", "target_price"]),
      priority: safeText(pick(f, ["priority", "market_impact", "impact", "importance"]), "—")
    }));
    let news = pick(data, ["news", "articles", "latest_news"], []);
    if (!Array.isArray(news)) news = [];
    news = news.map(n => ({
      title: safeText(pick(n, ["title", "headline"]), "خبر بدون عنوان"),
      url: pick(n, ["url", "link"]),
      source: safeText(pick(n, ["source", "publisher"]), "منبع نامشخص"),
      published_at: pick(n, ["published_at", "publishedAt", "published", "time_published"]),
      description: pick(n, ["description", "summary", "snippet"])
    }));
    let analysis = pick(data, ["analysis", "output", "report", "ai_analysis"], "");
    if (analysis && typeof analysis === "object") analysis = pick(analysis, ["output", "text", "content"], JSON.stringify(analysis, null, 2));
    return {generated_at: pick(data, ["generated_at", "updated_at", "timestamp"]), assets, forecasts, news, analysis: String(analysis || ""), sources: data.sources || data.source_status || {}};
  }
  function dateText(value) {
    if (!value) return "زمان نامشخص";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("fa-IR");
  }
  function changeClass(v) {
    const n = Number(v);
    return !Number.isFinite(n) || n === 0 ? "neutral" : n > 0 ? "positive" : "negative";
  }
  function changeText(v) {
    if (v === null || v === undefined || v === "") return "بدون داده تغییر";
    const n = Number(v);
    return Number.isFinite(n) ? `${n > 0 ? "+" : ""}${new Intl.NumberFormat("fa-IR",{maximumFractionDigits:2}).format(n)}٪` : String(v);
  }
  function assetRow(a) {
    return `<div class="asset-row"><div><div class="asset-name">${escapeHtml(a.name)}</div><span class="asset-symbol">${escapeHtml(a.symbol)}</span></div><div><div class="asset-price">${escapeHtml(money(a.price))} ${escapeHtml(a.unit)}</div><div class="asset-change ${changeClass(a.change)}">${escapeHtml(changeText(a.change))}</div></div></div>`;
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function renderNews(items, limit = Infinity) {
    const subset = items.slice(0, limit);
    if (!subset.length) return '<div class="empty-state">خبری از API دریافت نشده است.</div>';
    return subset.map(n => `<article class="news-item"><a ${n.url ? `href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer"` : ""}>${escapeHtml(n.title)}</a>${n.description ? `<div class="news-meta">${escapeHtml(n.description)}</div>` : ""}<div class="news-meta"><span>${escapeHtml(n.source)}</span><span>${escapeHtml(dateText(n.published_at))}</span></div></article>`).join("");
  }
  function renderAssets(assets) {
    if (!assets.length) return '<div class="empty-state">دارایی‌ای از API دریافت نشده است.</div>';
    return assets.map(assetRow).join("");
  }
  function renderChart(asset) {
    const canvas = $("#price-chart");
    const empty = $("#chart-empty");
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    const points = asset?.history || [];
    const parsed = points.map((p, i) => typeof p === "number" ? {label:String(i + 1), value:p} :
      Array.isArray(p) ? {label:String(p[0] ?? i + 1), value:Number(p[1])} :
      {label:String(p.time ?? p.timestamp ?? p.date ?? i + 1), value:Number(p.price ?? p.value)}).filter(p => Number.isFinite(p.value));
    if (!asset || parsed.length < 2 || typeof Chart === "undefined") {
      canvas.classList.add("hidden"); empty.classList.remove("hidden"); return;
    }
    canvas.classList.remove("hidden"); empty.classList.add("hidden");
    state.chart = new Chart(canvas, {type:"line", data:{labels:parsed.map(p=>p.label),datasets:[{label:asset.name,data:parsed.map(p=>p.value),borderColor:themeSettings.color,backgroundColor:hexToRgba(themeSettings.color,0.12),fill:true,tension:.3,pointRadius:1.5,borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#8299a8",maxTicksLimit:6},grid:{color:"rgba(130,153,168,.08)"}},y:{ticks:{color:"#8299a8"},grid:{color:"rgba(130,153,168,.1)"}}}}});
  }
  function render(raw) {
    const d = normalize(raw); state.payload = d;
    $("#connection-label").textContent = "نمایش داده‌های بازار";
    $(".status-dot").style.background = "var(--cyan)";
    $("#last-updated").textContent = "آخرین به‌روزرسانی: " + dateText(d.generated_at);
    $("#asset-count").textContent = money(d.assets.length);
    $("#news-count").textContent = money(d.news.length);
    $("#data-age").textContent = d.generated_at ? dateText(d.generated_at) : "—";
    $("#forecast-table").innerHTML = d.forecasts.length ? `<table><thead><tr><th>اسم</th><th>قیمت گذشته</th><th>قیمت فعلی</th><th>قیمت پیش‌بینی‌شده</th><th>اولویت تأثیر در بازار</th></tr></thead><tbody>${d.forecasts.map(f=>`<tr><td>${escapeHtml(f.name)}</td><td>${escapeHtml(f.past == null || f.past === "" ? "داده موجود نیست" : money(f.past))}</td><td>${escapeHtml(f.current == null || f.current === "" ? "داده موجود نیست" : money(f.current))}</td><td>${escapeHtml(f.predicted == null || f.predicted === "" ? "داده موجود نیست" : money(f.predicted))}</td><td>${escapeHtml(f.priority || "داده موجود نیست")}</td></tr>`).join("")}</tbody></table>` : '<div class="empty-state">هنوز پیش‌بینی ساختاریافته‌ای از n8n دریافت نشده است.</div>';
    $("#latest-news").innerHTML = renderNews(d.news, 4);
    $("#all-news").innerHTML = renderNews(d.news);
    $("#analysis-output").textContent = d.analysis || "تحلیلی در پاسخ API وجود ندارد. فیلد analysis یا output را به پاسخ اضافه کنید.";
    $("#analysis-output").classList.toggle("empty-state", !d.analysis);
    $("#analysis-time").textContent = dateText(d.generated_at);
    const sources = Object.entries(d.sources);
    $("#sources-list").innerHTML = sources.length ? sources.map(([k,v])=>`<span class="source-chip">${escapeHtml(k)}: ${escapeHtml(typeof v === "boolean" ? (v ? "فعال" : "غیرفعال") : typeof v === "object" ? JSON.stringify(v) : v)}</span>`).join("") : "اطلاعات منبع در دسترس نیست.";
    const select = $("#chart-asset");
    const previous = state.selectedAsset || select.value;
    select.innerHTML = '<option value="">انتخاب دارایی</option>' + d.assets.map((a,i)=>`<option value="${i}">${escapeHtml(a.name)} (${escapeHtml(a.symbol)})</option>`).join("");
    const selectedIndex = previous !== "" && Number(previous) < d.assets.length ? previous : (d.assets.length ? "0" : "");
    select.value = selectedIndex;
    state.selectedAsset = selectedIndex;
    renderChart(selectedIndex !== "" ? d.assets[Number(selectedIndex)] : null);
    $("#error-banner").classList.add("hidden");
    $("#demo-banner").classList.toggle("hidden", Boolean(d.generated_at || d.assets.length || d.news.length || d.analysis));
  }
  async function refresh() {
    const button = $("#refresh-btn"); button.disabled = true; button.textContent = "در حال دریافت…";
    try {
      const response = await fetch("/api/market", {headers:{"Accept":"application/json"}, cache:"no-store"});
      const data = await response.json().catch(()=>({error:"پاسخ API JSON معتبر نیست."}));
      if (!response.ok) throw new Error(data.error || `خطای API (${response.status})`);
      render(data);
    } catch (err) {
      $("#connection-label").textContent = "داده‌های بازار موقتاً در دسترس نیستند";
      $(".status-dot").style.background = "var(--red)";
      $("#error-banner").textContent = "در حال حاضر دریافت تازه‌ترین داده‌های بازار ممکن نیست. لطفاً کمی بعد دوباره امتحان کن.";
      $("#error-banner").classList.remove("hidden");
      $("#demo-banner").classList.remove("hidden");
    } finally { button.disabled = false; button.textContent = "↻ بروزرسانی"; }
  }

  function setAuthMessage(message, kind = "") {
    const box = $("#auth-message");
    if (!box) return;
    box.textContent = message || "";
    box.classList.toggle("hidden", !message);
    box.classList.toggle("notice-warn", kind === "warn");
    if (kind === "error") box.style.borderColor = "#623241";
    else box.style.borderColor = "";
  }

  function openAuth() {
    $("#auth-modal").classList.remove("hidden");
    $("#auth-modal").setAttribute("aria-hidden", "false");
    setAuthMessage(state.authConfigured ? "" : "ورود هنوز به سرویس احراز هویت وصل نشده است. مدیر سامانه باید متغیرهای SUPABASE_URL و SUPABASE_ANON_KEY را در Railway تنظیم کند.");
    if (state.currentUser) {
      $("#auth-signed-in").classList.remove("hidden");
      $("#auth-methods").classList.add("hidden");
      $("#auth-account-label").textContent = `واردشده با: ${state.currentUser.email || state.currentUser.phone || "حساب کاربری"}${state.isAdmin ? " · دسترسی مدیر" : " · دسترسی عادی"}`;
    } else {
      $("#auth-signed-in").classList.add("hidden");
      $("#auth-methods").classList.remove("hidden");
    }
  }

  function closeAuth() {
    $("#auth-modal").classList.add("hidden");
    $("#auth-modal").setAttribute("aria-hidden", "true");
  }

  function updateAdminVisibility() {
    document.querySelectorAll("[data-admin-only]").forEach(el => el.classList.toggle("hidden", !state.isAdmin));
    $("#view-admin").classList.toggle("hidden", !state.isAdmin);
    $("#auth-open").textContent = state.isAdmin ? "پنل مدیریت" : state.currentUser ? "حساب کاربری" : "ورود / پنل مدیریت";
    if (state.currentUser) {
      $("#auth-signed-in").classList.remove("hidden");
      $("#auth-methods").classList.add("hidden");
      $("#auth-account-label").textContent = `واردشده با: ${state.currentUser.email || state.currentUser.phone || "حساب کاربری"}${state.isAdmin ? " · دسترسی مدیر" : " · دسترسی عادی"}`;
    } else {
      $("#auth-signed-in").classList.add("hidden");
      $("#auth-methods").classList.remove("hidden");
    }
    if (state.isAdmin && location.hash === "#admin") {
      document.querySelector('[data-view="admin"]')?.click();
    } else if (!state.isAdmin && location.hash === "#admin") {
      history.replaceState(null, "", "#dashboard");
    }
  }

  function apiHeaders(session, extra = {}) {
    const headers = { Accept: "application/json", ...extra };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    return headers;
  }

  async function authApi(path, options = {}) {
    if (!state.authClient) throw new Error("احراز هویت تنظیم نشده است.");
    const { data } = await state.authClient.auth.getSession();
    if (!data?.session?.access_token) throw new Error("نشست معتبر نیست؛ دوباره وارد شو.");
    const headers = apiHeaders(data.session, options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers || {});
    const response = await fetch(path, { ...options, headers, cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `خطای سرور (${response.status})`);
    return body;
  }

  async function syncAuthSession(session) {
    if (!session || !state.authClient) {
      state.currentUser = null; state.isAdmin = false; state.isOwner = false;
      updateAdminVisibility();
      return;
    }
    try {
      const response = await fetch("/api/auth/me", { headers: apiHeaders(session), cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      state.currentUser = body.user || { email: session.user?.email || null, phone: session.user?.phone || null };
      state.isAdmin = response.ok && Boolean(body.isAdmin);
      state.isOwner = response.ok && Boolean(body.isOwner);
      updateAdminVisibility();
      if (state.isAdmin) await loadAdminPanel();
      if (state.currentUser && !state.isAdmin && !$("#auth-modal").classList.contains("hidden")) {
        setAuthMessage("ورود موفق بود، اما این حساب دسترسی مدیر ندارد. فقط مالک می‌تواند ایمیل حساب را به فهرست مدیران اضافه کند.", "warn");
      }
    } catch (error) {
      state.currentUser = { email: session.user?.email || null, phone: session.user?.phone || null };
      state.isAdmin = false; state.isOwner = false; updateAdminVisibility();
      console.warn("Could not resolve account role:", error.message);
    }
  }

  async function loadAuthConfig() {
    try {
      const response = await fetch("/api/auth/config", { cache: "no-store" });
      const config = await response.json();
      state.authConfigured = Boolean(config.configured && window.supabase?.createClient);
      if (!state.authConfigured) {
        document.querySelectorAll("[data-oauth], #email-otp-form button, #phone-otp-form button").forEach(el => { el.disabled = true; });
        setAuthMessage("ورود هنوز تنظیم نشده است. در Railway متغیرهای SUPABASE_URL و SUPABASE_ANON_KEY را تنظیم و در Supabase روش‌های ورود را فعال کن.");
        return;
      }
      state.authClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      state.authClient.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => { syncAuthSession(session); }, 0);
      });
      const { data, error } = await state.authClient.auth.getSession();
      if (error) throw error;
      await syncAuthSession(data?.session || null);
    } catch (error) {
      state.authConfigured = false;
      setAuthMessage("آماده‌سازی ورود ناموفق بود. تنظیمات احراز هویت در Railway و Supabase را بررسی کن.");
      console.warn("Auth startup failed:", error.message);
    }
  }

  async function submitOAuth(provider) {
    if (!state.authClient) return setAuthMessage("سرویس ورود هنوز تنظیم نشده است.", "warn");
    try {
      setAuthMessage("در حال انتقال به ارائه‌دهندهٔ ورود…");
      const options = { redirectTo: window.location.origin };
      if (provider === "azure") options.scopes = "email";
      const { error } = await state.authClient.auth.signInWithOAuth({ provider, options });
      if (error) throw error;
    } catch (error) {
      setAuthMessage(`ورود انجام نشد: ${error.message}`, "error");
    }
  }

  $("#email-otp-form").addEventListener("submit", async event => {
    event.preventDefault();
    const email = $("#auth-email").value.trim().toLowerCase();
    if (!state.authClient) return setAuthMessage("سرویس ورود هنوز تنظیم نشده است.", "warn");
    try {
      const { error } = await state.authClient.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw error;
      state.otpTarget = { kind: "email", value: email };
      $("#verify-otp-form").classList.remove("hidden");
      $("#email-otp-form").classList.add("hidden");
      $("#phone-otp-form").classList.add("hidden");
      $(".oauth-grid").classList.add("hidden");
      setAuthMessage(`کد ورود به ${email} ارسال شد. صندوق ورودی و پوشهٔ هرزنامه را بررسی کن.`);
      $("#auth-otp").focus();
    } catch (error) {
      setAuthMessage(`ارسال کد ایمیل ناموفق بود: ${error.message}`, "error");
    }
  });

  $("#phone-otp-form").addEventListener("submit", async event => {
    event.preventDefault();
    const phone = $("#auth-phone").value.trim();
    if (!state.authClient) return setAuthMessage("سرویس ورود هنوز تنظیم نشده است.", "warn");
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) return setAuthMessage("شماره را با کد کشور وارد کن؛ مانند +98912xxxxxxx.", "warn");
    try {
      const { error } = await state.authClient.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } });
      if (error) throw error;
      state.otpTarget = { kind: "phone", value: phone };
      $("#verify-otp-form").classList.remove("hidden");
      $("#email-otp-form").classList.add("hidden");
      $("#phone-otp-form").classList.add("hidden");
      $(".oauth-grid").classList.add("hidden");
      setAuthMessage(`کد ورود به شمارهٔ ${phone} ارسال شد.`);
      $("#auth-otp").focus();
    } catch (error) {
      setAuthMessage(`ارسال پیامک ناموفق بود: ${error.message}. تنظیمات ارائه‌دهندهٔ SMS را بررسی کن.`, "error");
    }
  });

  $("#verify-otp-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!state.authClient || !state.otpTarget) return setAuthMessage("ابتدا کد ایمیل یا پیامک را درخواست کن.", "warn");
    const token = $("#auth-otp").value.trim();
    try {
      const params = state.otpTarget.kind === "email"
        ? { email: state.otpTarget.value, token, type: "email" }
        : { phone: state.otpTarget.value, token, type: "sms" };
      const { data, error } = await state.authClient.auth.verifyOtp(params);
      if (error) throw error;
      state.otpTarget = null;
      $("#verify-otp-form").classList.add("hidden");
      $("#email-otp-form").classList.remove("hidden");
      $("#phone-otp-form").classList.remove("hidden");
      $(".oauth-grid").classList.remove("hidden");
      $("#auth-otp").value = "";
      setAuthMessage("ورود با موفقیت انجام شد.");
      await syncAuthSession(data.session);
    } catch (error) {
      setAuthMessage(`کد معتبر نیست یا منقضی شده است: ${error.message}`, "error");
    }
  });

  $("#auth-back").addEventListener("click", () => {
    state.otpTarget = null;
    $("#verify-otp-form").classList.add("hidden");
    $("#email-otp-form").classList.remove("hidden");
    $("#phone-otp-form").classList.remove("hidden");
    $(".oauth-grid").classList.remove("hidden");
    setAuthMessage("");
  });

  document.querySelectorAll("[data-oauth]").forEach(button => {
    button.addEventListener("click", () => submitOAuth(button.dataset.oauth));
  });

  $("#auth-open").addEventListener("click", () => {
    if (state.isAdmin) {
      document.querySelector('[data-view="admin"]')?.click();
      return;
    }
    openAuth();
  });
  $("#auth-close").addEventListener("click", closeAuth);
  $("#auth-dashboard").addEventListener("click", closeAuth);
  $("#auth-modal").addEventListener("click", event => { if (event.target === $("#auth-modal")) closeAuth(); });
  $("#auth-signout").addEventListener("click", async () => {
    if (!state.authClient) return;
    const { error } = await state.authClient.auth.signOut();
    if (error) setAuthMessage(`خروج ناموفق بود: ${error.message}`, "error");
    else { state.currentUser = null; state.isAdmin = false; state.isOwner = false; closeAuth(); updateAdminVisibility(); }
  });

  function setStatus(id, text, kind = "") {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove("positive", "negative", "neutral");
    if (kind) el.classList.add(kind);
  }

  async function loadAdminPanel() {
    if (!state.isAdmin || !state.authClient) return;
    try {
      const overview = await authApi("/api/admin/overview");
      setStatus("#admin-auth-status", overview.services.authenticationConfigured ? "تنظیم شده" : "نیازمند تنظیم", overview.services.authenticationConfigured ? "positive" : "negative");
      setStatus("#admin-api-status", overview.api.signingKeyConfigured ? "فعال" : "تنظیم نشده", overview.api.signingKeyConfigured ? "positive" : "negative");
      setStatus("#admin-data-status", overview.data.hasSnapshot ? "داده موجود است" : "بدون داده", overview.data.hasSnapshot ? "positive" : "neutral");
      $("#admin-data-detail").textContent = overview.data.hasSnapshot
        ? `${money(overview.data.assetCount)} دارایی · ${money(overview.data.newsCount)} خبر · ${dateText(overview.data.generatedAt)}`
        : "هنوز بسته‌ای از n8n دریافت نشده است.";
      $("#admin-api-detail").textContent = overview.api.lastReceivedAt
        ? `آخرین دریافت: ${dateText(overview.api.lastReceivedAt)}`
        : "هنوز درخواستی پذیرفته نشده است.";
      $("#admin-auth-detail").textContent = `حساب: ${overview.account.email || overview.account.phone || "نامشخص"}`;
      $("#admin-services").innerHTML = [
        [ "Supabase Auth", overview.services.authenticationConfigured ],
        [ "API مدیریت n8n", overview.services.n8nManagementConfigured ],
        [ "کلید امضای Push", overview.api.signingKeyConfigured ],
        [ "مسیر داده DATA_DIR", overview.services.persistentVolumeConfigured ]
      ].map(([label, ok]) => `<span class="source-chip ${ok ? "status-ok" : "status-warn"}">${escapeHtml(label)}: ${ok ? "تنظیم شده" : "تنظیم نشده"}</span>`).join("");
      state.isOwner = Boolean(overview.account.isOwner);
      $("#owner-admin-panel").classList.toggle("hidden", !state.isOwner);
      await loadWorkflowStatus();
      if (state.isOwner) await loadAdmins();
    } catch (error) {
      $("#admin-services").innerHTML = `<span class="source-chip status-error">${escapeHtml(error.message)}</span>`;
    }
  }

  async function loadWorkflowStatus() {
    try {
      const result = await authApi("/api/admin/workflow");
      state.workflowEnabled = result.active === null ? null : Boolean(result.active);
      if (!result.configured) {
        $("#workflow-badge").textContent = "اتصال تنظیم نشده";
        $("#workflow-badge").className = "source-chip status-warn";
        $("#workflow-help").textContent = "برای کنترل واقعی n8n، متغیرهای N8N_API_BASE_URL، N8N_API_KEY و N8N_WORKFLOW_ID را در Railway ثبت کن.";
        $("#workflow-toggle").disabled = true;
        $("#workflow-toggle").textContent = "نیازمند تنظیم API n8n";
        return;
      }
      if (result.available === false) {
        $("#workflow-badge").textContent = "دسترسی ناموفق";
        $("#workflow-badge").className = "source-chip status-error";
        $("#workflow-help").textContent = result.message || "وضعیت ورک‌فلو خوانده نشد.";
        $("#workflow-toggle").disabled = true;
        $("#workflow-toggle").textContent = "اتصال n8n را بررسی کن";
        return;
      }
      $("#workflow-badge").textContent = result.active ? "فعال" : "غیرفعال";
      $("#workflow-badge").className = `source-chip ${result.active ? "status-ok" : "status-warn"}`;
      $("#workflow-help").textContent = `${result.name || "n8n workflow"} · شناسه: ${result.id || "—"} · وضعیت از API واقعی n8n دریافت شده است.`;
      $("#workflow-toggle").disabled = false;
      $("#workflow-toggle").textContent = result.active ? "غیرفعال‌کردن ورک‌فلو" : "فعال‌کردن ورک‌فلو";
    } catch (error) {
      $("#workflow-badge").textContent = "خطا";
      $("#workflow-badge").className = "source-chip status-error";
      $("#workflow-help").textContent = error.message;
      $("#workflow-toggle").disabled = true;
      $("#workflow-toggle").textContent = "وضعیت نامشخص";
    }
  }

  async function loadAdmins() {
    try {
      const result = await authApi("/api/admin/admins");
      $("#admins-list").innerHTML = result.admins.map(admin => `
        <div class="admin-row">
          <div><div class="admin-row-email">${escapeHtml(admin.email)}</div><small>${admin.owner ? "مالک اصلی، قابل حذف نیست" : "مدیر مجاز"}</small></div>
          ${admin.owner ? "" : `<button type="button" class="admin-remove" data-remove-admin="${escapeHtml(admin.email)}">حذف دسترسی</button>`}
        </div>`).join("");
    } catch (error) {
      $("#admins-list").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }

  $("#admin-add-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!state.isOwner) return;
    const email = $("#admin-email-input").value.trim().toLowerCase();
    const box = $("#admin-action-message");
    try {
      const result = await authApi("/api/admin/admins", { method: "POST", body: JSON.stringify({ email }) });
      box.textContent = result.message || "مدیر اضافه شد.";
      box.classList.remove("hidden", "notice-warn");
      $("#admin-email-input").value = "";
      await loadAdmins();
    } catch (error) {
      box.textContent = error.message;
      box.classList.remove("hidden");
      box.classList.add("notice-warn");
    }
  });

  $("#admins-list").addEventListener("click", async event => {
    const button = event.target.closest("[data-remove-admin]");
    if (!button || !state.isOwner) return;
    const email = button.dataset.removeAdmin;
    if (!window.confirm(`دسترسی مدیریتی ${email} حذف شود؟`)) return;
    try {
      await authApi(`/api/admin/admins/${encodeURIComponent(email)}`, { method: "DELETE" });
      await loadAdmins();
    } catch (error) {
      const box = $("#admin-action-message");
      box.textContent = error.message;
      box.classList.remove("hidden");
      box.classList.add("notice-warn");
    }
  });

  $("#workflow-toggle").addEventListener("click", async () => {
    if (!state.isAdmin || state.workflowEnabled === null) return;
    const button = $("#workflow-toggle");
    button.disabled = true;
    try {
      await authApi("/api/admin/workflow", { method: "POST", body: JSON.stringify({ enabled: !state.workflowEnabled }) });
      await loadWorkflowStatus();
    } catch (error) {
      $("#workflow-help").textContent = error.message;
      $("#workflow-badge").textContent = "تغییر ناموفق";
      $("#workflow-badge").className = "source-chip status-error";
      button.disabled = false;
    }
  });
  $("#admin-refresh").addEventListener("click", loadAdminPanel);
  loadAuthConfig();

  document.querySelectorAll("[data-view]").forEach(link => link.addEventListener("click", event => {
    event.preventDefault(); const view = link.dataset.view;
    if (view === "admin" && !state.isAdmin) { openAuth(); setAuthMessage("برای ورود به پنل مدیریت، با ایمیلی که مدیر اصلی مجاز کرده وارد شو.", "warn"); return; }
    document.querySelectorAll(".view").forEach(el=>el.classList.toggle("active", el.id === `view-${view}`));
    document.querySelectorAll(".nav-link").forEach(el=>el.classList.toggle("active", el.dataset.view === view));
    const titles = {dashboard:"نمای کلی بازار",settings:"تنظیمات",assets:"تنظیمات",news:"اخبار بازار",analysis:"تحلیل ورک‌فلو",admin:"پنل مدیریت"};
    $("#page-title").textContent = titles[view] || "ماهان مارکت ایجنت";
    history.replaceState(null,"",`#${view}`);
  }));
  $("#refresh-btn").addEventListener("click", refresh);
  $("#chart-asset").addEventListener("change", e => {state.selectedAsset=e.target.value; renderChart(state.payload?.assets?.[Number(e.target.value)]);});
  const initialView = location.hash.slice(1);
  if (["dashboard","settings","assets","news","analysis"].includes(initialView)) {
    document.querySelector(`[data-view="${initialView}"]`)?.click();
  }
  refresh();
})();