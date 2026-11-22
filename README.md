# FX Signal Dashboard

A small web app that runs on your own computer. Pick a market from **Markets ▾** (or type one, e.g. `EUR/USD`, `gold`, `oil`), press **Generate**, and it:

1. Pulls data from **ForexFactory**, **MarketWatch** and **TradingEconomics**
2. Gives a **BUY / SELL / NEUTRAL** bias with a score and a confidence level
3. Explains **why** in plain English: each of the five signals says which way it leans, how strongly, and what that means
4. Keeps the detail in tabs (**Chart · Fundamentals · Calendar · News**) so the page stays easy to scan

> ⚠️ This is a decision-support tool, not financial advice. The signal is a rule-based summary of public data and **can be wrong**. Always confirm with your own chart work and risk management.

---

## 1. One-time setup

### Step 1 — Install Node.js (skip if you already have it)

The app runs on Node.js version 18 or newer.

- Check if you already have it: open **Terminal** and run
  ```bash
  node -v
  ```
  If you see something like `v20.x` or `v22.x`, you're good. Skip to Step 2.
- If not, install it:
  - **macOS (with Homebrew):** `brew install node`
  - **macOS / Windows (installer):** download the **LTS** version from <https://nodejs.org> and run it.
  - Close and reopen Terminal, then run `node -v` again to confirm.

### Step 2 — Install the app's dependencies

```bash
cd /Users/greytech/arjay/fx-signal-dashboard
npm install
```

You only need to do this once (or again after pulling new changes).

---

## 2. Run it

```bash
cd /Users/greytech/arjay/fx-signal-dashboard
npm start
```

You'll see:

```
  FX Signal Dashboard running → http://localhost:3000
```

Open **http://localhost:3000** in your browser. To stop the app, go back to Terminal and press `Ctrl + C`.

**Tips**

- Port 3000 already in use? Start on another port: `PORT=3050 npm start`
- Bookmark a pair to load it right away: `http://localhost:3000/?pair=GBPJPY`
- Supported currencies: USD, EUR, GBP, JPY, AUD, NZD, CAD, CHF, CNY, MXN, ZAR, SEK, NOK, SGD, HKD, INR, PLN, TRY. Any two make a pair. `EURUSD`, `eur/usd` and `EUR USD` all work.
- Commodities (all against USD): **gold** (`XAU/USD`, `gold`), **silver** (`XAG/USD`, `silver`), **WTI crude oil** (`WTI/USD`, `oil`, `USOIL`) and **Brent crude oil** (`BRENT/USD`, `brent`, `UKOIL`).
- The server only listens on your own machine (`127.0.0.1`), so other people on your network can't open it.

---

## 3. Where the data comes from

| Source | What we use | How |
|---|---|---|
| **ForexFactory** | This week's economic calendar: impact, forecast and previous values | ForexFactory's official weekly JSON export |
| **TradingEconomics** | Live quote, day/month/year change, quarter-end and 12-month forecasts, analyst summary, interest rate, inflation, unemployment | Public pair and country pages |
| **MarketWatch** | Recent headlines (last 7 days) | MarketWatch's official RSS feeds |
| ECB reference rates (via frankfurter.app) | Daily closes for currency pairs (chart + technicals) | Free API, no key |
| CoinGecko | Daily closes for gold and silver, via gold- and silver-backed tokens (PAX Gold, Kinesis Silver) that track the spot price | Free API, no key |
| US EIA | Daily WTI and Brent spot prices | Official public data (published weekly, so the latest TradingEconomics price is added as the newest point) |

If a source is down, the app still works with the others. The status chips on the signal card show ✓ or ✕ for each source.

---

## 4. How the signal is calculated

Each component scores from **−1 (favours the quote currency → SELL)** to **+1 (favours the base currency → BUY)**:

| Component | Weight | What it looks at |
|---|---|---|
| Price action & technicals | 30% | Price vs 20-day average, 20- vs 50-day trend, 5-day momentum, latest session, RSI(14) overbought/oversold |
| TradingEconomics forecast | 20% | How far the quarter-end and 12-month forecasts are from the current price |
| ForexFactory calendar | 20% | Whether consensus expects each currency's data to improve or deteriorate (forecast vs previous, weighted by impact). For commodities, strong US data = stronger dollar = bearish; crude inventory reports count directly for oil |
| Rates & inflation | 15% | **Currencies:** interest-rate and real-rate differential. **Gold/silver:** US real interest rate (high real rates make non-yielding metals less attractive). **Oil:** latest US crude stockpile change (rising stockpiles = more supply = bearish) |
| MarketWatch news | 15% | Keyword sentiment on headlines that mention each currency, plus market-wide risk-on/risk-off tone (e.g. risk-off tends to help JPY/CHF/USD) |

- Weighted score **≥ +15 → BUY**, **≤ −15 → SELL**, otherwise **NEUTRAL** (no clear edge).
- **Confidence** rises when the score is strong, most components agree, and every source responded. It drops when a high-impact ForexFactory event is due within 24 hours, and drops further within 2 hours.
- **Entry / stop / targets** are reference levels based on the pair's average daily move (stop = 1.5×, targets = 1.5× and 3×). Adjust them to your own strategy.

All weights and thresholds live at the top of `src/engine.js` if you want to tune them.

---

## 5. Known limitations

- **ForexFactory's feed has no "actual" values**, only forecast and previous. The calendar component measures what the market *expects* and flags upcoming event risk; it can't react to a release the moment it prints.
- **ForexFactory rate-limits the feed.** The app saves it to `.cache/` and refreshes at most every 30 minutes. If it's rate-limited, the app falls back to the saved copy and tells you.
- **The feed only covers the current week** (it rolls over during the weekend).
- **Gold and silver history comes from metal-backed tokens** that track spot closely but not perfectly. Oil history from the EIA lags about a week; the current TradingEconomics price fills the gap.
- **Price history is daily**, so the technicals suit an intraday *bias*, not exact entry timing. Time your entries on your trading platform's intraday chart.
- **News sentiment is keyword-based** and MarketWatch's feeds are general-market, so most headlines don't mention a specific currency. The risk-on/off tone is usually the useful part.
- TradingEconomics and MarketWatch can change their pages or feeds. If a source starts showing ✕, the parser in `src/sources/` may need an update.

---

## 6. Project layout

```
fx-signal-dashboard/
├── server.js                 # Express server (localhost only) + /api/analyze
├── src/
│   ├── engine.js             # Combines everything into the BUY/SELL/NEUTRAL signal
│   ├── currencies.js         # Supported currencies + commodities, keywords, pair parsing
│   ├── http.js               # fetch helper, in-memory cache, HTML/entity utilities
│   └── sources/
│       ├── forexfactory.js   # Calendar feed + consensus scoring + event risk
│       ├── tradingeconomics.js # Quote, forecasts, narrative, macro table
│       ├── marketwatch.js    # RSS headlines + sentiment
│       └── prices.js         # Daily history (ECB / CoinGecko / EIA) + SMA / RSI / volatility
└── public/                   # The dashboard (HTML/CSS/JS + Chart.js)
```

API: `GET /api/analyze?pair=EURUSD` returns the full JSON behind the dashboard.
