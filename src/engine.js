// Combines every source into one BUY / SELL / NEUTRAL call.
// Each component returns a score in [-1, 1]: positive favours the BASE
// (buy the pair / the commodity), negative favours the QUOTE (sell).
// Every component also produces a plain-English sentence for beginners.
import { parsePair, assetInfo } from './currencies.js';
import { clamp } from './http.js';
import { analyzeForexFactory } from './sources/forexfactory.js';
import { analyzeMarketWatch } from './sources/marketwatch.js';
import { analyzeTradingEconomics } from './sources/tradingeconomics.js';
import { fetchHistory, technicals, historySourceLabel } from './sources/prices.js';

const WEIGHTS = {
  technical: 0.3,
  forecast: 0.2,
  calendar: 0.2,
  macro: 0.15,
  news: 0.15,
};
const THRESHOLD = 0.15;

const pct = (v, d = 2) => (v == null ? 'n/a' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`);
const fmt = (v) => (v == null ? 'n/a' : v >= 20 ? v.toFixed(2) : v >= 0.1 ? v.toFixed(5) : v.toPrecision(5));
const abs = (v, d = 1) => Math.abs(v).toFixed(d);

function lean(score) {
  if (score == null) return { lean: 'NONE', strength: '' };
  const a = Math.abs(score);
  const l = score > 0.1 ? 'BUY' : score < -0.1 ? 'SELL' : 'NEUTRAL';
  const strength = l === 'NEUTRAL' ? '' : a >= 0.6 ? 'Strong' : a >= 0.3 ? 'Moderate' : 'Slight';
  return { lean: l, strength };
}

/* ---------------- components ---------------- */

function technicalComponent(pair, t, te) {
  const reasons = [];
  let s = 0;
  const price = te?.price ?? t.last;
  const name = pair.type === 'commodity' ? pair.baseName : pair.display;
  const above20 = t.sma20 ? price > t.sma20 : null;
  const up2050 = t.sma20 && t.sma50 ? t.sma20 > t.sma50 : null;

  if (above20 != null) {
    s += above20 ? 0.25 : -0.25;
    reasons.push(`Price ${fmt(price)} is ${above20 ? 'above' : 'below'} the 20-day average (${fmt(t.sma20)})`);
  }
  if (up2050 != null) {
    s += up2050 ? 0.25 : -0.25;
    reasons.push(`20-day average is ${up2050 ? 'above' : 'below'} the 50-day → ${up2050 ? 'uptrend' : 'downtrend'}`);
  }
  const vol5 = t.dailyVolPct * Math.sqrt(5) || 1;
  s += clamp(t.change5d / vol5) * 0.25;
  reasons.push(`5-day change ${pct(t.change5d)} (a typical 5-day move is ~${vol5.toFixed(2)}%)`);

  if (te?.dayPct != null && t.dailyVolPct) {
    s += clamp(te.dayPct / t.dailyVolPct) * 0.15;
    reasons.push(`Latest session ${pct(te.dayPct)} (TradingEconomics)`);
  }
  let rsiNote = '';
  if (t.rsi14 != null) {
    if (t.rsi14 > 70) {
      s -= 0.3;
      reasons.push(`RSI ${t.rsi14.toFixed(0)} — overbought, pullback risk`);
      rsiNote = ` It has climbed a lot very quickly (RSI ${t.rsi14.toFixed(0)}), so a pullback is possible.`;
    } else if (t.rsi14 < 30) {
      s += 0.3;
      reasons.push(`RSI ${t.rsi14.toFixed(0)} — oversold, bounce risk`);
      rsiNote = ` It has dropped a lot very quickly (RSI ${t.rsi14.toFixed(0)}), so a short bounce is possible.`;
    } else {
      s += ((t.rsi14 - 50) / 20) * 0.1;
      reasons.push(`RSI ${t.rsi14.toFixed(0)} — neutral zone`);
    }
  }

  let trend;
  if (above20 && up2050) trend = `${name} is in an uptrend — the price is above its recent averages.`;
  else if (above20 === false && up2050 === false) trend = `${name} is in a downtrend — the price is below its recent averages.`;
  else trend = `${name}'s trend is mixed — the price is ${above20 ? 'above' : 'below'} its 20-day average, but the longer trend is ${up2050 ? 'up' : 'down'}.`;
  const week = Math.abs(t.change5d) < 0.15 ? ' It was roughly flat over the last week.' : ` Over the last week it ${t.change5d > 0 ? 'rose' : 'fell'} ${abs(t.change5d, 2)}%.`;

  return { score: clamp(s), reasons, plain: trend + week + rsiNote };
}

function forecastComponent(pair, q) {
  if (!q?.price || (!q.quarterForecast && !q.yearForecast)) return null;
  const reasons = [];
  let s = 0;
  let w = 0;
  let dq = null;
  let dy = null;
  if (q.quarterForecast) {
    dq = (q.quarterForecast / q.price - 1) * 100;
    s += clamp(dq / 1.5) * 0.6;
    w += 0.6;
    reasons.push(`TE ${q.quarterLabel || 'quarter-end'} forecast ${fmt(q.quarterForecast)} (${pct(dq)} from here)`);
  }
  if (q.yearForecast) {
    dy = (q.yearForecast / q.price - 1) * 100;
    s += clamp(dy / 4) * 0.4;
    w += 0.4;
    reasons.push(`TE 12-month forecast ${fmt(q.yearForecast)} (${pct(dy)})`);
  }
  const name = pair.type === 'commodity' ? pair.baseName : pair.display;
  const say = (d) => (Math.abs(d) < 0.3 ? 'about the same as now' : `${abs(d)}% ${d > 0 ? 'higher' : 'lower'} than now`);
  let plain = dq != null
    ? `TradingEconomics expects ${name} to be around ${fmt(q.quarterForecast)} by the end of the quarter — ${say(dq)}.`
    : `TradingEconomics expects ${name} to be around ${fmt(q.yearForecast)} in 12 months — ${say(dy)}.`;
  if (dq != null && dy != null) plain += ` In 12 months: ${say(dy)}.`;
  return { score: clamp(s / w), reasons, plain };
}

function fxMacroComponent(pair, macro) {
  const b = macro[pair.base];
  const q = macro[pair.quote];
  const rb = b?.interestRate?.last;
  const rq = q?.interestRate?.last;
  if (rb == null || rq == null) return null;
  const reasons = [];
  const diff = rb - rq;
  let s = clamp(diff / 3) * 0.7;
  reasons.push(`Rate differential ${pair.base} ${rb}% vs ${pair.quote} ${rq}% (${diff > 0 ? '+' : ''}${diff.toFixed(2)} pts)`);
  const ib = b.inflation?.last;
  const iq = q.inflation?.last;
  if (ib != null && iq != null) {
    const realDiff = rb - ib - (rq - iq);
    s += clamp(realDiff / 3) * 0.3;
    reasons.push(`Real-rate gap (rate − inflation): ${realDiff > 0 ? '+' : ''}${realDiff.toFixed(2)} pts`);
  }
  const moves = [];
  for (const [ind, ccy] of [[b.interestRate, pair.base], [q.interestRate, pair.quote]]) {
    if (ind?.last == null || ind?.previous == null || ind.last === ind.previous) continue;
    const hiked = ind.last > ind.previous;
    reasons.push(`${ccy} rate ${hiked ? 'raised' : 'cut'} at the last decision (${ind.previous}% → ${ind.last}%)`);
    moves.push(`${ccy}'s central bank recently ${hiked ? 'raised' : 'cut'} rates.`);
  }
  const hi = diff > 0 ? pair.base : pair.quote;
  const plain =
    Math.abs(diff) < 0.25
      ? `${pair.base} and ${pair.quote} pay similar interest rates (${rb}% vs ${rq}%), so rates don't favour either side much.`
      : `${hi} pays the higher interest rate (${pair.base} ${rb}% vs ${pair.quote} ${rq}%). Big investors tend to hold the currency that pays more, which supports ${hi}.` +
        (moves.length ? ` ${moves.join(' ')}` : '');
  return { score: clamp(s), reasons, plain };
}

function metalMacroComponent(pair, macro) {
  const us = macro.USD;
  const r = us?.interestRate?.last;
  const i = us?.inflation?.last;
  if (r == null || i == null) return null;
  const real = r - i;
  let s = -clamp((real - 1) / 2) * 0.8;
  const reasons = [`US interest rate ${r}% − US inflation ${i}% = real rate ${real.toFixed(2)}%`];
  let extra = '';
  const prev = us.interestRate.previous;
  if (prev != null && prev !== r) {
    const hiked = r > prev;
    s += hiked ? -0.2 : 0.2;
    reasons.push(`Fed ${hiked ? 'raised' : 'cut'} rates at the last decision (${prev}% → ${r}%)`);
    extra = ` The Fed recently ${hiked ? 'raised' : 'cut'} rates, which ${hiked ? 'weighs on' : 'helps'} ${pair.meta.noun}.`;
  }
  const plain =
    real > 1
      ? `US interest rates are well above inflation (real rate ${real.toFixed(1)}%). Cash and bonds pay well, so ${pair.meta.noun} — which pays no interest — is less attractive.${extra}`
      : `US interest rates barely beat inflation (real rate ${real.toFixed(1)}%). That makes ${pair.meta.noun} relatively attractive as a store of value.${extra}`;
  return { score: clamp(s), reasons, plain };
}

function oilMacroComponent(pair, macro) {
  const inv = macro[pair.base]?.inventories;
  if (inv?.last == null) return null;
  const s = -clamp(inv.last / 6);
  const reasons = [`${inv.name}: ${inv.last} ${inv.unit} (previous ${inv.previous}) — ${inv.reference}`];
  const plain =
    inv.last > 0
      ? `US crude stockpiles rose by ${abs(inv.last)} million barrels in the latest report. More oil in storage means more supply, which usually pushes prices down.`
      : `US crude stockpiles fell by ${abs(inv.last)} million barrels in the latest report. Less oil in storage means tighter supply, which usually supports prices.`;
  return { score: s, reasons, plain };
}

function calendarComponent(pair, ff) {
  if (!ff.hasSignal) return null;
  const dir = (v) => (v > 0.1 ? 'better' : v < -0.1 ? 'worse' : 'mixed');
  const reasons = [
    `${pair.base} data consensus this week: ${dir(ff.baseScore)} than previous`,
    `${pair.quote} data consensus this week: ${dir(ff.quoteScore)} than previous`,
  ];
  let plain;
  if (pair.type === 'commodity') {
    const noun = pair.meta.noun;
    const d = dir(ff.quoteScore);
    plain =
      d === 'better'
        ? `This week's US economic reports are expected to come in better than last time. Strong US data usually lifts the dollar, which tends to push ${noun} prices down.`
        : d === 'worse'
          ? `This week's US economic reports are expected to come in worse than last time. Weaker US data can weigh on the dollar, which tends to help ${noun} prices.`
          : `This week's US economic reports are expected to be mixed, so the dollar has no clear push from the data.`;
    if (ff.events.some((e) => e.currency === pair.base)) plain += ` Oil inventory reports are also counted directly.`;
  } else {
    plain = `This week's economic reports are expected to look ${dir(ff.baseScore)} for ${pair.base} and ${dir(ff.quoteScore)} for ${pair.quote} compared with last time. Good data usually strengthens a currency.`;
  }
  const upcoming = ff.events.filter((e) => e.status === 'upcoming' && e.impact === 'High').length;
  if (upcoming) plain += ` ⚠ ${upcoming} high-impact report(s) are still to come — prices can jump when they're released.`;
  return { score: clamp(ff.score), reasons, plain };
}

function newsComponent(pair, mw) {
  if (!mw.hasSignal) return null;
  const reasons = [`Market tone: ${mw.riskLabel} (${mw.marketHeadlines} market-wide headlines)`];
  reasons.push(`${pair.base}: ${mw.base.mentions} headline mention(s); ${pair.quote}: ${mw.quote.mentions}`);
  const mood = mw.riskTone > 0.15 ? 'confident (“risk-on”)' : mw.riskTone < -0.15 ? 'nervous (“risk-off”)' : 'calm / mixed';
  let plain = `Recent MarketWatch headlines suggest investors are ${mood}.`;
  if (Math.abs(mw.riskTone) > 0.15) {
    const rb = assetInfo(pair.base).risk;
    const rq = assetInfo(pair.quote).risk;
    const fav = mw.riskTone > 0 ? (rb > rq ? pair.base : pair.quote) : rb < rq ? pair.base : pair.quote;
    const favName = fav === pair.base ? pair.baseName : pair.quoteName;
    plain += mw.riskTone < 0
      ? ` When markets are nervous, money tends to move into “safer” assets — here that favours ${favName}.`
      : ` When markets are confident, money tends to move into riskier assets — here that favours ${favName}.`;
    reasons.push(`${mw.riskLabel} tends to favour ${fav} in this pair`);
  }
  const direct = mw.base.mentions + mw.quote.mentions;
  const who = pair.type === 'commodity' ? `${pair.meta.noun} or the dollar` : `${pair.base} or ${pair.quote}`;
  plain += direct ? ` ${direct} headline(s) mention ${who} directly.` : ` No recent headlines mention ${who} directly.`;
  return { score: clamp(mw.score), reasons, plain };
}

/* ---------------- main ---------------- */

const lastWeekday = () => {
  const d = new Date();
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export async function analyze(input) {
  const pair = parsePair(input);
  const started = Date.now();
  const isCmd = pair.type === 'commodity';

  const [ffR, mwR, teR, pxR] = await Promise.allSettled([
    analyzeForexFactory(pair),
    analyzeMarketWatch(pair),
    analyzeTradingEconomics(pair),
    fetchHistory(pair),
  ]);
  const val = (r) => (r.status === 'fulfilled' ? r.value : null);
  const err = (r) => (r.status === 'rejected' ? r.reason?.message || String(r.reason) : null);

  const ff = val(ffR);
  const mw = val(mwR);
  const te = val(teR);
  let series = val(pxR);
  // Commodity history can lag (EIA publishes weekly); add TradingEconomics' latest price as the newest point.
  if (series && isCmd && te?.quote?.price) {
    const day = lastWeekday();
    if (series[series.length - 1].date < day) series = [...series, { date: day, close: te.quote.price, live: true }];
  }
  const tech = series ? technicals(series) : null;

  const sources = {
    forexfactory: { ok: !!ff, error: err(ffR) },
    marketwatch: { ok: !!mw, error: err(mwR) },
    tradingeconomics: { ok: !!te, error: err(teR) || te?.quoteError || null },
    prices: { ok: !!tech, error: err(pxR), label: historySourceLabel(pair) },
  };

  const macroComp = !te
    ? null
    : !isCmd
      ? fxMacroComponent(pair, te.macro)
      : pair.meta.kind === 'metal'
        ? metalMacroComponent(pair, te.macro)
        : oilMacroComponent(pair, te.macro);

  const components = {
    technical: tech ? technicalComponent(pair, tech, te?.quote) : null,
    forecast: te ? forecastComponent(pair, te.quote) : null,
    macro: macroComp,
    calendar: ff ? calendarComponent(pair, ff) : null,
    news: mw ? newsComponent(pair, mw) : null,
  };

  const info = {
    technical: { icon: '📈', title: 'Price trend', question: 'Has the price been going up or down lately?' },
    forecast: { icon: '🔮', title: 'Analyst forecast', question: 'Where do TradingEconomics analysts expect the price to go?' },
    macro: !isCmd
      ? { icon: '🏦', title: 'Interest rates', question: 'Which currency pays more interest?' }
      : pair.meta.kind === 'metal'
        ? { icon: '🏦', title: 'Rates vs inflation', question: 'Do US interest rates make holding metal less attractive?' }
        : { icon: '🛢️', title: 'Oil supply', question: 'Are US oil stockpiles growing or shrinking?' },
    calendar: { icon: '📅', title: 'Economic calendar', question: 'Are this week’s reports expected to be good or bad? (ForexFactory)' },
    news: { icon: '📰', title: 'News mood', question: 'Are headlines nervous or confident? (MarketWatch)' },
  };

  let total = 0;
  let wsum = 0;
  const breakdown = Object.entries(components).map(([key, c]) => {
    if (c) {
      total += c.score * WEIGHTS[key];
      wsum += WEIGHTS[key];
    }
    return {
      key,
      ...info[key],
      weight: WEIGHTS[key],
      available: !!c,
      score: c?.score ?? null,
      ...lean(c?.score ?? null),
      plain: c?.plain ?? 'Not enough data right now.',
      reasons: c?.reasons ?? [],
    };
  });
  if (!wsum) {
    const e = new Error('Could not reach any data source. Check your internet connection and try again.');
    e.sources = sources;
    throw e;
  }
  const score = total / wsum;
  const coverage = wsum;

  const avail = breakdown.filter((b) => b.available);
  const votes = {
    BUY: avail.filter((b) => b.lean === 'BUY').length,
    SELL: avail.filter((b) => b.lean === 'SELL').length,
    NEUTRAL: avail.filter((b) => b.lean === 'NEUTRAL').length,
    total: avail.length,
  };

  // Agreement: share of available weight pointing the same way as the total.
  const agree = avail
    .filter((b) => Math.sign(b.score) === Math.sign(score) && Math.abs(b.score) > 0.05)
    .reduce((a, b) => a + b.weight, 0) / wsum;

  let confidence = Math.min(1, Math.abs(score) / 0.5) * 55 + agree * 35 + coverage * 10;
  const warnings = [];
  if (ff?.risk.imminent.length) {
    confidence *= 0.6;
    warnings.push(
      `High-impact news within 2 hours: ${ff.risk.imminent.map((e) => `${e.country} ${e.title}`).join(', ')}. Expect sharp moves and wider spreads.`
    );
  } else if (ff?.risk.next24h.length) {
    confidence *= 0.85;
    warnings.push(`High-impact news in the next 24h: ${ff.risk.next24h.map((e) => `${e.country} ${e.title}`).join(', ')}.`);
  }
  if (ff?.stale) {
    warnings.push(`ForexFactory is rate-limiting requests; using the calendar saved at ${new Date(ff.fetchedAt).toLocaleTimeString()}.`);
  }
  if (coverage < 0.7) warnings.push('Some data sources were unavailable — signal is based on partial data.');
  const day = new Date().getUTCDay();
  if (day === 6 || (day === 0 && new Date().getUTCHours() < 21)) {
    warnings.push('Markets are closed for the weekend — prices shown are Friday’s close.');
  }
  if (ff && ff.events.length && ff.events.every((e) => e.status === 'released')) {
    warnings.push('All of this week’s ForexFactory events are already out; the calendar refreshes when the new week starts.');
  }

  const action = score >= THRESHOLD ? 'BUY' : score <= -THRESHOLD ? 'SELL' : 'NEUTRAL';
  const price = te?.quote?.price ?? tech?.last ?? null;

  let levels = null;
  if (price && tech?.dailyVolPct && action !== 'NEUTRAL') {
    const move = price * (tech.dailyVolPct / 100);
    const dir = action === 'BUY' ? 1 : -1;
    levels = {
      entry: price,
      stop: price - dir * move * 1.5,
      target1: price + dir * move * 1.5,
      target2: price + dir * move * 3,
      basis: `Based on the ~${tech.dailyVolPct.toFixed(2)}% average daily move over the last 20 days.`,
    };
  }

  const meaning = isCmd
    ? { BUY: `BUY = you profit if the ${pair.meta.noun} price goes up.`, SELL: `SELL = you profit if the ${pair.meta.noun} price goes down.` }
    : { BUY: `BUY ${pair.display} = you profit if ${pair.base} gets stronger against ${pair.quote}.`, SELL: `SELL ${pair.display} = you profit if ${pair.base} gets weaker against ${pair.quote}.` };

  const favoured = action === 'BUY' ? (isCmd ? pair.baseName : pair.base) : isCmd ? 'the US dollar' : pair.quote;
  const summary =
    action === 'NEUTRAL'
      ? `No clear edge on ${pair.display} right now — the signals disagree or are weak. Sitting this one out is a valid choice.`
      : `${votes[action]} of ${votes.total} signals point to ${action}` +
        (votes[action === 'BUY' ? 'SELL' : 'BUY'] ? `, ${votes[action === 'BUY' ? 'SELL' : 'BUY']} to ${action === 'BUY' ? 'SELL' : 'BUY'}` : '') +
        ` — but the ${action} side is stronger. Overall the evidence favours ${favoured}.`;

  return {
    pair: { ...pair, meta: undefined, unit: pair.meta?.unit },
    generatedAt: new Date().toISOString(),
    tookMs: Date.now() - started,
    signal: {
      action,
      score: Math.round(score * 100),
      confidence: Math.round(Math.max(0, Math.min(99, confidence))),
      summary,
      meaning: action === 'NEUTRAL' ? `${meaning.BUY} ${meaning.SELL}` : meaning[action],
      votes,
      warnings,
      levels,
    },
    breakdown,
    price,
    sources,
    data: {
      technicals: tech,
      tradingeconomics: te,
      forexfactory: ff,
      marketwatch: mw && { ...mw, all: mw.all.slice(0, 25) },
    },
  };
}
