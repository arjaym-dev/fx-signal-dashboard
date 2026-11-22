// ForexFactory economic calendar via its official weekly JSON export.
// The export has forecast/previous but NOT actual values, so we read the
// consensus direction (forecast vs previous) and flag upcoming event risk.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJson, num } from '../http.js';

const FEED = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const IMPACT_WEIGHT = { High: 3, Medium: 2, Low: 1, Holiday: 0 };

// Indicators where a higher number is BAD for the currency.
// (Crude inventories: lower stockpiles = tighter supply = bullish for oil.)
const LOWER_IS_BETTER = /unemployment|jobless|claimant|claims|bankrupt|insolvenc|trade deficit|budget deficit|inventories|storage/i;

// The feed is rate-limited (HTTP 429 after a few requests in ~5 min), so the
// last good copy is kept on disk: reused for 30 min, and as a fallback after that.
const CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.cache', 'ff_calendar.json');
const FRESH_MS = 30 * 60 * 1000;
let inflight = null;

async function readDisk() {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export async function fetchCalendar() {
  const disk = await readDisk();
  if (disk && Date.now() - disk.fetchedAt < FRESH_MS) return { events: disk.events, fetchedAt: disk.fetchedAt, stale: false };
  inflight ??= getJson(FEED).finally(() => (inflight = null));
  try {
    const events = await inflight;
    const fetchedAt = Date.now();
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify({ fetchedAt, events }));
    return { events, fetchedAt, stale: false };
  } catch (err) {
    if (disk) return { events: disk.events, fetchedAt: disk.fetchedAt, stale: true, error: err.message };
    throw new Error(`${err.message}${/429/.test(err.message) ? ' (ForexFactory rate limit — try again in ~5 minutes)' : ''}`);
  }
}

export async function analyzeForexFactory(pair) {
  const feed = await fetchCalendar();
  const raw = feed.events;
  const now = Date.now();
  // For commodities, USD events about the commodity itself (e.g. crude inventories) count for the commodity side.
  const ownPattern = pair.type === 'commodity' ? pair.meta.ffPattern : null;
  const sideOf = (e) => (ownPattern && e.country === 'USD' && ownPattern.test(e.title) ? pair.base : e.country);
  const events = raw
    .filter((e) => e.country === pair.base || e.country === pair.quote)
    .map((e) => {
      const time = new Date(e.date).getTime();
      const forecast = num(e.forecast);
      const previous = num(e.previous);
      const weight = IMPACT_WEIGHT[e.impact] ?? 1;
      let bias = 0;
      let biasNote = 'No forecast — event risk only';
      if (forecast != null && previous != null) {
        const diff = forecast - previous;
        if (diff === 0) {
          bias = 0;
          biasNote = 'Forecast in line with previous';
        } else {
          const better = LOWER_IS_BETTER.test(e.title) ? diff < 0 : diff > 0;
          bias = better ? 1 : -1;
          biasNote = better ? 'Consensus expects improvement' : 'Consensus expects deterioration';
        }
      }
      return {
        title: e.title,
        currency: sideOf(e),
        country: e.country,
        impact: e.impact,
        date: e.date,
        time,
        forecast: e.forecast || '',
        previous: e.previous || '',
        status: time < now ? 'released' : 'upcoming',
        hoursAway: Math.round(((time - now) / 36e5) * 10) / 10,
        bias,
        biasNote,
        weight,
      };
    })
    .sort((a, b) => a.time - b.time);

  const scoreFor = (ccy) => {
    let sum = 0;
    let w = 0;
    for (const e of events) {
      if (e.currency !== ccy || !e.bias || !e.weight) continue;
      sum += e.bias * e.weight;
      w += e.weight;
    }
    return { score: w ? sum / w : 0, weight: w };
  };
  const b = scoreFor(pair.base);
  const q = scoreFor(pair.quote);

  const upcomingHigh = events.filter((e) => e.status === 'upcoming' && e.impact === 'High');
  const imminent = upcomingHigh.filter((e) => e.hoursAway <= 2);
  const next24h = upcomingHigh.filter((e) => e.hoursAway <= 24);

  const weekStart = raw.length ? raw[0].date : null;
  const weekEnd = raw.length ? raw[raw.length - 1].date : null;

  return {
    events,
    weekStart,
    weekEnd,
    baseScore: b.score,
    quoteScore: q.score,
    score: (b.score - q.score) / 2,
    hasSignal: b.weight + q.weight > 0,
    risk: { imminent, next24h },
    fetchedAt: feed.fetchedAt,
    stale: feed.stale,
    note: 'ForexFactory’s public feed publishes forecast & previous values only (no actuals), so this measures the consensus outlook and upcoming event risk.',
  };
}
