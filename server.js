import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './src/engine.js';
import { PAIR_GROUPS, CURRENCIES, COMMODITIES } from './src/currencies.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/meta', (_req, res) => {
  res.json({ groups: PAIR_GROUPS, currencies: Object.keys(CURRENCIES), commodities: Object.values(COMMODITIES).map((c) => ({ symbol: c.symbol, display: c.display, name: c.name })) });
});

app.get('/api/analyze', async (req, res) => {
  try {
    res.json(await analyze(req.query.pair));
  } catch (err) {
    res.status(err.sources ? 502 : 400).json({ error: err.message, sources: err.sources });
  }
});

// Bind to localhost only — this is a personal tool, not a public server.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  FX Signal Dashboard running → http://localhost:${PORT}\n`);
});
