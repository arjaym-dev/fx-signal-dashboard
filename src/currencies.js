// Instrument metadata: currencies (TradingEconomics country slug/name, news
// keywords, risk profile) and USD-priced commodities.
// risk: how the asset tends to react to risk-on news (+ = gains when markets are upbeat).
export const CURRENCIES = {
  USD: { name: 'US Dollar', teSlug: 'united-states', teCountry: 'United States', risk: -0.5,
    keywords: ['dollar', 'greenback', 'federal reserve', 'the fed', 'fed ', 'fomc', 'treasury yield', 'warsh'] },
  EUR: { name: 'Euro', teSlug: 'euro-area', teCountry: 'Euro Area', risk: 0,
    keywords: ['euro ', 'euro,', 'euro.', 'euros', 'ecb', 'european central bank', 'lagarde', 'eurozone', 'euro zone', 'euro area'] },
  GBP: { name: 'British Pound', teSlug: 'united-kingdom', teCountry: 'United Kingdom', risk: 0.1,
    keywords: ['pound', 'sterling', 'bank of england', 'boe', 'bailey', 'u.k. ', 'uk economy', 'britain'] },
  JPY: { name: 'Japanese Yen', teSlug: 'japan', teCountry: 'Japan', risk: -1,
    keywords: ['yen', 'bank of japan', 'boj', 'japan'] },
  AUD: { name: 'Australian Dollar', teSlug: 'australia', teCountry: 'Australia', risk: 1,
    keywords: ['australian dollar', 'aussie', 'rba', 'reserve bank of australia', 'australia'] },
  NZD: { name: 'New Zealand Dollar', teSlug: 'new-zealand', teCountry: 'New Zealand', risk: 1,
    keywords: ['new zealand', 'kiwi', 'rbnz'] },
  CAD: { name: 'Canadian Dollar', teSlug: 'canada', teCountry: 'Canada', risk: 0.7,
    keywords: ['canadian dollar', 'loonie', 'bank of canada', 'canada'] },
  CHF: { name: 'Swiss Franc', teSlug: 'switzerland', teCountry: 'Switzerland', risk: -1,
    keywords: ['swiss franc', 'franc', 'snb', 'swiss national bank', 'switzerland'] },
  CNY: { name: 'Chinese Yuan', teSlug: 'china', teCountry: 'China', risk: 0.4,
    keywords: ['yuan', 'renminbi', 'pboc', "people's bank of china", 'china', 'beijing'] },
  MXN: { name: 'Mexican Peso', teSlug: 'mexico', teCountry: 'Mexico', risk: 0.8, keywords: ['peso', 'mexico', 'banxico'] },
  ZAR: { name: 'South African Rand', teSlug: 'south-africa', teCountry: 'South Africa', risk: 0.9, keywords: ['rand', 'south africa'] },
  SEK: { name: 'Swedish Krona', teSlug: 'sweden', teCountry: 'Sweden', risk: 0.3, keywords: ['krona', 'riksbank', 'sweden'] },
  NOK: { name: 'Norwegian Krone', teSlug: 'norway', teCountry: 'Norway', risk: 0.5, keywords: ['krone', 'norges bank', 'norway'] },
  SGD: { name: 'Singapore Dollar', teSlug: 'singapore', teCountry: 'Singapore', risk: 0.3, keywords: ['singapore'] },
  HKD: { name: 'Hong Kong Dollar', teSlug: 'hong-kong', teCountry: 'Hong Kong', risk: 0.2, keywords: ['hong kong'] },
  INR: { name: 'Indian Rupee', teSlug: 'india', teCountry: 'India', risk: 0.5, keywords: ['rupee', 'india', 'rbi'] },
  PLN: { name: 'Polish Zloty', teSlug: 'poland', teCountry: 'Poland', risk: 0.5, keywords: ['zloty', 'poland'] },
  TRY: { name: 'Turkish Lira', teSlug: 'turkey', teCountry: 'Turkey', risk: 0.6, keywords: ['lira', 'turkey', 'turkiye'] },
};

// Commodities, all quoted in USD.
// history: where daily closes come from (no free official API covers all three).
// ffPattern: ForexFactory (USD) events that are about this commodity itself.
export const COMMODITIES = {
  XAU: { name: 'Gold', noun: 'gold', symbol: 'XAUUSD', display: 'XAU/USD', unit: 'per troy ounce', teUrl: '/commodity/gold', risk: -0.8,
    kind: 'metal', history: { source: 'coingecko', id: 'pax-gold', label: 'PAX Gold (gold-backed token) via CoinGecko' },
    keywords: ['gold', 'bullion', 'precious metal'], aliases: ['GOLD', 'XAU', 'XAUUSD'] },
  XAG: { name: 'Silver', noun: 'silver', symbol: 'XAGUSD', display: 'XAG/USD', unit: 'per troy ounce', teUrl: '/commodity/silver', risk: -0.2,
    kind: 'metal', history: { source: 'coingecko', id: 'kinesis-silver', label: 'Kinesis Silver (silver-backed token) via CoinGecko' },
    keywords: ['silver', 'precious metal'], aliases: ['SILVER', 'XAG', 'XAGUSD'] },
  WTI: { name: 'WTI Crude Oil', noun: 'oil', symbol: 'WTIUSD', display: 'WTI/USD', unit: 'per barrel', teUrl: '/commodity/crude-oil', risk: 0.7,
    kind: 'oil', history: { source: 'eia', series: 'rwtc', label: 'US EIA daily WTI spot price' },
    ffPattern: /crude oil inventories|crude inventories/i,
    keywords: ['oil', 'crude', 'opec', 'wti', 'barrel', 'energy prices'], aliases: ['OIL', 'WTI', 'USOIL', 'CRUDE', 'WTIUSD', 'CL'] },
  BRENT: { name: 'Brent Crude Oil', noun: 'oil', symbol: 'BRENTUSD', display: 'BRENT/USD', unit: 'per barrel', teUrl: '/commodity/brent-crude-oil', risk: 0.7,
    kind: 'oil', history: { source: 'eia', series: 'rbrte', label: 'US EIA daily Brent spot price' },
    ffPattern: /crude oil inventories|crude inventories/i,
    keywords: ['oil', 'crude', 'opec', 'brent', 'barrel', 'energy prices'], aliases: ['BRENT', 'UKOIL', 'BRENTUSD', 'BRN'] },
};

export const PAIR_GROUPS = [
  { label: 'Majors', pairs: ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD'] },
  { label: 'Crosses', pairs: ['EURJPY', 'GBPJPY', 'EURGBP', 'AUDJPY', 'EURAUD', 'EURCHF', 'GBPAUD', 'CADJPY'] },
  { label: 'Metals & Energy', pairs: ['XAUUSD', 'XAGUSD', 'WTIUSD', 'BRENTUSD'] },
  { label: 'Other', pairs: ['USDCNY', 'USDMXN', 'USDZAR'] },
];

const names = (code) => CURRENCIES[code]?.name || COMMODITIES[code]?.name || code;

// Accepts "EUR/USD", "eurusd", "EUR USD", "gold", "XAU/USD", "oil", "USOIL", "brent"...
export function parsePair(input) {
  const clean = String(input || '').toUpperCase().replace(/[^A-Z]/g, '');
  for (const [code, c] of Object.entries(COMMODITIES)) {
    if (c.aliases.includes(clean) || clean === c.symbol) {
      return {
        type: 'commodity',
        base: code,
        quote: 'USD',
        symbol: c.symbol,
        display: c.display,
        baseName: c.name,
        quoteName: names('USD'),
        meta: c,
      };
    }
  }
  if (clean.length !== 6) {
    throw new Error('Enter a pair like EUR/USD or GBPJPY, or a commodity: gold, silver, oil (WTI), brent.');
  }
  const base = clean.slice(0, 3);
  const quote = clean.slice(3);
  const unknown = [base, quote].filter((c) => !CURRENCIES[c]);
  if (unknown.length) {
    throw new Error(
      `Unsupported: ${unknown.join(', ')}. Currencies: ${Object.keys(CURRENCIES).join(', ')}. Commodities: XAU/USD, XAG/USD, WTI/USD, BRENT/USD.`
    );
  }
  if (base === quote) throw new Error('Base and quote currency must be different.');
  return { type: 'fx', base, quote, symbol: base + quote, display: `${base}/${quote}`, baseName: names(base), quoteName: names(quote) };
}

// Keywords + risk profile for either side of an instrument.
export function assetInfo(code) {
  return CURRENCIES[code] || COMMODITIES[code];
}
