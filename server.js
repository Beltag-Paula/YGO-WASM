// Two-player duel server: your simulator's front end + ocgcore (WebAssembly) rules engine + CardScripts. AGPL-3.0-or-later.
import express from 'express'; import path from 'node:path'; import fs from 'node:fs'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url'; import crypto from 'node:crypto';
import { info, SCRIPTS, searchCards } from './engine.js'; import { Match } from './match.js';
const require = createRequire(import.meta.url); const DeckInventory = require('./DeckInventory.cjs');
const __dirname = path.dirname(fileURLToPath(import.meta.url)); const PORT = process.env.PORT || 3000;
const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, 'views'));
app.use('/images', express.static(path.join(__dirname, 'views', 'images'))); app.use('/static', express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ---- pages ----
app.get('/', (req, res) => res.render('menu', { page: 'home' }));
app.get('/duel', (req, res) => res.render('duel-setup', { page: 'duel' }));
app.get('/duel/play', (req, res) => res.render('duel', { page: 'play' }));

// ---- decks (your deck_inventory, same JSON format) ----
const EXTRA_T = 0x40 | 0x2000 | 0x800000 | 0x4000000; const scriptCache = new Map();
const hasScript = id => { if (!scriptCache.has(id)) scriptCache.set(id, ['official', 'unofficial', ''].some(d => fs.existsSync(path.join(SCRIPTS, d, `c${id}.lua`)))); return scriptCache.get(id); };
const known = id => !!info(id);
function playable(deck) { const all = [...(deck.mainDeck || []), ...(deck.extraDeck || [])].map(c => c.id).filter(known); const main = [], extra = [];
  for (const c of all) ((info(c).type & EXTRA_T) ? extra : main).push(c); return { main: main.slice(0, 60), extra: extra.slice(0, 15), skipped: (deck.mainDeck || []).length + (deck.extraDeck || []).length - all.length }; }
app.get('/api/decks', (req, res) => res.json({ decks: DeckInventory.list((deck) => { const ids = [...new Set([...(deck.mainDeck || []), ...(deck.extraDeck || [])].map(c => c.id))]; const n = ids.filter(hasScript).length; const p = playable(deck);
  return { script: { pct: ids.length ? Math.round(100 * n / ids.length) : 0 }, broken: p.main.length < 10 }; }) }));
app.get('/api/avatars', (req, res) => res.json({ avatars: DeckInventory.avatars(), frames: DeckInventory.frames() }));
app.get('/api/cards/search', (req, res) => { const q = String(req.query.q || '').slice(0, 60); res.json({ cards: q.length < 2 ? [] : searchCards(q) }); });

// ---- card art: fetched by passcode from the same image host your old simulator used, cached in ./pics ----
const ART = process.env.ART_BASE || 'https://images.ygoprodeck.com/images'; const inflight = new Map();
async function artFile(kind, id) { const dir = path.join(__dirname, 'pics', kind === 'c' ? 'cropped' : ''), f = path.join(dir, id + '.jpg'); if (fs.existsSync(f)) return f;
  if (!inflight.has(f)) inflight.set(f, (async () => { try { const r = await fetch(`${ART}/${kind === 'c' ? 'cards_cropped' : 'cards'}/${id}.jpg`, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'ygo-wasm-duel/0.2' } });
    if (!r.ok) return null; fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); return f; } catch { return null; } finally { inflight.delete(f); } })());
  return inflight.get(f); }
const sendArt = kind => async (req, res) => { const m = /^(\d{1,10})\.jpg$/.exec(req.params.file); const f = m && await artFile(kind, m[1]); if (!f) return res.sendStatus(404); res.set('cache-control', 'max-age=604800').type('jpg').send(fs.readFileSync(f)); };
app.get('/pics/c/:file', sendArt('c')); app.get('/pics/:file', sendArt(''));

// ---- matchmaking + duel ----
// Each browser TAB is a player (header x-tab), so two tabs of one browser can duel each other.
const tabOf = req => String(req.get('x-tab') || req.query.tab || 'anon').slice(0, 64);
const waiting = { classic: null, modern: null }; const inMatch = new Map(); // tab -> { match, seat, mode }
const leaveQueue = tab => { for (const k of Object.keys(waiting)) if (waiting[k] && waiting[k].tab === tab) waiting[k] = null; };
app.post('/api/duel/join', (req, res) => { const tab = tabOf(req), b = req.body || {};
  const deck = DeckInventory.readDeck(b.playerDeck); if (!deck) return res.status(400).json({ error: 'Choose your deck first.' });
  const p = playable(deck); if (p.main.length < 10) return res.status(400).json({ error: 'That deck has too few cards the engine knows.' });
  const sum = DeckInventory.summarize(b.playerDeck, deck);
  const me = { tab, main: p.main, extra: p.extra, name: ('' + (b.playerName || sum.ownerName || 'Duelist')).slice(0, 24), deckName: sum.name, avatar: DeckInventory.cleanAvatar(b.playerAvatar) || sum.portrait || null, frame: DeckInventory.cleanFrame(b.playerFrame) || sum.frame || null };
  const mode = b.mode === 'modern' ? 'modern' : 'classic'; inMatch.delete(tab); leaveQueue(tab);
  if (waiting[mode] && waiting[mode].tab !== tab) { const w = waiting[mode], pair = Math.random() < 0.5 ? [w, me] : [me, w]; const match = new Match(pair, { rules: mode }); pair.forEach((pl, seat) => inMatch.set(pl.tab, { match, seat, mode })); waiting[mode] = null; return res.json({ status: 'started', mode }); }
  waiting[mode] = me; res.json({ status: 'waiting', mode }); });
app.get('/api/duel/lobby', (req, res) => { const tab = tabOf(req), m = inMatch.get(tab);
  if (m && !m.match.over) return res.json({ status: 'started', mode: m.mode }); if (Object.values(waiting).some(w => w && w.tab === tab)) return res.json({ status: 'waiting' }); res.json({ status: 'idle' }); });
app.post('/api/duel/leave', (req, res) => { const tab = tabOf(req); leaveQueue(tab); res.json({ ok: true }); });
const getMatch = req => inMatch.get(tabOf(req));
app.get('/api/duel/state', (req, res) => { const m = getMatch(req); if (!m) return res.status(404).json({ error: 'No duel in progress' }); res.json(m.match.act(m.seat, 'state')); });
app.post('/api/duel/act', async (req, res) => { const m = getMatch(req); if (!m) return res.status(404).json({ error: 'No duel in progress' }); const { type, ...payload } = req.body || {};
  try { res.json(await m.match.act(m.seat, String(type || ''), payload)); } catch (e) { console.error(e); res.status(500).json({ error: e.message }); } });
// free the engine memory once a finished duel has sat around for a while
setInterval(() => { for (const [tab, m] of inMatch) if (m.match.over && Date.now() - (m.match.endedAt || (m.match.endedAt = Date.now())) > 600000) { inMatch.delete(tab); } }, 60000);

app.use((err, req, res, next) => { console.error(err); res.status(500).json(req.path.startsWith('/api') ? { error: err.message } : undefined); });
app.listen(PORT, () => console.log(`\nDuel server → http://localhost:${PORT}/   (${DeckInventory.list().length} decks)\nOpen it in two tabs and press "Find opponent" in each.\n`));
