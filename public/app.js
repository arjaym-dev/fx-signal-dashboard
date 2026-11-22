const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmtPx = (v) => (v == null ? '—' : v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v >= 20 ? v.toFixed(2) : v >= 0.1 ? v.toFixed(5) : v.toPrecision(5));
const pct = (v, d = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(d)}%`);
const dirClass = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const timeAgo = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};
const LEAN_ICON = { BUY: '▲', SELL: '▼', NEUTRAL: '■', NONE: '–' };

let last = null;
let chart = null;
let commodityNames = {};

/* ---------- theme ---------- */
try {
  const saved = localStorage.getItem('fx-theme');
  if (saved) document.documentElement.dataset.theme = saved;
} catch {}
$('#theme').addEventListener('click', () => {
  const isDark =
    document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = isDark ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('fx-theme', next); } catch {}
  if (last) renderChart(last);
});

/* ---------- market picker (dropdown of chips) ---------- */
const pretty = (sym) => {
  const c = commodityNames[sym];
  return c ? c.display : `${sym.slice(0, 3)}/${sym.slice(3)}`;
};
fetch('/api/meta')
  .then((r) => r.json())
  .then(({ groups, commodities }) => {
    commodityNames = Object.fromEntries(commodities.map((c) => [c.symbol, c]));
    $('#pickerMenu').innerHTML = groups
      .map(
        (g) => `<div class="picker-group"><h4>${esc(g.label)}</h4><div class="chip-row">${g.pairs
          .map((p) => {
            const c = commodityNames[p];
            return `<button class="chip" type="button" role="menuitem" data-pair="${p}">${esc(pretty(p))}${c ? `<small>${esc(c.name)}</small>` : ''}</button>`;
          })
          .join('')}</div></div>`
      )
      .join('');
  })
  .catch(() => {});

const menu = $('#pickerMenu');
const btn = $('#pickerBtn');
function setMenu(open) {
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('.chip.active, .chip')?.focus();
}
btn.addEventListener('click', () => setMenu(menu.hidden));
document.addEventListener('click', (e) => {
  if (!menu.hidden && !e.target.closest('.picker')) setMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menu.hidden) {
    setMenu(false);
    btn.focus();
  }
});
menu.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  $('#pair').value = pretty(chip.dataset.pair);
  setMenu(false);
  generate();
});

$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  generate();
});

/* ---------- tabs ---------- */
$$('.tabs [role="tab"]').forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));
function selectTab(name) {
  $$('.tabs [role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  $$('.panel').forEach((p) => (p.hidden = p.id !== `panel-${name}`));
  if (name === 'chart' && chart) chart.resize(); // canvas sized 0 while its tab was hidden
  try { localStorage.setItem('fx-tab', name); } catch {}
}
try {
  const t = localStorage.getItem('fx-tab');
  if (t && $(`#panel-${t}`)) selectTab(t);
} catch {}

$('#ffHighOnly').addEventListener('change', () => last && renderFF(last));
$('#ffUpcomingOnly').addEventListener('change', () => last && renderFF(last));

/* ---------- generate ---------- */
async function generate() {
  const pair = $('#pair').value.trim();
  if (!pair) return;
  $('#generate').disabled = true;
  $('#empty').hidden = true;
  $('#error').hidden = true;
  $('#loading').hidden = false;
  $('#result').hidden = true;
  try {
    const res = await fetch(`/api/analyze?pair=${encodeURIComponent(pair)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    last = data;
    $('#pair').value = data.pair.display;
    render(data);
    $$('.chip').forEach((c) => c.classList.toggle('active', c.dataset.pair === data.pair.symbol));
    history.replaceState(null, '', `?pair=${data.pair.symbol}`);
  } catch (err) {
    $('#error').innerHTML = `<h3>Couldn't generate a signal</h3><p>${esc(err.message)}</p>`;
    $('#error').hidden = false;
  } finally {
    $('#loading').hidden = true;
    $('#generate').disabled = false;
  }
}

function render(d) {
  $('#result').hidden = false;
  renderSignal(d);
  renderWhy(d);
  renderKpis(d);
  renderChart(d);
  renderTechnicals(d);
  renderTE(d);
  renderFF(d);
  renderMW(d);
}

/* ---------- signal card ---------- */
function renderSignal(d) {
  const s = d.signal;
  const headline = { BUY: 'BUY', SELL: 'SELL', NEUTRAL: 'WAIT' }[s.action];
  const sub = { BUY: 'Evidence leans bullish', SELL: 'Evidence leans bearish', NEUTRAL: 'No clear edge' }[s.action];
  const pos = Math.max(-100, Math.min(100, s.score));
  const fillStyle = pos >= 0 ? `left:50%;width:${pos / 2}%;background:var(--bull)` : `right:50%;width:${-pos / 2}%;background:var(--bear)`;
  const L = s.levels;
  const v = s.votes;
  const names = { forexfactory: 'ForexFactory', marketwatch: 'MarketWatch', tradingeconomics: 'TradingEconomics', prices: 'Price history' };
  const confWord = s.confidence >= 70 ? 'High' : s.confidence >= 45 ? 'Medium' : 'Low';

  $('#signalCard').innerHTML = `
    <div class="pairline">
      <span class="pairname">${esc(d.pair.display)}${d.pair.unit ? ` <span class="muted small">${esc(d.pair.unit)}</span>` : ''}</span>
      <span class="price num">${fmtPx(d.price)}</span>
    </div>
    <div class="muted small">Updated ${new Date(d.generatedAt).toLocaleTimeString()} · ${d.tookMs} ms</div>
    <div class="verdict ${s.action}">
      <span class="icon" aria-hidden="true">${LEAN_ICON[s.action]}</span>
      <div>
        <div class="action">${headline}</div>
        <div class="small"><b>${sub}.</b> ${esc(s.summary)}</div>
      </div>
    </div>
    <p class="meaning">💡 ${esc(s.meaning)}</p>
    <div class="votes" aria-label="How the signals voted">
      ${v.BUY ? `<span class="vote BUY">▲ ${v.BUY} say BUY</span>` : ''}
      ${v.SELL ? `<span class="vote SELL">▼ ${v.SELL} say SELL</span>` : ''}
      ${v.NEUTRAL ? `<span class="vote">■ ${v.NEUTRAL} neutral</span>` : ''}
    </div>
    <div class="stats-row">
      <div class="stat"><div class="label">Overall score</div><div class="value num">${s.score > 0 ? '+' : ''}${s.score}</div></div>
      <div class="stat"><div class="label">Confidence</div><div class="value num">${s.confidence}% <span class="small muted">${confWord}</span></div>
        <div class="conf-bar" aria-hidden="true"><i style="width:${s.confidence}%"></i></div></div>
    </div>
    <div class="meter" role="img" aria-label="Score ${s.score} on a scale from -100 sell to +100 buy">
      <div class="meter-track"><div class="meter-fill" style="${fillStyle}"></div><div class="meter-mid"></div></div>
      <div class="meter-labels"><span>◀ SELL side</span><span>0</span><span>BUY side ▶</span></div>
    </div>
    ${L ? `<details class="levels-wrap" open><summary>Reference trade levels</summary>
        <div class="levels">
          <div><div class="label">Entry ≈</div><div class="value num">${fmtPx(L.entry)}</div></div>
          <div><div class="label">Stop-loss</div><div class="value num">${fmtPx(L.stop)}</div></div>
          <div><div class="label">Target 1</div><div class="value num">${fmtPx(L.target1)}</div></div>
          <div><div class="label">Target 2</div><div class="value num">${fmtPx(L.target2)}</div></div>
        </div><div class="muted small" style="margin-top:4px">${esc(L.basis)} Adjust to your own plan.</div></details>` : ''}
    ${s.warnings.length ? `<ul class="warnings">${s.warnings.map((w) => `<li>⚠ ${esc(w)}</li>`).join('')}</ul>` : ''}
    <div class="sources">${Object.entries(d.sources)
      .map(([k, src]) => `<span class="src ${src.ok && !src.error ? 'ok' : 'fail'}" title="${esc(src.error || src.label || 'OK')}">${names[k]}</span>`)
      .join('')}</div>`;
}

/* ---------- beginner "Why?" breakdown ---------- */
function renderWhy(d) {
  const s = d.signal;
  const title = s.action === 'NEUTRAL' ? 'Why no clear signal?' : `Why ${s.action}?`;
  const factors = d.breakdown
    .map((b) => {
      if (!b.available) {
        return `<div class="factor na"><div class="factor-top"><span class="ico" aria-hidden="true">${b.icon}</span>
          <div><div class="ttl">${esc(b.title)}</div><div class="q">${esc(b.question)}</div></div>
          <span class="pill">No data</span></div><p class="muted">${esc(b.plain)}</p></div>`;
      }
      const v = Math.round(b.score * 100);
      const fill = v >= 0 ? `left:50%;width:${v / 2}%;background:var(--bull)` : `right:50%;width:${-v / 2}%;background:var(--bear)`;
      const pill = b.lean === 'NEUTRAL' ? '■ Neutral' : `${LEAN_ICON[b.lean]} ${b.strength} ${b.lean}`;
      return `<div class="factor">
        <div class="factor-top">
          <span class="ico" aria-hidden="true">${b.icon}</span>
          <div><div class="ttl">${esc(b.title)}</div><div class="q">${esc(b.question)}</div></div>
          <span class="pill ${b.lean}">${pill}</span>
        </div>
        <p>${esc(b.plain)}</p>
        <div class="tug" role="img" aria-label="${esc(b.title)} leans ${b.lean.toLowerCase()} (${v})">
          <span>SELL</span><div class="tug-track"><div class="fill" style="${fill}"></div><div class="mid"></div></div><span>BUY</span>
        </div>
        <div class="factor-foot">
          <span>Counts for ${Math.round(b.weight * 100)}% of the signal</span>
          <details><summary>Show the numbers</summary><ul>${b.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>
        </div>
      </div>`;
    })
    .join('');

  $('#whyCard').innerHTML = `
    <div class="why-head"><h3>${title}</h3><span class="muted small">Each signal explained in plain English</span></div>
    <div class="why-list">${factors}</div>
    <details class="guide">
      <summary>New to trading? How to read this</summary>
      <dl>
        <dt>BUY / SELL / WAIT</dt>
        <dd>The overall lean after weighing all the signals. WAIT means the signals disagree, and staying out is often the smart move.</dd>
        <dt>Overall score (−100 to +100)</dt>
        <dd>Below −15 leans SELL, above +15 leans BUY. The further from 0, the stronger the lean.</dd>
        <dt>Confidence</dt>
        <dd>Higher when the signals agree with each other and all data loaded. It drops before big scheduled news, because prices can jump unpredictably.</dd>
        <dt>Bars (SELL ◀ ▶ BUY)</dt>
        <dd>Show which way each signal pulls and how hard. Signals with a bigger % count more.</dd>
        <dt>Stop-loss &amp; targets</dt>
        <dd>A stop-loss closes the trade automatically if price goes against you, which limits the loss. Targets are where you might take profit. These are sized from the market's normal daily movement.</dd>
        <dt>Before you trade</dt>
        <dd>This is a summary of public information, not a guarantee. Check the chart, size your position so a stop-out is a small loss, and avoid trading right before high-impact news.</dd>
      </dl>
    </details>`;
}

/* ---------- KPIs ---------- */
function renderKpis(d) {
  const q = d.data.tradingeconomics?.quote || {};
  const t = d.data.technicals || {};
  const m = d.data.tradingeconomics?.macro || {};
  const rate = (c) => m[c]?.interestRate?.last;
  const tiles = [
    { label: 'Today', value: pct(q.dayPct), cls: dirClass(q.dayPct), sub: 'Latest session change' },
    { label: 'Past month', value: pct(q.monthPct ?? t.change20d), cls: dirClass(q.monthPct ?? t.change20d), sub: 'Price change' },
    { label: `${q.quarterLabel || 'Quarter'} forecast`, value: fmtPx(q.quarterForecast), sub: q.quarterForecast && q.price ? `${pct((q.quarterForecast / q.price - 1) * 100)} vs now` : 'TradingEconomics' },
    { label: 'Typical daily move', value: t.dailyVolPct ? `${t.dailyVolPct.toFixed(2)}%` : '—', sub: t.dailyVolPct && d.price ? `≈ ${fmtPx((d.price * t.dailyVolPct) / 100)} per day` : '20-day average' },
  ];
  if (d.pair.type === 'fx') {
    tiles.push({
      label: 'Interest-rate gap',
      value: rate(d.pair.base) != null && rate(d.pair.quote) != null ? `${(rate(d.pair.base) - rate(d.pair.quote)).toFixed(2)} pts` : '—',
      sub: `${d.pair.base} ${rate(d.pair.base) ?? '—'}% · ${d.pair.quote} ${rate(d.pair.quote) ?? '—'}%`,
    });
  }
  $('#kpis').innerHTML = tiles
    .map((k) => `<div class="card kpi"><div class="label">${esc(k.label)}</div><div class="value num ${k.cls || ''}">${esc(k.value)}</div><div class="sub">${esc(k.sub)}</div></div>`)
    .join('');
}

/* ---------- chart tab ---------- */
function renderChart(d) {
  const t = d.data.technicals;
  if (chart) chart.destroy();
  chart = null;
  if (!t) {
    $('#chartNote').textContent = 'Price history unavailable';
    return;
  }
  $('#chartNote').textContent = `Daily closes · ${d.sources.prices.label || ''}`;
  const pts = t.chart;
  const ink = cssVar('--text-muted');
  const series = [
    { label: 'Close', key: 'close', color: cssVar('--series-1') },
    { label: '20-day avg', key: 'sma20', color: cssVar('--series-2') },
    { label: '50-day avg', key: 'sma50', color: cssVar('--series-3') },
  ];
  chart = new Chart($('#priceChart'), {
    type: 'line',
    data: {
      labels: pts.map((p) => p.date),
      datasets: series.map((s) => ({
        label: s.label,
        data: pts.map((p) => p[s.key]),
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBorderColor: cssVar('--surface-1'),
        pointHoverBorderWidth: 2,
        tension: 0.15,
        spanGaps: true,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { color: ink, boxWidth: 14, boxHeight: 3, font: { size: 12 } } },
        tooltip: {
          backgroundColor: cssVar('--surface-2'),
          titleColor: cssVar('--text-primary'),
          bodyColor: cssVar('--text-secondary'),
          borderColor: cssVar('--border'),
          borderWidth: 1,
          callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y == null ? '—' : fmtPx(c.parsed.y)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: ink, maxTicksLimit: innerWidth < 600 ? 4 : 8, maxRotation: 0 } },
        y: { grid: { color: cssVar('--grid') }, border: { display: false }, ticks: { color: ink, callback: (v) => fmtPx(v) } },
      },
    },
  });

  $('#priceTable').innerHTML = `<table><thead><tr><th>Date</th><th class="r">Close</th><th class="r">20-day avg</th><th class="r">50-day avg</th></tr></thead><tbody>${pts
    .slice()
    .reverse()
    .map((p) => `<tr><td>${p.date}</td><td class="r num">${fmtPx(p.close)}</td><td class="r num">${fmtPx(p.sma20)}</td><td class="r num">${fmtPx(p.sma50)}</td></tr>`)
    .join('')}</tbody></table>`;
}

function renderTechnicals(d) {
  const t = d.data.technicals;
  if (!t) {
    $('#technicals').innerHTML = `<p class="muted">Unavailable: ${esc(d.sources.prices.error)}</p>`;
    return;
  }
  const px = d.price ?? t.last;
  const rsiNote = t.rsi14 > 70 ? 'Overbought (rose fast)' : t.rsi14 < 30 ? 'Oversold (fell fast)' : 'Neutral';
  const rows = [
    ['20-day average', fmtPx(t.sma20), px > t.sma20 ? 'Price is above' : 'Price is below'],
    ['50-day average', fmtPx(t.sma50), t.sma20 > t.sma50 ? 'Uptrend (20 > 50)' : 'Downtrend (20 < 50)'],
    ['RSI (14)', t.rsi14?.toFixed(1), rsiNote],
    ['5-day change', pct(t.change5d), ''],
    ['20-day change', pct(t.change20d), ''],
    ['20-day high', fmtPx(t.high20), 'Resistance'],
    ['20-day low', fmtPx(t.low20), 'Support'],
    ['Typical daily move', `${t.dailyVolPct.toFixed(2)}%`, '20-day'],
  ];
  $('#technicals').innerHTML = `<table><tbody>${rows
    .map(([a, b, c]) => `<tr><td>${a}</td><td class="r num"><b>${esc(b)}</b></td><td class="muted small">${esc(c)}</td></tr>`)
    .join('')}</tbody></table>`;
}

/* ---------- fundamentals tab ---------- */
function renderTE(d) {
  const te = d.data.tradingeconomics;
  if (!te) {
    $('#te').innerHTML = `<p class="muted">Unavailable: ${esc(d.sources.tradingeconomics.error)}</p>`;
    $('#teLink').hidden = true;
    return;
  }
  const q = te.quote;
  $('#teLink').hidden = !q?.url;
  if (q?.url) $('#teLink').href = q.url;

  const forecastLine = q
    ? `<p class="small">${esc(d.pair.display)} <b>${fmtPx(q.price)}</b>${q.invertedFrom ? ` (derived from ${esc(q.invertedFrom)})` : ''}
        ${q.quarterForecast ? ` · ${esc(q.quarterLabel || 'Quarter-end')} forecast <b>${fmtPx(q.quarterForecast)}</b>` : ''}
        ${q.yearForecast ? ` · 12-month forecast <b>${fmtPx(q.yearForecast)}</b>` : ''}</p>`
    : `<p class="muted small">Quote unavailable: ${esc(te.quoteError)}</p>`;

  const block = (code, label) => {
    const c = te.countries[code];
    const m = te.macro[code];
    const rows = m?.rows?.length
      ? `<table><thead><tr><th>Indicator</th><th class="r">Last</th><th class="r">Prev</th><th>Ref</th></tr></thead><tbody>${m.rows
          .map((r) => {
            const ch = r.last != null && r.previous != null ? Math.sign(r.last - r.previous) : 0;
            return `<tr><td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)}</td>
              <td class="r num"><b>${r.last ?? '—'}</b> ${ch > 0 ? '↑' : ch < 0 ? '↓' : ''}</td><td class="r num">${r.previous ?? '—'}</td><td class="small muted">${esc(r.reference)}</td></tr>`;
          })
          .join('')}</tbody></table>`
      : '<p class="muted small">No indicator table found.</p>';
    return `<div class="te-ccy">
      <h4>${esc(label)} ${c ? `· <a class="small" href="${esc(c.url)}" target="_blank" rel="noopener">source ↗</a>` : ''}</h4>
      <p>${c?.narrative ? esc(c.narrative) : '<span class="muted">No analyst summary available.</span>'}</p>
      ${rows}
    </div>`;
  };
  $('#te').innerHTML = `${forecastLine}
    <div class="te-grid">${block(d.pair.base, d.pair.baseName)}${block(d.pair.quote, d.pair.quoteName)}</div>`;
}

/* ---------- calendar tab ---------- */
function renderFF(d) {
  const ff = d.data.forexfactory;
  if (!ff) {
    $('#ff').innerHTML = `<p class="muted">Unavailable: ${esc(d.sources.forexfactory.error)}</p>`;
    $('#ffNote').textContent = '';
    $('#calCount').textContent = '';
    return;
  }
  const upcoming = ff.events.filter((e) => e.status === 'upcoming').length;
  $('#calCount').textContent = upcoming ? `${upcoming} upcoming` : '';
  $('#ffNote').textContent = ff.note;
  let ev = ff.events;
  if ($('#ffHighOnly').checked) ev = ev.filter((e) => e.impact === 'High');
  if ($('#ffUpcomingOnly').checked) ev = ev.filter((e) => e.status === 'upcoming');
  if (!ev.length) {
    $('#ff').innerHTML = '<p class="muted">No events match.</p>';
    return;
  }
  $('#ff').innerHTML = `<table><thead><tr><th>When (local)</th><th>For</th><th>Impact</th><th>Event</th><th class="r">Forecast</th><th class="r">Previous</th><th>What it suggests</th><th>Status</th></tr></thead><tbody>${ev
    .map((e) => {
      const when = new Date(e.date);
      const tag = e.bias > 0 ? 'pos' : e.bias < 0 ? 'neg' : '';
      const arrow = e.bias > 0 ? '▲ ' : e.bias < 0 ? '▼ ' : '';
      const status =
        e.status === 'upcoming'
          ? `<span class="tag">in ${e.hoursAway < 24 ? `${e.hoursAway}h` : `${Math.round(e.hoursAway / 24)}d`}</span>`
          : '<span class="muted small">released</span>';
      return `<tr class="${e.status}">
        <td class="num">${when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
        <td><b>${esc(e.currency)}</b></td>
        <td><span class="impact ${esc(e.impact)}"><i></i>${esc(e.impact)}</span></td>
        <td>${esc(e.title)}</td>
        <td class="r num">${esc(e.forecast) || '—'}</td>
        <td class="r num">${esc(e.previous) || '—'}</td>
        <td><span class="tag ${tag}">${arrow}${esc(e.biasNote)}</span></td>
        <td>${status}</td></tr>`;
    })
    .join('')}</tbody></table>`;
}

/* ---------- news tab ---------- */
function renderMW(d) {
  const mw = d.data.marketwatch;
  if (!mw) {
    $('#mw').innerHTML = `<p class="muted">Unavailable: ${esc(d.sources.marketwatch.error)}</p>`;
    $('#mwTone').textContent = '';
    $('#mwNote').textContent = '';
    $('#newsCount').textContent = '';
    return;
  }
  $('#mwTone').textContent = `Market mood: ${mw.riskLabel} · ${mw.totalRecent} recent headlines`;
  $('#mwNote').textContent = mw.note;
  $('#newsCount').textContent = mw.relevant.length ? `${mw.relevant.length} relevant` : '';
  const relevantLinks = new Set(mw.relevant.map((r) => r.link));
  const list = [...mw.relevant, ...mw.all.filter((a) => !relevantLinks.has(a.link))];
  if (!list.length) {
    $('#mw').innerHTML = '<p class="muted">No recent headlines.</p>';
    return;
  }
  $('#mw').innerHTML = `<ul class="news">${list
    .map((n) => {
      const tag = n.sentiment > 0 ? 'pos' : n.sentiment < 0 ? 'neg' : '';
      const label = n.sentiment > 0 ? '▲ Positive' : n.sentiment < 0 ? '▼ Negative' : 'Neutral';
      const mentions = Object.entries(n.currencies || {})
        .filter(([, k]) => k.length)
        .map(([c]) => c);
      const why = [...mentions.map((c) => `mentions ${c}`), n.isMarket ? 'market-wide' : '', relevantLinks.has(n.link) ? '' : 'not used in score'].filter(Boolean);
      return `<li>
        <span class="tag ${tag}">${label}</span>
        <div>
          <a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
          <div class="meta">${timeAgo(n.time)} · ${esc(n.feed)}${why.length ? ` · ${esc(why.join(' · '))}` : ''}</div>
        </div></li>`;
    })
    .join('')}</ul>`;
}

// Deep link: http://localhost:3000/?pair=GBPJPY generates immediately (handy for bookmarks).
const initialPair = new URLSearchParams(location.search).get('pair');
if (initialPair) {
  $('#pair').value = initialPair;
  generate();
}
