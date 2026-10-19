// n8n Code node: put this AFTER the AI Agent and BEFORE the Crypto (HMAC) node.
// The secret is NOT read from this code. Keep it in the n8n Crypto credential.

const market = $('Code in JavaScript1').first().json;
const agent = $input.first().json;

function asAsset(symbol, value) {
  const obj = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : { price: value };
  const knownNames = {
    tgju: 'دلار آزاد (TGJU)',
    tindex_usd: 'دلار آمریکا (Tindex)'
  };
  return {
    ...obj,
    symbol: obj.symbol ?? symbol,
    name: obj.name ?? knownNames[symbol] ?? symbol,
    price: obj.price ?? obj.value ?? obj.last_price ?? obj.last ?? obj.current_price ?? obj.close ?? null,
    unit: obj.unit ?? (symbol === 'tgju' ? 'تومان' : ''),
    change_percent: obj.change_percent ?? obj.percent_change ?? obj.change ?? null,
    history: Array.isArray(obj.history) ? obj.history : []
  };
}

const priceSource = market.prices ?? {};
const assets = Array.isArray(market.assets)
  ? market.assets
  : Object.entries(priceSource).map(([symbol, value]) => asAsset(symbol, value));

let analysis = agent.output ?? agent.text ?? agent.response ?? agent.answer ?? agent.analysis ?? '';
if (typeof analysis !== 'string') analysis = JSON.stringify(analysis);

const payload = {
  generated_at: new Date().toISOString(),
  assets,
  news: Array.isArray(market.news) ? market.news : [],
  analysis,
  sources: market.sources ?? {},
  market_context: market.market_context ?? {},
  statistics: market.statistics ?? {},
  confidence: agent.confidence ?? market.confidence ?? null,
  scenarios: agent.scenarios ?? market.scenarios ?? null
};

const bodyString = JSON.stringify(payload);
const timestamp = String(Math.floor(Date.now() / 1000));
// Uniqueness only: this is not a secret. Authentication comes from the Crypto node's HMAC.
const executionId = String($execution.id ?? 'manual');
const eventId = `evt-${Date.now()}-${executionId}-${Math.random().toString(36).slice(2, 12)}`;
const signingString = `${timestamp}.${eventId}.${bodyString}`;

return [{ json: { timestamp, eventId, bodyString, signingString } }];
