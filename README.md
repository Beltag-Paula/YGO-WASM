# YGO WASM

Two players, two browser tabs.
front end. Every duel runs on EDOPro's `ygopro-core`
(compiled to WebAssembly, `ocgcore.wasm`) with the community Lua card scripts (`CardScripts`).

## Run
Needs Node 22.13 or newer (uses the built-in `node:sqlite`). You need to also clone this first!

    git clone https://github.com/ProjectIgnis/CardScripts
    git clone https://github.com/ProjectIgnis/BabelCDB
    npm install
    node server.js

Open http://localhost:3000, press **Duel**, pick a deck and press **Find Opponent**.
Open the same page in a second tab, pick a deck and press **Find Opponent** there too. The duel starts.
(Different port: `PORT=3001 node server.js`; Windows PowerShell: `$env:PORT=3001; node server.js`.)

## What is where
- `public/`, `views/` front end (duel.js, duel.css, fx.js, sfx.js, frames.js, pages, avatars, frames).
  Small edits only: a per-tab id so two tabs can play each other, waiting for a human opponent without a time limit,
  effect/Extra Deck/declare-a-card menus for engine prompts, and the shake fix below.
- `deck_inventory/`, `DeckInventory.cjs` decks, unchanged. Add more JSON decks there (YGOPRODeck format).
  The FX badge on each deck is the share of its cards that have a script in CardScripts.
- `match.js` turns engine state/messages into what  client expects (views, events, prompts, actions).
- `engine.js`, `prompts.js`, `ocgcore.wasm`, `shim.cpp`, `build.sh` the engine host and the build.
- `server.js` pages, deck API, matchmaking, card art cache.
- `test/apibot.mjs` plays two tabs against each other through the API (`node test/apibot.mjs`, server must be running).

## Card art
Fetched by passcode from images.ygoprodeck.com on first use and cached in `./pics/`.

## Rules notes
- Master Rule 5 **without Extra Monster Zones**: mat has 5 monster zones, so Extra Deck monsters go to the main zones. But will try to change in the future to current format.
- Summon zones are picked automatically (leftmost free zone).
- Not supported yet: counter selection, ritual sum selection, coin/dice displays. If a card needs one the duel
  shows a "Skip" option instead of freezing.
- The "shake" animation used to replace the stage's scale for a moment

## License
MIT License
