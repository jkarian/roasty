# Claude Code — Kickoff Brief (Session 1: give Roasty his voice)

## Context
This folder contains a WORKING proof of concept (poc/roasty-poc.html): a
draw-and-guess game where Roasty, an anxious duck gallery owner, watches you
draw, guesses blind, and roasts the result. It currently runs in the Claude.ai
artifact sandbox with browser TTS. Everything about the character lives in
docs/roasty-bible.md. The designed ElevenLabs voice is in docs/voice.md.

## Session 1 goal
The same game, running locally, speaking with Roasty's REAL voice
(ElevenLabs ID: Ym1lepVbBruoa0yJFohT), playable on the iPhone via the
local network.

## Tasks, in order
1. Convert poc/roasty-poc.html into a small local web app:
   - a tiny Node (or Python) server that serves the page AND relays API calls
   - move the Anthropic + ElevenLabs keys server-side (.env, gitignored)
   - the Claude calls: same two-call pipeline (blind Guesser / bible Writer),
     same prompts — copy them verbatim from the POC, they are tuned
2. ElevenLabs integration in say():
   - live TTS for AI-written lines (Guesser reactions + closing roasts)
   - map expression state -> emotion tags per docs/voice.md
   - use the lowest-latency model that still honors tags for mid-round lines;
     the closing roast can afford a higher-quality/slower model
3. Pre-generate the free audio library (one-time script):
   - every murmur, vamp, reflex line, opener template -> .mp3 files
   - play these locally with zero latency; ONLY AI lines hit live TTS
4. Latency discipline (the product lives or dies here):
   - keep the instant vamp -> punchline pattern from the POC
   - start TTS synthesis as soon as the writer line arrives; stream if possible
5. Phone test: serve on 0.0.0.0, open http://<pc-ip>:<port> on the iPhone
   (same Wi-Fi). Touch drawing already works in the POC code.

## Do NOT change
- The bible, prompts, trigger timings, or comedy-stack structure. They are the
  product of many tuning rounds. Improvements to them go through play-testing,
  not refactoring.

## Later sessions (not now)
Session 2: joke flywheel — persist the joke log + ratings to disk.
Session 3: shareable round clip (stroke replay + audio into a vertical video).
Then: Swift/PencilKit native port. The web app remains the tuning bench.
