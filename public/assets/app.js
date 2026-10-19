(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const state = { payload: null, chart: null, selectedAsset: "" };
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
    return {generated_at: pick(data, ["generated_at", "updated_at", "timestamp"]), assets, news, analysis: String(analysis || ""), sources: data.sources || data.source_status || {}};
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
    state.chart = new Chart(canvas, {type:"line", data:{labels:parsed.map(p=>p.label),datasets:[{label:asset.name,data:parsed.map(p=>p.value),borderColor:"#00ffc4",backgroundColor:"rgba(0,255,196,.08)",fill:true,tension:.3,pointRadius:1.5,borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#8299a8",maxTicksLimit:6},grid:{color:"rgba(130,153,168,.08)"}},y:{ticks:{color:"#8299a8"},grid:{color:"rgba(130,153,168,.1)"}}}}});
  }
  function render(raw) {
    const d = normalize(raw); state.payload = d;
    $("#connection-label").textContent = "API متصل است";
    $(".status-dot").style.background = "var(--cyan)";
    $("#last-updated").textContent = "آخرین به‌روزرسانی: " + dateText(d.generated_at);
    $("#asset-count").textContent = money(d.assets.length);
    $("#news-count").textContent = money(d.news.length);
    $("#data-age").textContent = d.generated_at ? dateText(d.generated_at) : "—";
    $("#top-assets").innerHTML = renderAssets(d.assets.slice(0,5));
    $("#all-assets").innerHTML = d.assets.length ? `<table><thead><tr><th>نام</th><th>نماد</th><th>قیمت</th><th>تغییر</th></tr></thead><tbody>${d.assets.map(a=>`<tr><td>${escapeHtml(a.name)}</td><td dir="ltr">${escapeHtml(a.symbol)}</td><td>${escapeHtml(money(a.price))} ${escapeHtml(a.unit)}</td><td class="${changeClass(a.change)}">${escapeHtml(changeText(a.change))}</td></tr>`).join("")}</tbody></table>` : '<div class="empty-state">دارایی‌ای از API دریافت نشده است.</div>';
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
    $("#demo-banner").classList.add("hidden");
  }
  async function refresh() {
    const button = $("#refresh-btn"); button.disabled = true; button.textContent = "در حال دریافت…";
    try {
      const response = await fetch("/api/market", {headers:{"Accept":"application/json"}, cache:"no-store"});
      const data = await response.json().catch(()=>({error:"پاسخ API JSON معتبر نیست."}));
      if (!response.ok) throw new Error(data.error || `خطای API (${response.status})`);
      render(data);
    } catch (err) {
      $("#connection-label").textContent = "API در دسترس نیست";
      $(".status-dot").style.background = "var(--red)";
      $("#error-banner").textContent = `اتصال به API ناموفق بود: ${err.message}. سرور Railway و تنظیمات ارسال n8n را بررسی کنید.`;
      $("#error-banner").classList.remove("hidden");
      $("#demo-banner").classList.remove("hidden");
    } finally { button.disabled = false; button.textContent = "↻ بروزرسانی"; }
  }
  document.querySelectorAll("[data-view]").forEach(link => link.addEventListener("click", event => {
    event.preventDefault(); const view = link.dataset.view;
    document.querySelectorAll(".view").forEach(el=>el.classList.toggle("active", el.id === `view-${view}`));
    document.querySelectorAll(".nav-link").forEach(el=>el.classList.toggle("active", el.dataset.view === view));
    const titles = {dashboard:"نمای کلی بازار",assets:"دارایی‌ها",news:"اخبار بازار",analysis:"تحلیل ورک‌فلو"};
    $("#page-title").textContent = titles[view] || "ماهان مارکت";
    history.replaceState(null,"",`#${view}`);
  }));
  $("#refresh-btn").addEventListener("click", refresh);
  $("#chart-asset").addEventListener("change", e => {state.selectedAsset=e.target.value; renderChart(state.payload?.assets?.[Number(e.target.value)]);});
  const initialView = location.hash.slice(1);
  if (["dashboard","assets","news","analysis"].includes(initialView)) {
    document.querySelector(`[data-view="${initialView}"]`)?.click();
  }
  refresh();
})();