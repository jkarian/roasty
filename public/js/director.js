/* =========================================================
   ROASTY DIRECTS — experimental mode.

   The inversion: he stops guessing and starts giving orders. He picks the
   picture, he writes the steps, you hold the pen. When it fails it is HIS
   failure too, and a blind judge marks you both at the end.

   Everything expensive is borrowed from Classic through `ctx` — the voice
   pipeline, the murmur/reflex ladder, the bleep, the joke log. Nothing in
   here reaches back into Classic's own round flow.
   ========================================================= */
import { tierFor, hasProfanity, hasBleep } from "./lines.js";

const ROUND_SECONDS = 45;
const PAUSE_MS      = 2000;   // "they stopped drawing" = a stroke, then this long still
const WAIT_MAX_MS   = 11000;  // ...but never wait forever for a stroke that never comes
const MAX_REPAIRS   = 1;      // he never asks for the same thing three times
const PLAN_TIMEOUT_MS = 14000;// a slow plan must not hold the round hostage

export function createDirector(ctx) {
  const {
    S, say, audio, ticker, dbg, callClaude, parseJSON, snapshotB64,
    setFace, thinking, logJoke, isMatch, pickWord, els,
    sizeCanvas, redraw, startPresence, stopPresence, showResult, squintQuietly
  } = ctx;

  let bible = "";
  let plan = [];          // ["two long lines side by side", ...]
  let stepIndex = 0;
  let repairs = 0;
  let abort = false;

  async function loadBible() {
    if (bible) return bible;
    try { bible = await (await fetch("/api/bible?mode=director")).text(); }
    catch (e) { dbg("director bible load failed: " + e.message); }
    return bible;
  }

  /* ---------- one call per round: the picture, as steps ---------- */
  async function planCall(word) {
    const txt = await callClaude({
      purpose: "plan", max_tokens: 1000,
      messages: [{ role: "user", content:
`You are planning a simple line drawing of "${word}" for someone to follow blind.
Break it into 4 to 6 steps. Each step is ONE instruction in plain shape language a
child could obey instantly: lines, circles, boxes, blobs, and where they go
relative to what is already there ("two long lines side by side", "a circle on top
where they meet", "a small box under it").
HARD RULES:
- NEVER name the subject or any part of it. No "wheel", no "ear", no "roof". Shapes only.
- No step may reference a real-world object at all.
- Each step under 10 words. Each step must be drawable in a few seconds.
- The steps must build in order, so the finished result reads as the subject.
Reply ONLY with JSON, no other text:
{"steps":["...","...","..."]}` }]
    });
    const j = parseJSON(txt);
    let steps = (j && Array.isArray(j.steps)) ? j.steps.filter(s => typeof s === "string" && s.trim()) : [];
    // the word must never survive into an instruction
    const w = String(word).toLowerCase();
    steps = steps.map(s => s.replace(new RegExp(`\\b${w}s?\\b`, "ig"), "shape"));
    return steps.slice(0, 6);
  }

  /* ---------- did they roughly do it? ---------- */
  async function complianceCall(stepText) {
    const img = snapshotB64();
    const txt = await callClaude({
      purpose: "comply", max_tokens: 1000,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: img } },
        { type: "text", text:
`Someone was just told: "${stepText}"
Look at their drawing. Did they roughly add that? Be generous — rough and wobbly counts as yes.
Then describe what the newest part ACTUALLY looks like, as a blunt physical comparison,
in a few words ("a squashed egg", "two crossed sticks"). Describe only what is there.
Reply ONLY with JSON, no other text:
{"added":"yes|no","looks":"..."}` }
      ] }]
    });
    return parseJSON(txt) || { added: "no", looks: "" };
  }

  /* ---------- the blind judge: fresh context, canvas only ---------- */
  async function judgeCall() {
    const img = snapshotB64();
    const txt = await callClaude({
      purpose: "judge", max_tokens: 1000,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: img } },
        { type: "text", text:
`What is this a drawing of? Answer like a regular person glancing at it, with one
everyday noun. Commit even if you are unsure. Never answer with letters, glyphs or
anything needing specialist knowledge.
Reply ONLY with JSON, no other text:
{"guess":"..."}` }
      ] }]
    });
    const j = parseJSON(txt);
    return (j && j.guess) ? String(j.guess) : "";
  }

  /* ---------- Roasty reacts, and decides what happens to the step ---------- */
  async function reactCall({ stepText, nextStep, added, looks, first }) {
    const secs = S.timeLeft;
    const ladder = tierFor(secs);
    const txt = await callClaude({
      purpose: "write", max_tokens: 1000,
      messages: [{ role: "user", content: [
        { type: "text", text: bible, cache_control: { type: "ephemeral" } },
        { type: "text", text:
`

=== THIS MOMENT ===
SECONDS LEFT: ${secs}  —  ${ladder === "early" ? "EARLY: patient. This is going to work."
  : ladder === "mid" ? "MID: clipped. You have stopped saying please."
  : "LATE: directing a disaster in real time. Blunt, fast, no cushion."}

You are on step ${stepIndex + 1} of ${plan.length}.
${first ? `You have not given any instruction yet. Your first instruction is: "${stepText}"
Deliver it. Confident, easy, obvious. Nothing has gone wrong yet.`
: `You told them: "${stepText}"
Did they roughly do it: ${added === "yes" ? "YES" : "NO"}
What the new part actually looks like: ${looks || "(no description)"}
${nextStep ? `The next instruction in your plan is: "${nextStep}"` : "That was the LAST step. There is no next instruction."}

React to what is actually there, then decide:
- "advance" — good enough. Grunt, then give the next instruction in the same breath.
- "repair" — a small fixing instruction for the SAME step. Only if a repair could save it.
- "moveon" — the surrender. "Fine. FINE. Moving on." then the next instruction, flat.
${repairs >= MAX_REPAIRS ? 'You have ALREADY repaired this step once. You may not choose "repair" again.' : ""}
${!nextStep ? 'There is no next instruction, so your line is just the reaction. Use "advance".' : ""}`}

Your line must contain the instruction itself when you advance or repair, woven in naturally.
Never name the thing being drawn. Shape language only.
Lines you already said this round (never repeat):
${S.saidLines.slice(-8).map(l => "- " + l).join("\n") || "- (nothing yet)"}

Write 3 candidate lines, YOUR FUNNIEST FIRST, each following every rule.
Reply ONLY with JSON, no other text:
{"candidates":["...","...","..."],"decision":"advance|repair|moveon"}` }
      ] }]
    });
    const j = parseJSON(txt);
    if (!j || !Array.isArray(j.candidates)) return null;
    let real = j.candidates.filter(c => typeof c === "string" && c.trim() && c.trim().toUpperCase() !== "SILENCE");
    const clean = real.filter(c => !hasProfanity(c));
    if (clean.length < real.length) dbg(`director: dropped ${real.length - clean.length} profane candidate(s)`);
    real = clean;
    if (!real.length) return null;
    const short = real.filter(c => c.trim().length <= 90);
    let decision = ["advance", "repair", "moveon"].includes(j.decision) ? j.decision : "advance";
    if (decision === "repair" && repairs >= MAX_REPAIRS) decision = "moveon";
    return { line: (short.length ? short[0] : real[0]).trim(), decision };
  }

  /* ---------- wait for them to draw, then stop ---------- */
  function waitForPause() {
    return new Promise((resolve) => {
      const startCount = S.strokes.length;
      const t0 = Date.now();
      const id = setInterval(() => {
        if (abort || S.phase !== "drawing") { clearInterval(id); return resolve("aborted"); }
        const drew = S.strokes.length > startCount;
        const still = S.lastStrokeAt && Date.now() - S.lastStrokeAt >= PAUSE_MS;
        if (drew && still && !S.current) { clearInterval(id); return resolve("drew"); }
        if (Date.now() - t0 > WAIT_MAX_MS) { clearInterval(id); return resolve(drew ? "drew" : "nothing"); }
      }, 150);
    });
  }

  /* ---------- the round ---------- */
  async function start() {
    abort = false;
    await loadBible();

    S.mode = "director";
    S.round++;
    S.word = pickWord(S.round);
    S.phase = "countdown";
    S.timeLeft = ROUND_SECONDS;
    S.won = false;
    S.strokes = []; S.current = null; S.dirty = false;
    S.saidLines = []; S.guesses = []; S.lastDetails = []; S.lastResembles = "";
    S.busy = false; S.hadFirstStroke = false;
    S.lastStrokeAt = 0; S.lastReflexAt = 0; S.lastSayAt = 0; S.lastMurmurAt = 0;
    S.usedExclaim = false; S.urgeCount = 0;
    plan = []; stepIndex = 0; repairs = 0;

    els.wordText.textContent = "his idea";
    els.intro.style.display = "none";
    els.resultCard.classList.remove("show");
    els.countBlock.style.display = "block";
    els.veil.style.display = "flex";
    els.veil.style.background = "";
    els.veil.style.pointerEvents = "";
    els.bigWord.textContent = "he has a plan";
    els.timer.textContent = String(ROUND_SECONDS);
    els.timer.classList.remove("low");
    setFace("suspicion");
    els.bubble.classList.add("quiet");
    els.bubble.textContent = "He is deciding what you're going to draw.";

    // the plan call runs under the countdown, so step 1 lands the moment it lifts
    const planning = planCall(S.word).catch((e) => { dbg("plan failed: " + e.message); return []; });

    let n = 3;
    els.countNum.textContent = n;
    await new Promise((resolve) => {
      const cd = setInterval(() => {
        n--;
        if (n > 0) { els.countNum.textContent = n; return; }
        clearInterval(cd); resolve();
      }, 800);
    });

    // The plan usually lands inside the 3-2-1. When the API is slow it has run
    // to 25s — so he vamps rather than standing there mute, and gives up rather
    // than holding the round hostage.
    plan = await Promise.race([
      planning,
      new Promise((r) => setTimeout(() => r(null), 900))
    ]);
    if (plan === null) {
      say("Hold on. Hold on.", "suspicion", null, "vamp");
      plan = await Promise.race([
        planning,
        new Promise((r) => setTimeout(() => r([]), PLAN_TIMEOUT_MS))
      ]);
    }
    if (!plan || !plan.length) {
      els.bubble.classList.remove("quiet");
      els.bubble.textContent = "He had a plan. He lost the plan. Try again.";
      dbg("director: no plan, aborting round");
      S.phase = "idle";
      els.countBlock.style.display = "none";
      els.intro.style.display = "block";
      return;
    }
    dbg(`director plan (${plan.length} steps): ${plan.join(" | ")}`);
    ticker.push("moment", `plan ${plan.length} steps`);

    els.veil.style.display = "none";
    els.countBlock.style.display = "none";
    els.toolRow.style.display = "flex";
    S.phase = "drawing";
    sizeCanvas();
    startPresence();
    S.timerId = setInterval(tick, 1000);

    runSteps().catch((e) => dbg("director loop error: " + e.message));
  }

  function tick() {
    S.timeLeft--;
    els.timer.textContent = S.timeLeft;
    if (S.timeLeft <= 10) els.timer.classList.add("low");
    if (S.timeLeft <= 0) endRound();
  }

  async function runSteps() {
    let first = true;
    while (!abort && S.phase === "drawing" && stepIndex < plan.length) {
      const stepText = plan[stepIndex];
      const nextStep = plan[stepIndex + 1] || null;

      // deliver the instruction
      S.busy = true;
      const react = await reactCall({ stepText, nextStep, first, added: "yes", looks: "" })
        .catch((e) => { dbg("director react failed: " + e.message); return null; });
      S.busy = false;
      if (abort || S.phase !== "drawing") return;

      if (react) {
        say(react.line, S.timeLeft >= 20 ? "suspicion" : S.timeLeft >= 10 ? "alarm" : "meltdown", null, "ai");
        logJoke(first ? "director:open" : "director:instruct", react.line, "", "director");
      } else {
        // the writer died; give the raw step so the round can continue
        say(stepText, "suspicion", null, "ai");
        logJoke("director:instruct-raw", stepText, "", "director");
      }
      first = false;

      const outcome = await waitForPause();
      if (abort || S.phase !== "drawing") return;

      let added, looks;
      if (outcome === "nothing") {
        // Being ignored is its own reaction — and there is no point paying for
        // a vision call on a canvas that did not change.
        added = "no";
        looks = "nothing at all — they did not draw anything. You were ignored.";
        ticker.push("moment", `step ${stepIndex + 1}: nothing drawn`);
      } else {
        S.busy = true;
        const check = await complianceCall(stepText).catch((e) => { dbg("comply failed: " + e.message); return null; });
        S.busy = false;
        if (abort || S.phase !== "drawing") return;
        added = check?.added === "yes" ? "yes" : "no";
        looks = check?.looks || "";
      }
      dbg(`director step ${stepIndex + 1}: added=${added} looks="${looks}"`);
      ticker.push("moment", `step ${stepIndex + 1} ${added === "yes" ? "ok" : "botched"}`);

      const isLast = stepIndex === plan.length - 1;
      if (isLast) { stepIndex++; continue; }   // the reaction to the last step is the ending

      S.busy = true;
      const r = await reactCall({ stepText, nextStep, added, looks, first: false })
        .catch((e) => { dbg("director react failed: " + e.message); return null; });
      S.busy = false;
      if (abort || S.phase !== "drawing") return;

      if (r) {
        const face = added === "yes" ? (S.timeLeft >= 20 ? "suspicion" : "alarm")
                                     : (S.timeLeft >= 10 ? "alarm" : "meltdown");
        say(r.line, face, null, "ai");
        logJoke(`director:${added === "yes" ? "ok" : "botched"}:${r.decision}`, r.line, looks, "director");
        if (r.decision === "repair") { repairs++; continue; }   // same step again
        stepIndex++; repairs = 0;
      } else {
        squintQuietly();
        stepIndex++; repairs = 0;
      }
    }

    if (!abort && S.phase === "drawing") endRound();
  }

  async function endRound() {
    if (S.phase !== "drawing") return;
    S.phase = "done";
    abort = true;
    clearInterval(S.timerId);
    stopPresence();
    els.toolRow.style.display = "none";

    say("Okay. Okay. Hands off. Let me get someone.", "alarm", null, "vamp");
    thinking(true);

    let guess = "";
    try { guess = await judgeCall(); } catch (e) { dbg("judge failed: " + e.message); }
    const won = !!guess && isMatch(guess, S.word);
    S.won = won;
    if (won) { S.wins++; S.streak++; } else { S.streak = 0; }
    dbg(`director judge: "${guess}" vs "${S.word}" -> ${won ? "WIN" : "LOSS"}`);
    ticker.push("moment", `judge: ${guess || "(nothing)"}`);

    let line = null;
    try {
      const txt = await callClaude({
        purpose: "close", max_tokens: 1000,
        messages: [{ role: "user", content: [
          { type: "text", text: bible, cache_control: { type: "ephemeral" } },
          { type: "text", text:
`

=== THIS MOMENT ===
ROUND OVER. You directed this one. The picture in your head was "${S.word}".
You showed the finished drawing to a stranger who knows nothing, and asked them
what it is. They said: "${guess || "nothing at all"}".
${won ? "They got it. It WORKED. You did not think it would work."
      : "They were wrong. It did not read. This is a shared failure and half of it is yours — you wrote the steps."}
Deliver the ending, per your bible. One or two sentences. Never name the subject
if they missed it. Do not blame the person holding the pen.
Reply ONLY with JSON, no other text:
{"candidates":["...","...","..."]}` }
        ] }]
      });
      const j = parseJSON(txt);
      if (j && Array.isArray(j.candidates)) {
        const real = j.candidates.filter(c => typeof c === "string" && c.trim() && !hasProfanity(c));
        if (real.length) line = real[0].trim();
      }
    } catch (e) { dbg("director close failed: " + e.message); }

    thinking(false);
    const closing = line || (won ? "That's it. That's the thing. Don't touch it."
                                : "They said " + (guess || "nothing") + ". Okay. Thursday.");
    const face = won ? "grudge" : "defeat";
    say(closing, face, null, "ai", null, undefined);
    logJoke(won ? "director:closing-win" : "director:closing-loss", closing, guess, "director");

    showResult({
      won,
      verdict: won ? "They saw it." : "Nobody saw it.",
      sub: `he asked for “${S.word}” · they said “${guess || "nothing"}”`
    });
  }

  function stop() { abort = true; stopPresence(); clearInterval(S.timerId); }

  return { start, stop, get plan() { return plan; }, get stepIndex() { return stepIndex; } };
}
