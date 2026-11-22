// MarketWatch headlines (official RSS feeds) scored with a simple keyword lexicon.
import { getText, cached, decodeEntities, clamp } from '../http.js';
import { assetInfo } from '../currencies.js';

// Only these MarketWatch feeds are still actively updated.
const FEEDS = [
  { id: 'topstories', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { id: 'bulletins', url: 'https://feeds.content.dowjones.io/public/rss/mw_bulletins' },
];
const MAX_AGE_DAYS = 7;

const POSITIVE = ['rise', 'rises', 'rose', 'rising', 'gain', 'gains', 'gained', 'jump', 'jumps', 'surge', 'surges',
  'rally', 'rallies', 'strengthen', 'strengthens', 'stronger', 'strong', 'hawkish', 'hike', 'hikes', 'beat', 'beats',
  'record high', 'climb', 'climbs', 'soar', 'soars', 'upbeat', 'boost', 'boosts', 'rebound', 'rebounds', 'optimism',
  'growth', 'recovers', 'higher'];
const NEGATIVE = ['fall', 'falls', 'fell', 'falling', 'drop', 'drops', 'slump', 'slumps', 'plunge', 'plunges', 'slide',
  'slides', 'weaken', 'weakens', 'weaker', 'weak', 'dovish', 'cut', 'cuts', 'miss', 'misses', 'sell-off', 'selloff',
  'tumble', 'tumbles', 'recession', 'slowdown', 'fears', 'fear', 'worries', 'losses', 'crash', 'brutal', 'lower',
  'wiped out', 'turmoil', 'crisis', 'downgrade', 'tariff', 'tariffs', 'crushed', 'wipeout', 'panic', 'correction',
  'erase', 'erases', 'wreck', 'worst', 'sink', 'sinks', 'sank', 'retreat', 'retreats', 'bear market', 'rout'];
const MARKET_WORDS = ['stocks', 'stock market', 'dow', 's&p', 'nasdaq', 'equities', 'wall street', 'markets', 'investors', 'sell-off', 'selloff'];

function countWords(text, words) {
  let n = 0;
  const hits = [];
  for (const w of words) {
    const re = new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}([^a-z]|$)`, 'i');
    if (re.test(text)) {
      n++;
      hits.push(w);
    }
  }
  return { n, hits };
}

function parseRss(xml, feedId) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const tag = (t) => decodeEntities((it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '').trim();
    return {
      title: tag('title'),
      description: tag('description'),
      link: tag('link'),
      pubDate: tag('pubDate'),
      time: new Date(tag('pubDate')).getTime() || 0,
      feed: feedId,
    };
  });
}

export async function fetchHeadlines() {
  return cached('mw:headlines', 10 * 60 * 1000, async () => {
    const results = await Promise.allSettled(FEEDS.map((f) => getText(f.url).then((x) => parseRss(x, f.id))));
    const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    if (!items.length) throw new Error(results.map((r) => r.reason?.message).filter(Boolean).join('; ') || 'No headlines');
    const seen = new Set();
    return items
      .filter((i) => (seen.has(i.link) ? false : seen.add(i.link)))
      .sort((a, b) => b.time - a.time);
  });
}

function mentions(text, ccy) {
  let t = ` ${text.toLowerCase()} `;
  // "Australian dollar" etc. shouldn't count as a US dollar mention.
  if (ccy === 'USD') t = t.replace(/(australian|aussie|canadian|new zealand|singapore|hong kong) dollar/g, '');
  const words = [...new Set(assetInfo(ccy).keywords.map((k) => k.replace(/[ ,.]+$/, '')))];
  return words.filter((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t));
}

export async function analyzeMarketWatch(pair) {
  const all = await fetchHeadlines();
  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
  const recent = all.filter((i) => i.time >= cutoff);

  const scored = recent.map((i) => {
    const text = `${i.title}. ${i.description}`;
    const pos = countWords(text, POSITIVE);
    const neg = countWords(text, NEGATIVE);
    const sentiment = clamp((pos.n - neg.n) / 2);
    const isMarket = countWords(text, MARKET_WORDS).n > 0;
    return {
      ...i,
      sentiment,
      words: { positive: pos.hits, negative: neg.hits },
      isMarket,
      currencies: {
        [pair.base]: mentions(text, pair.base),
        [pair.quote]: mentions(text, pair.quote),
      },
    };
  });

  // Overall risk tone from market-wide headlines: + risk-on, - risk-off.
  const marketItems = scored.filter((s) => s.isMarket && s.sentiment !== 0);
  const riskTone = marketItems.length
    ? clamp(marketItems.reduce((a, s) => a + s.sentiment, 0) / marketItems.length)
    : 0;

  const ccyScore = (ccy) => {
    const rel = scored.filter((s) => s.currencies[ccy].length);
    const direct = rel.length ? rel.reduce((a, s) => a + s.sentiment, 0) / rel.length : 0;
    const riskEffect = riskTone * assetInfo(ccy).risk;
    return { score: clamp(direct * 0.6 + riskEffect * 0.4), mentions: rel.length, direct, riskEffect };
  };
  const b = ccyScore(pair.base);
  const q = ccyScore(pair.quote);

  const relevant = scored.filter((s) => s.currencies[pair.base].length || s.currencies[pair.quote].length || s.isMarket);

  return {
    riskTone,
    riskLabel: riskTone > 0.15 ? 'Risk-on' : riskTone < -0.15 ? 'Risk-off' : 'Mixed / neutral',
    marketHeadlines: marketItems.length,
    base: b,
    quote: q,
    score: clamp((b.score - q.score) / 2),
    hasSignal: b.mentions + q.mentions + marketItems.length > 0,
    relevant,
    all: scored,
    totalRecent: recent.length,
    note: `Headline sentiment from MarketWatch RSS (last ${MAX_AGE_DAYS} days), keyword-based. Market-wide tone is mapped to each currency's typical risk behaviour (e.g. JPY/CHF gain in risk-off).`,
  };
}
