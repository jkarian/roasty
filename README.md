# Roasty Duck — "Draw something. Regret it."

An anxious duck gallery owner watches you draw, guesses what it is, and
narrates his slow unraveling. The character is the product.

## Run it

```bash
npm install
npm run keys        # pulls keys.txt into .env (or copy .env.example -> .env)
npm run pregen      # one-time: cuts the free audio library (~9.4k characters)
npm start           # http://localhost:8787
```

The console prints a `phone` URL for the same Wi-Fi. Touch drawing already works.

### Scripts

| command | what it does |
|---|---|
| `npm start` | serve the game + relay both APIs |
| `npm run pregen` | cut every knowable line to `public/audio/*.mp3` |
| `npm run pregen -- --dry-run` | show the character bill, write nothing |
| `npm run pregen -- --verify` | bin clips too short to be real speech, so they get re-cut |
| `npm run probe` | synthesise one line, to audition voice settings |
| `npm run keys` | merge `keys.txt` into `.env` |

### Dev tools

`?dev=1` turns on the **audio ticker** — an on-screen tape of every audio event
in the last 30s, colour-coded by layer, with live density (`0.43/s`) and the
longest silence. It is the instrument for tuning presence; read it, don't guess.

`?selftest=1` proves the Claude text and vision calls on boot.

`window.__roasty` in the console:

| call | what it gives you |
|---|---|
| `.latency()` | per-moment stroke→first-audio, split by stage |
| `await .audioHealth()` | decodes every clip (library + tts cache), reports short/near-silent ones |
| `await .audioHealth({delete:true})` | ...and bins the bad ones so pregen re-cuts them |
| `.ticker` | `.show()` / `.hide()`, `.events`, `.densityPerSec()` |
| `.S`, `.audio`, `.bible`, `.JOKES` | live game state |

The health check decodes through WebAudio rather than reading file sizes — a
silent CBR mp3 is exactly as big as a spoken one, so only real amplitude can
tell them apart.

## Layout

- `server.js` — serves the page, relays Claude and ElevenLabs. Keys never leave it.
- `lib/config.mjs` — `.env` loading and every tunable knob
- `lib/eleven.mjs` — one TTS code path for both live lines and the pre-gen script
- `public/js/lines.js` — every fixed line, shared by the browser and the scripts
- `public/js/audio.js` — library playback (WebAudio) + live streaming (`<audio>`)
- `public/js/app.js` — the game. Ported from the POC; prompts and timings verbatim.
- `scripts/pregen-audio.mjs` — the one-time audio library cutter
- `poc/roasty-poc.html` — the original artifact-era prototype, kept for reference
- `docs/roasty-bible.md` — THE character. Served to the app at `/api/bible`.
- `docs/voice.md` — canonical ElevenLabs voice (ID inside)
- `docs/roasty-voice-brief.md` — how the voice was designed/auditioned
- `docs/words.md` — tiered word list. **The source of truth**: parsed at boot
  from `/api/words`, so adding a word is a file edit and a refresh, no code
  change. Headings map `Easy`→easy, `Medium`→medium, `Hard objects` +
  `Concepts`→hard (both are "streak 3+, mixed in", so `pickWord` is unchanged).
  Entries may wrap across lines; escaped markdown (`\#`) is tolerated.
- `docs/cc-kickoff.md` — first Claude Code session brief

## How a round talks

Three layers, cheapest first:

1. **Murmurs and reflexes** — algorithmic, pre-generated .mp3, zero latency, zero cost.
   Fired by stroke shape (circle / line / scribble / dot / big) and by silence.
2. **The vamp** — the instant "Wait. What is that." that buys the AI its time.
   Also a local file.
3. **The AI line** — blind Guesser (vision, doesn't know the word) → Writer (the
   bible). Only these ever hit live TTS. Synthesis starts the moment the line
   lands and streams as it renders.

The closing roast is the one line allowed a slower, richer model (`profile=rich`).

## Latency budget (measured in-game, localhost)

Median **stroke → first audio of the AI line: ~4.9s**. Target is 2.5s; not met.
Where it goes:

| stage | ms | notes |
|---|---:|---|
| wait (stroke → guess moment fires) | ~250–590 | trigger timing, fixed |
| Guesser | ~2100–2550 | Haiku 4.5, the fastest model available |
| Writer | ~1700–2900 | Sonnet 5, bible prefix prompt-cached (`cache HIT 2616`) |
| TTS first sound | ~300 | flash v2.5 streaming |
| **total** | **~4.7–6.3s** | |
| library clip | 0 | pre-generated, decoded locally |

The two model calls own ~90% of the budget and are strictly sequential — the
Writer needs the Guesser's verdict. The remaining levers both touch things that
are currently off-limits: the Guesser prompt asks for four fields (~200 output
tokens; roughly half the call), and the Writer returns three candidates. Cutting
either would close most of the gap, but that is a prompt change and belongs in a
play-testing round, not a refactor.

The vamp covers the wait, and the murmur layer now fills the gap behind it —
which is why the *perceived* silence is ~3.4s at worst, not 6s. Every live line
is banked to `cache/tts/`, so the same sentence is instant the second time.

## Modes

Picked on the start screen; `?mode=classic|director` also works, and the choice
is remembered.

**Classic** — he gives you a word and guesses what you drew. Unchanged.

**Roasty Directs** (experimental) — the inversion. He picks the picture, writes
the steps, and talks you through it one shape at a time. A blind judge marks the
result at the end, so you both win or you both don't. 45s.

```
plan (1 call)  ->  instruct  ->  [pause 2s]  ->  comply check  ->  react
                       ^                                            |
                       +--------- advance / repair / move on -------+
                                                                    v
                                                    blind judge -> mutual verdict
```

- `docs/roasty-director-bible.md` — his rules while directing. Served at
  `/api/bible?mode=director`, editable like the main one. **v0 draft, untested
  in play** — the session brief referenced rules that did not arrive, so these
  are written from the main bible's voice and need a tuning pass.
- The plan never names the subject; any leak is scrubbed before it is spoken.
- One repair per step, maximum. Then "Fine. FINE. Moving on."
- Drawing nothing is itself a reaction — he notices being ignored, and it costs
  no vision call.
- Everything else is borrowed from Classic: voice pipeline, murmurs, vamps, the
  composure ladder, bleeps. Joke-log lines are tagged `mode:director`.

Director Mode lives entirely in `public/js/director.js` and takes its shared
machinery through an injected context. It never reaches into Classic's round
flow — the only edits in `app.js` are the picker, a dispatcher on the two start
buttons, and a `mode` field on the joke log.

## The composure ladder

Which canned pool he draws from is the clock's decision, not the writer's:

| seconds left | tier | tone |
|---|---|---|
| 20+ | `early` | composed, patient — "Take a beat. It's fine. We have time." |
| 19–10 | `mid` | blunter, less patient — "Why do you keep making circles." |
| under 10 | `late` | blunt and desperate — "STOP. You're making it WORSE." |

One selector, `tierFor(secondsLeft)` in `lines.js`, drives both the murmur and
reflex pools. `urge1/2/3` stay flat: they are already a composure ladder,
climbing by how many times he has had to ask for a first mark.

The same three-way split is passed to the writer as the **first line** of the
moment block, ahead of the history, so his written lines climb the same ladder.

### The bleep

A line may contain the literal token `[BLEEP]`. The word itself is never
written, never synthesised and never stored:

- **audio** — the line is split on the token; the speakable halves play as
  normal clips and a 1kHz censor tone is generated locally in between.
- **screen** — the bubble shows `%#@!`.
- **library** — bleeped canned lines are baked as their speakable halves only.
- **writer** — any candidate containing real profanity is dropped before it can
  reach the screen or the voice, and `/api/tts` refuses to synthesise it as a
  last line of defence. Word-boundary matched, so "class" and "Scunthorpe"
  survive.

Five bleeped clips live in the `late` murmur pool. **The writer will not emit
`[BLEEP]` on its own** — nothing in the bible tells it the token exists. Adding
that line to `docs/roasty-bible.md` is a character change, so it belongs in a
play-testing round.

## Presence

While the pen is moving he makes a noise every 2–4s. Measured over a full round
of continuous drawing: 6 murmurs, gaps 2.54 / 3.71 / 5.39 / 2.27 / 2.33s, none
under 2s, longest total silence 3.43s. The 5.39s outlier is an AI line playing —
the one thing allowed to hold the murmur layer back.

## Core principles learned in tuning

1. Presence over punchlines: murmurs/reflex chatter constantly, jokes as spikes.
2. Ground every joke in a visible detail. Comparisons are the signature weapon.
3. Examples teach shapes, never phrases. Repetition is death.
4. The thread: one continuous conversation about one evolving drawing.
5. He roasts the drawing, never the person.
