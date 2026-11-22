// TradingEconomics public pages: pair quote + forecasts, and each currency's
// country page for the analyst narrative and macro table (rates, inflation...).
import { getText, cached, htmlToText, decodeEntities, num } from '../http.js';
import { CURRENCIES } from '../currencies.js';

const BASE = 'https://tradingeconomics.com';
const TTL = 10 * 60 * 1000;

const N = '(-?[\\d,]+(?:\\.\\d+)?)';

function parseQuotePage(html, symbol) {
  const text = htmlToText(html);
  const out = { symbol };

  // Crosses table row, e.g. "EURUSD 1.0967 0.0001 0.005% -4.75% Nov/20"
  const row = text.match(new RegExp(`\\b${symbol}\\s+${N}\\s+${N}\\s+${N}%\\s+${N}%\\s+(\\w{3}/\\d{1,2})`, 'i'));
  if (row) {
    out.price = num(row[1]);
    out.change = num(row[2]);
    out.dayPct = num(row[3]);
    out.yearPct = num(row[4]);
    out.asOf = row[5];
  }

  // Header block on cross pages: "Exchange Rate 207.462 Daily Change -1.5424 -0.74% Monthly -2.05% Yearly 1.27% Q4 Forecast 207.341"
  const hdr = text.match(new RegExp(`(?:Exchange Rate|Actual) ${N} Daily Change ${N} ${N}% Monthly ${N}% Yearly ${N}% (Q\\d) Forecast ${N}`, 'i'));
  if (hdr) {
    out.price ??= num(hdr[1]);
    out.change ??= num(hdr[2]);
    out.dayPct ??= num(hdr[3]);
    out.monthPct = num(hdr[4]);
    out.yearPct ??= num(hdr[5]);
    out.quarterLabel = hdr[6];
    out.quarterForecast = num(hdr[7]);
  }

  // Narrative block on major pages.
  const month = text.match(/Over the past month,.*?has (weakened|strengthened|decreased|increased|fallen|risen|lost|gained) ([\d.]+)%/i);
  if (month && out.monthPct == null) {
    const down = /weakened|decreased|fallen|lost/i.test(month[1]);
    out.monthPct = (down ? -1 : 1) * num(month[2]);
  }
  const q = text.match(new RegExp(`expected to trade at ${N}[^,;]{0,25}? by the end of this quarter`, 'i'));
  if (q) out.quarterForecast ??= num(q[1]);
  const y = text.match(new RegExp(`trade at ${N} in 12 months time`, 'i'));
  if (y) out.yearForecast = num(y[1]);

  // Quarterly forecast path embedded in the page script, e.g. TEForecast = [3498.24,3371.33,3292.50,3215.44]
  const arr = [...html.matchAll(/TEForecast\s*=\s*\[([\d.,\s-]+)\]/g)].map((m) => m[1].split(',').map(num).filter((v) => v != null));
  const path = arr.find((a) => a.length >= 2);
  if (path) {
    out.forecastPath = path;
    out.quarterForecast ??= path[0];
    out.yearForecast ??= path[path.length - 1];
  }

  const desc = html.match(/<h2 id="description"[^>]*>([\s\S]*?)<\/h2>/i);
  if (desc) out.narrative = htmlToText(desc[1]);

  return out;
}

function invertQuote(q, symbol) {
  const inv = (v) => (v ? 1 / v : null);
  const neg = (v) => (v == null ? null : -v);
  return {
    symbol,
    invertedFrom: q.symbol,
    price: inv(q.price),
    dayPct: neg(q.dayPct),
    monthPct: neg(q.monthPct),
    yearPct: neg(q.yearPct),
    asOf: q.asOf,
    quarterLabel: q.quarterLabel,
    quarterForecast: inv(q.quarterForecast),
    yearForecast: inv(q.yearForecast),
    narrative: q.narrative,
  };
}

async function fetchCommodityQuote(pair) {
  const url = BASE + pair.meta.teUrl;
  const html = await cached(`te:quote:${pair.symbol}`, TTL, () => getText(url));
  const q = parseQuotePage(html, pair.symbol);
  if (!q.price) throw new Error(`No price for ${pair.meta.name} on TradingEconomics`);
  q.url = url;
  q.related = parseRelatedTable(html);
  // Brent's page has no US inventory data; borrow it from the WTI page.
  if (pair.meta.kind === 'oil' && !q.related.some((r) => /crude oil stocks change/i.test(r.name))) {
    try {
      const wti = await cached('te:quote:WTIUSD', TTL, () => getText(`${BASE}/commodity/crude-oil`));
      q.related.push(...parseRelatedTable(wti).filter((r) => /crude oil stock/i.test(r.name)));
    } catch {}
  }
  return q;
}

async function fetchQuote(pair) {
  if (pair.type === 'commodity') return fetchCommodityQuote(pair);
  const tryOne = async (sym) => {
    const html = await cached(`te:quote:${sym}`, TTL, () => getText(`${BASE}/${sym.toLowerCase()}:cur`));
    const q = parseQuotePage(html, sym);
    if (!q.price) throw new Error(`No price for ${sym} on TradingEconomics`);
    q.url = `${BASE}/${sym.toLowerCase()}:cur`;
    return q;
  };
  try {
    return await tryOne(pair.symbol);
  } catch (err) {
    // TE only lists the market-convention direction (e.g. USDJPY, not JPYUSD).
    const invSym = pair.quote + pair.base;
    try {
      const q = await tryOne(invSym);
      return { ...invertQuote(q, pair.symbol), url: q.url };
    } catch {
      throw err;
    }
  }
}

function parseRelatedTable(html) {
  const idx = html.search(/>\s*Related\s*</);
  if (idx < 0) return [];
  const end = html.indexOf('</table>', idx);
  const seg = html.slice(idx, end);
  const rows = [];
  for (const [, tr] of seg.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => htmlToText(m[1]));
    if (cells.length < 4) continue;
    const href = (tr.match(/href="([^"]+)"/) || [])[1];
    rows.push({
      name: cells[0],
      last: num(cells[1]),
      previous: num(cells[2]),
      unit: cells[3],
      reference: cells[4] || '',
      url: href ? BASE + href : null,
    });
  }
  return rows;
}

async function fetchCountry(ccy) {
  const meta = CURRENCIES[ccy];
  const url = `${BASE}/${meta.teSlug}/currency`;
  const html = await cached(`te:country:${ccy}`, TTL, () => getText(url));
  const desc = html.match(/<h2 id="description"[^>]*>([\s\S]*?)<\/h2>/i);
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
  return {
    currency: ccy,
    url,
    title: title ? decodeEntities(title).replace(/\s+/g, ' ').trim() : meta.name,
    narrative: desc ? htmlToText(desc[1]) : null,
    related: parseRelatedTable(html),
  };
}

function pickIndicator(rows, country, pattern) {
  return rows.find((r) => r.name.toLowerCase().startsWith(country.toLowerCase()) && pattern.test(r.name)) || null;
}

export async function analyzeTradingEconomics(pair) {
  const isCmd = pair.type === 'commodity';
  const [quoteRes, baseRes, quoteCtyRes] = await Promise.allSettled([
    fetchQuote(pair),
    isCmd ? Promise.resolve(null) : fetchCountry(pair.base),
    fetchCountry(pair.quote),
  ]);
  if (quoteRes.status === 'rejected' && baseRes.status === 'rejected' && quoteCtyRes.status === 'rejected') {
    throw quoteRes.reason;
  }
  const quote = quoteRes.status === 'fulfilled' ? quoteRes.value : null;
  const countries = {
    [pair.base]: isCmd
      ? quote && { currency: pair.base, url: quote.url, title: pair.meta.name, narrative: quote.narrative, related: quote.related || [] }
      : baseRes.status === 'fulfilled' ? baseRes.value : null,
    [pair.quote]: quoteCtyRes.status === 'fulfilled' ? quoteCtyRes.value : null,
  };

  // Merge macro rows from both pages (EUR page also lists US data, etc.).
  const allRows = [];
  const seen = new Set();
  for (const c of Object.values(countries)) {
    for (const r of c?.related || []) {
      if (!seen.has(r.name)) {
        seen.add(r.name);
        allRows.push(r);
      }
    }
  }

  const macroFor = (ccy) => {
    if (!CURRENCIES[ccy]) {
      // Commodity side: show its own related table (production, inventories...).
      const rows = countries[ccy]?.related || [];
      return {
        rows,
        inventories: rows.find((r) => /United States Crude Oil Stocks Change/i.test(r.name)) || rows.find((r) => /crude oil stock change/i.test(r.name)) || null,
      };
    }
    const country = CURRENCIES[ccy].teCountry;
    return {
      interestRate: pickIndicator(allRows, country, /interest rate/i),
      inflation: pickIndicator(allRows, country, /inflation rate/i),
      unemployment: pickIndicator(allRows, country, /unemployment rate/i),
      rows: allRows.filter((r) => r.name.toLowerCase().startsWith(country.toLowerCase())),
    };
  };

  return {
    quote,
    quoteError: quoteRes.status === 'rejected' ? quoteRes.reason.message : null,
    countries,
    macro: { [pair.base]: macroFor(pair.base), [pair.quote]: macroFor(pair.quote) },
  };
}
