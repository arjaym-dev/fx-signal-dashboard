// Daily close history for the chart and technicals.
//  - Currencies: ECB reference rates via the free Frankfurter API.
//  - Gold/silver: metal-backed tokens on CoinGecko (track spot closely).
//  - Oil: official US EIA daily spot prices (published weekly, ~1 week behind).
import { getJson, getText, cached } from '../http.js';

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const iso = (d) => d.toISOString().slice(0, 10);

async function fxHistory(pair, days) {
  const start = iso(new Date(Date.now() - days * 864e5));
  const url = `https://api.frankfurter.app/${start}..?from=${pair.base}&to=${pair.quote}`;
  const data = await cached(`px:${pair.symbol}`, 60 * 60 * 1000, () => getJson(url));
  return Object.entries(data.rates || {}).map(([date, r]) => ({ date, close: r[pair.quote] }));
}

async function coingeckoHistory(pair, days) {
  const url = `https://api.coingecko.com/api/v3/coins/${pair.meta.history.id}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  const data = await cached(`px:${pair.symbol}`, 60 * 60 * 1000, () => getJson(url));
  const byDay = new Map();
  for (const [t, price] of data.prices || []) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue; // tokens trade 24/7; metal markets don't
    byDay.set(iso(d), price); // last value per day wins
  }
  return [...byDay].map(([date, close]) => ({ date, close }));
}

async function eiaHistory(pair, days) {
  const url = `https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=pet&s=${pair.meta.history.series}&f=d`;
  const html = await cached(`px:${pair.symbol}`, 3 * 60 * 60 * 1000, () => getText(url, { timeout: 25000 }));
  const out = [];
  // Rows look like: <td class='B6'>2026 Nov-16 to Nov-20</td><td class='B3'>89.24</td>... (Mon..Fri)
  for (const [, row] of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const label = row.match(/(\d{4})\s+([A-Z][a-z]{2})-\s*(\d{1,2})\s+to/);
    if (!label) continue;
    const cells = [...row.matchAll(/<td class='B3'>([^<]*)<\/td>/g)].map((m) => parseFloat(m[1]));
    const start = new Date(Date.UTC(Number(label[1]), MONTHS[label[2]], Number(label[3])));
    cells.forEach((v, i) => {
      if (Number.isFinite(v)) out.push({ date: iso(new Date(start.getTime() + i * 864e5)), close: v });
    });
  }
  const cutoff = iso(new Date(Date.now() - days * 864e5));
  return out.filter((p) => p.date >= cutoff);
}

export function historySourceLabel(pair) {
  return pair.type === 'commodity' ? pair.meta.history.label : 'ECB reference rates via Frankfurter';
}

export async function fetchHistory(pair, days = 200) {
  const src = pair.type === 'commodity' ? pair.meta.history.source : 'frankfurter';
  const raw = src === 'coingecko' ? await coingeckoHistory(pair, days) : src === 'eia' ? await eiaHistory(pair, days) : await fxHistory(pair, days);
  const series = raw.filter((p) => Number.isFinite(p.close)).sort((a, b) => a.date.localeCompare(b.date));
  if (series.length < 30) throw new Error(`Not enough price history for ${pair.display}`);
  return series;
}

const sma = (arr, n, i) => {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += arr[k];
  return s / n;
};

function rsi(closes, n = 14) {
  if (closes.length <= n) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export function technicals(series) {
  const closes = series.map((p) => p.close);
  const last = closes.length - 1;
  const rets = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const recent = rets.slice(-20);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const dailyVol = Math.sqrt(recent.reduce((a, b) => a + (b - mean) ** 2, 0) / (recent.length - 1));
  const window20 = closes.slice(-20);

  return {
    last: closes[last],
    lastDate: series[last].date,
    sma20: sma(closes, 20, last),
    sma50: sma(closes, 50, last),
    rsi14: rsi(closes, 14),
    change5d: (closes[last] / closes[last - 5] - 1) * 100,
    change20d: (closes[last] / closes[last - 20] - 1) * 100,
    dailyVolPct: dailyVol * 100,
    high20: Math.max(...window20),
    low20: Math.min(...window20),
    chart: series
      .map((p, i) => ({ date: p.date, close: p.close, sma20: sma(closes, 20, i), sma50: sma(closes, 50, i) }))
      .slice(-120),
  };
}
