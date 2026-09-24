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
  Drawing/realtime mode only (Classic + Director).
- `docs/roasty-wall-label-bible.md` — Wall Label Roasty (Instagram). Separate
  mode, separate file, served at `/api/bible?mode=walllabel`. See below.
- `public/label.html`, `public/js/label.js`, `public/label/quack.wav` — the
  Wall Label test bench at `/label`
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

## Wall Label Roasty (`/label` bench)

A new format, separate from the drawing game. The MVP: you drop in your own
clip, Roasty narrates a short "film" about it, and the bench renders a video
to post on Instagram and TikTok. Later, people tag @roastytheduck themselves. The character rules are in
`docs/roasty-wall-label-bible.md`; this section is how the bench works and
where we left off.

**The voice (per the bible):** a 1950s American educational-film narrator,
cheerfully authoritative, observing the human like a naturalist. Script order:
opening beat (naturalist observation) → title card → who made it → where/when
(invented habitat names, never real place names) → materials → measurement →
the lesson → where it came from → asking price. Bite, delivery tags
(`[curious] [whispers] [amused] [sighs] [excited]`, 2–4 per script), pauses,
and at most one character break (`[QUACK]` or a duck exclamation, then
"Pardon me." and carry on).

**Why it's a separate file:** `/api/bible` serves the whole file and the
drawing Writer sends it as-is every call, so anything added to
`roasty-bible.md` goes live in drawing mode. Director Mode already solved this
with its own file; Wall Label copies that pattern. The one line added to
`roasty-bible.md` (a mode label) sits above "YOU ARE ROASTY", which the server
strips, so the drawing prompt is byte-identical to before.

**The bench, step by step:**
1. Drop one image, or a video under 60s. Images are downscaled to 1568px.
   Videos: 10 evenly spaced frames pulled in the browser (1024px), each sent
   with a "Frame N of 10, at 0:03.2" label, and Claude is told it's a motion
   picture of X seconds, frames in order. The original file uploads to the
   server in the background for the render (a still goes as a 2160px JPEG the
   browser drew, so phone photos arrive upright).
2. One `/api/claude` call (`purpose: "label"`) writes a one-line plain
   description of the post, then 3 scripts, each with a caption
   (`=== POST ===`, `=== SCRIPT n ===`, `=== CAPTION n ===`). The label call
   uses Opus 5.5 at effort `high` with thinking on (it isn't live, so it can
   afford it), 16k tokens. About 10¢ a post.
   **Writer picker:** "quick" = Sonnet 5 with no thinking (the writer of
   the first funny scripts, ~10s, ~4¢); "deep" = Opus 5.5 thinking (~1–2 min).
   The first Opus run felt less funny than Sonnet the day before, but three
   things changed at once (model, thinking, word budget); compare on one clip.
   **Running time:** the clip rounded up to 20 / 30 / 45 / 60s (stills 30s),
   or the Length picker. Claude gets a word budget (`(secs − 2.1) × 2.4`
   words) and the bible's "Running time" rules say which beats to drop; each
   card shows its estimated length, red if over.
3. **Stars.** Click any line you love. Stars change nothing; each click
   appends a row (line, full script, the post description, model) to
   `data/label-stars.jsonl`: raw material for bible examples later. We
   decided against splicing starred lines between scripts: it makes them
   disjointed.
   **Every write is saved** per video: a readable
   `data/label-posts/<date_time_file>.md` (each rewrite and render appended,
   with writer, length, post description, scripts, captions, and the script +
   caption + music actually rendered) and a row per event in
   `data/label-posts.jsonl` for analysis. Length also has **No limit**.
4. Pick one; it opens in the **Final script** box, which you edit by hand
   (bring in lines from the other scripts, cut to length; live word + seconds
   count). Speak and Render use the edited text; the post record marks it
   edited and keeps the original. Voice ID field (defaults to the narrator, remembered in
   localStorage), stability + style sliders.
5. The script is cut at every `[QUACK]`; each piece goes to `/api/label-tts`
   in parallel; the page plays piece → `public/label/quack.wav` → piece.
   Tag-only pieces (e.g. `[excited]` right before a quack) are dropped.
   Remembers the last break used and tells Claude not to repeat it.
6. Image (or muted video, looping while he talks) with the script beside it,
   Replay / Stop.
7. **Post it.** Editable caption, music pick (`music/` at the repo root; Random picks one per render), Render
   video → `/api/label-render` → a 1080×1920 H.264/AAC MP4 in
   `cache/label/renders/`, previewed on the page, with Save video + Copy
   caption. Posting is by hand for now.

**The render (`lib/render.mjs`, ffmpeg via the `ffmpeg-static` package):** the
post fitted into a dark frame with a gilt edge on a pale gallery wall, 0.6s of
wall before he speaks, 1.5s after. The video is exactly the running time
(a longer clip is cut, a shorter one holds its last frame) unless the
narration overruns, which the status line reports. The clip's own sound is off. A clip shorter
than the narration holds its last frame; a longer one plays out. Narration
segments come from the same cache as the bench, so rendering a script you
already heard costs no credits. Tracks are loudness-levelled first (they
are mastered ~5 dB apart), then loop to length, duck whenever he talks
(sidechain compressor) and fade out over the tail; level via
`LABEL_MUSIC_VOLUME` (0.4). Drop new tracks in `music/`; the page lists them
on load. Renders take a second or two.

**Voice model:** `eleven_v3`, because only v3 performs the delivery tags. The
cost: stability snaps to 0 / 0.5 / 1 and style is ignored (the page disables
that slider). `ELEVEN_MODEL_LABEL=eleven_multilingual_v2` gets continuous
sliders back but strips the tags. Label clips are cached in `cache/tts/` by
voice + settings + text, so replays are free.

**Config:** `CLAUDE_MODEL_LABEL` (default `claude-opus-5-5`),
`CLAUDE_EFFORT_LABEL` (`high`), `ELEVENLABS_VOICE_ID_LABEL`,
`ELEVEN_MODEL_LABEL`, `ELEVEN_FORMAT_LABEL`, `LABEL_MUSIC_VOLUME`.

**Setup note:** `ffmpeg-static` downloads its binary in an install script. If
npm blocks install scripts, run `npm approve-scripts ffmpeg-static` then
`npm rebuild ffmpeg-static`.

**Tested:** image → 3 scripts end to end; 10 synthetic timestamped frames → 3
motion-picture scripts; `/api/label-tts` on v2 and v3; renders of a still and
a short landscape clip with narration, quack and music (frames and levels
checked); upload / render / star endpoints; the Opus 5.5 label call.
**Not yet tested:** a full run in the browser with a real post (scripts →
stars → render → save).

### Open items (pick up here)

- **Posting, step 2: Instagram.** Needs @roastytheduck switched to a Creator
  account (it's a normal account today) and a Meta developer app. The
  Instagram API pulls the video from a public URL, so the local file needs a
  short-lived public link (Cloudflare tunnel or a storage bucket). Check
  Meta's current docs before building.
- **Posting, step 3: TikTok.** Unaudited apps can only post privately, so MVP
  is "send to drafts", then tap Post in the app. Check TikTok's current docs.
- **Next sprint: the subject's own voice.** When the person in the clip says
  something that matters to the joke, the narration pauses and their audio
  comes up. Needs a timestamped transcript of the clip, Claude writing the
  pause into the script, and the render timing narration to the clip (there
  is no sync today).
- **Music:** four tracks in `music/` (three 60s, "Wonders of the Everyday
  Molecule" 30s, which loops on clips over ~28s). They look AI-generated:
  check the plan they came from allows commercial use before posting. ~40 MB
  of WAV. `music/`, `sourceMedia/` and `data/` are gitignored (the repo is
  public); back them up separately.
- **Calibrate the word rate.** 2.4 spoken words/second (`WORDS_PER_S` in
  `label.js`) is an estimate. After a few renders, compare the status line's
  narration seconds with the card's word count and adjust.
- **Render look:** stills are static (no slow zoom yet); landscape clips sit
  small on the vertical wall.
- **ElevenLabs credits** ran out once mid-session (quota 30k). Offered: a
  credit estimate next to "Speak it". Scripts got longer with the opening beat.
- **Bible tuning.** Test scripts slipped: "vibe" (internet-ironic), a quack
  placed after provenance with no triggering detail, "one (1)". The reference
  scripts predate the opening beat, habitat names and tags — offered to add an
  example of each. Mine `data/label-stars.jsonl` for examples once it has some.
- **Placeholder quack** — replace `public/label/quack.wav` (used by both the
  page and the render; an mp3 also works if both paths change).
- **Video:** 60s cap (Reels can be longer — trim or raise the cap); iPhone
  HEVC `.mov` usually won't decode in Chrome on Windows (the server's ffmpeg
  could pull the frames instead).
- **Instagram tagging (later):** the real tag flow is the Instagram Graph API
  mention webhook, which hands the server a media URL.
- Decisions already made: separate bible file; roasting exaggerated visible
  features allowed (with the never-list), drawing mode's ban unchanged; the
  new character-break rules replace the old curator's-note meltdown; the
  personification exception and no cross-post callbacks stay; stars log taste
  only, no splicing.

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
