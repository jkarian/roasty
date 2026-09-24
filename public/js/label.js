/* =========================================================
   WALL LABEL BENCH (/label)
   drop image -> Writer (wall label bible) writes 3 scripts + captions
   (star lines you love: taste log) -> pick one -> cut at [QUACK] ->
   ElevenLabs per segment -> play with quacks between -> render the MP4 to post.
   Separate from drawing mode: it shares only /api/claude and the server.
   ========================================================= */
const $ = (id) => document.getElementById(id);

const QUACK_URL = "/label/quack.wav"; // placeholder — replace the file
const QUACK = /\[QUACK\]/gi;
const TAG = /\[[^\]\n]{1,60}\]/g; // v3 delivery tags: [curious], [whispers], ...
const untagged = (s) => s.replace(TAG, "").replace(/\s{2,}/g, " ").trim();
// the bible's duck exclamations; used to remember last post's break
const BREAKS = ["[QUACK]", "Mother of ducks!", "What the duck?!", "Holy mallard!", "Sweet feathers!", "Oh, for pond's sake!"];

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};

const state = {
  media: null, upload: null, postId: "", fileName: "", post: "", scripts: [], captions: [], model: "",
  picked: null, clips: [], playing: null
};

/* ---------- health ---------- */
let defaultVoiceId = "";
fetch("/api/health").then((r) => r.json()).then((h) => {
  defaultVoiceId = h.labelVoiceId || "";
  const model = h.elevenModels?.label?.model || "";
  $("model").textContent = model;
  if (/^eleven_v3/.test(model)) {
    // v3 takes stability 0 / 0.5 / 1 only, and no style
    $("stability").step = "0.5";
    $("stability").value = String(Math.round(+$("stability").value * 2) / 2);
    $("style").disabled = true;
    $("styleVal").textContent = "not used by v3";
    syncSliders();
  }
  if (!$("voiceId").value) $("voiceId").value = defaultVoiceId;
  const missing = [!h.anthropic && "ANTHROPIC_API_KEY", !h.elevenlabs && "ELEVENLABS_API_KEY"].filter(Boolean);
  $("health").textContent = missing.length ? "missing " + missing.join(", ") : "keys OK";
}).catch(() => { $("health").textContent = "server unreachable"; });

/* ---------- bible ---------- */
let bible = "";
async function loadBible() {
  if (!bible) bible = await (await fetch("/api/bible?mode=walllabel")).text();
  return bible;
}

/* ---------- 1. image or video in ---------- */
const VIDEO_MAX_S = 60;
const FRAMES = 10;

/* running time: the clip rounded up to 20 / 30 / 45 / 60s, stills 30s, or
   whatever the Length picker says. Claude gets a word budget for it. */
const LENGTHS = [20, 30, 45, 60];
const WORDS_PER_S = 2.4;   // the narrator's pace, pauses included (estimate — check renders)
const WALL_S = 2.1;        // render.mjs LEAD + TAIL: music only, nobody talking
const STILL_S = 30;
$("writer").value = store.get("roasty-label-writer", "quick");
$("writer").onchange = () => {
  store.set("roasty-label-writer", $("writer").value);
  if (state.scripts.length) setStatus("writeStatus", `Writer changed — hit "Write 3 new ones" to compare on this post.`);
};
$("length").value = store.get("roasty-label-length", "auto");
$("length").onchange = () => {
  store.set("roasty-label-length", $("length").value);
  if (state.picked) countFinal();
  if (state.scripts.length) setStatus("writeStatus", `Length is now ${targetSeconds() ? targetSeconds() + "s" : "unlimited"} — hit "Write 3 new ones" to apply it.`);
};
function targetSeconds() {
  const v = $("length").value;
  if (v === "none") return 0; // no budget: the film runs as long as he talks
  if (v !== "auto") return +v;
  const m = state.media;
  if (!m || m.kind !== "video") return STILL_S;
  return LENGTHS.find((n) => m.duration <= n) || LENGTHS[LENGTHS.length - 1];
}
const wordBudget = (secs) => Math.floor((secs - WALL_S) * WORDS_PER_S);
const spokenWords = (s) => untagged(s.replace(QUACK, "")).split(/\s+/).filter(Boolean).length;
const drop = $("drop");
drop.onclick = () => $("file").click();
$("file").onchange = (e) => e.target.files[0] && takeFile(e.target.files[0]);
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const f = [...e.dataTransfer.files].find((f) => /^(image|video)\//.test(f.type));
  if (f) takeFile(f);
  else setStatus("dropStatus", "That's not an image or a video.", true);
});

/** draw a frame to a canvas no longer than `max` on its long side, as JPEG base64 */
function toJpeg(src, w, h, max, q) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q);
}

/** downscale to Claude's sweet spot (long side 1568) and JPEG it */
function prepImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const dataUrl = toJpeg(img, img.naturalWidth, img.naturalHeight, 1568, 0.9);
      // the render gets a bigger copy, drawn by the browser so phone photos
      // arrive the right way up (and HEIC arrives as JPEG)
      const full = toJpeg(img, img.naturalWidth, img.naturalHeight, 2160, 0.92);
      resolve({ kind: "image", url, poster: url, b64: dataUrl.split(",")[1], full });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("couldn't read that image")); };
    img.src = url;
  });
}

const fmtTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

/** ~10 evenly spaced frames, each from the middle of its tenth of the clip.
    Smaller than a still (1024px): ten of them go in one request. */
async function prepVideo(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  // a broken file can fire neither the event nor "error"; don't wait forever
  const once = (ev) => new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); v.removeEventListener(ev, ok); v.removeEventListener("error", bad); };
    const ok = () => { done(); resolve(); };
    const bad = () => { done(); reject(new Error("couldn't read that video (the browser may not support its format)")); };
    const timer = setTimeout(() => { done(); reject(new Error("that video wouldn't load (timed out)")); }, 15000);
    v.addEventListener(ev, ok);
    v.addEventListener("error", bad);
  });
  try {
    const meta = once("loadeddata");
    v.src = url;
    await meta;
    // recorded WebM often has no duration in its header until you seek past the end
    if (v.duration === Infinity) {
      const past = once("seeked");
      v.currentTime = 1e101;
      await past;
    }
    const dur = v.duration;
    if (!isFinite(dur) || dur <= 0) throw new Error("couldn't tell how long that video is");
    if (dur >= VIDEO_MAX_S) throw new Error(`That video is ${Math.round(dur)}s. Keep it under ${VIDEO_MAX_S}s.`);
    const frames = [];
    for (let i = 0; i < FRAMES; i++) {
      const t = ((i + 0.5) / FRAMES) * dur;
      setStatus("dropStatus", `Pulling frame ${i + 1} of ${FRAMES}…`);
      const seeked = once("seeked");
      v.currentTime = t;
      await seeked;
      const dataUrl = toJpeg(v, v.videoWidth, v.videoHeight, 1024, 0.85);
      frames.push({ t, b64: dataUrl.split(",")[1], dataUrl });
    }
    setStatus("dropStatus", `${FRAMES} frames from a ${dur.toFixed(1)}s clip.`);
    return { kind: "video", url, poster: frames[0].dataUrl, duration: dur, frames };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

async function takeFile(file) {
  stop();
  setStatus("dropStatus", "");
  let media;
  try {
    media = file.type.startsWith("video/") ? await prepVideo(file) : await prepImage(file);
  } catch (e) { return setStatus("dropStatus", e.message, true); }
  if (state.media) URL.revokeObjectURL(state.media.url);
  state.media = media;
  state.picked = null;
  state.postId = postIdFor(file);
  state.fileName = file.name;
  $("postSec").classList.add("hidden");
  state.upload = uploadMedia(file, media);
  state.upload.catch(() => {}); // surfaced when Render asks for it
  $("thumb").src = media.poster;
  $("thumb").classList.remove("hidden");
  const isVid = media.kind === "video";
  $("finalImg").classList.toggle("hidden", isVid);
  $("finalVid").classList.toggle("hidden", !isVid);
  if (isVid) $("finalVid").src = media.url;
  else { $("finalVid").removeAttribute("src"); $("finalImg").src = media.url; }
  writeScripts();
}

/** "2026-09-24_2305_beach-clip": names this post's file in data/label-posts/ */
function postIdFor(file) {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  const slug = file.name.replace(/.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "post";
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${slug}`;
}

/** save a write or a render to this post's record (data/label-posts/) */
function logPost(event, fields) {
  fetch("/api/label-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event, postId: state.postId, file: state.fileName, kind: state.media?.kind || "",
      duration: state.media?.duration || 0, ...fields
    })
  }).catch(() => {});
}

/** send the post to the server in the background, for Render. Resolves to its upload id. */
async function uploadMedia(file, media) {
  const blob = media.kind === "image" ? await (await fetch(media.full)).blob() : file;
  const name = media.kind === "image" ? "post.jpg" : file.name;
  const res = await fetch("/api/label-upload?name=" + encodeURIComponent(name), { method: "POST", body: blob });
  const d = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`upload ${res.status}: ${(d && d.error) || ""}`);
  return d.id;
}

/* ---------- 2. three scripts ---------- */
function prompt() {
  const last = store.get("roasty-label-lastbreak", "");
  const m = state.media;
  const secs = targetSeconds();
  const what = m && m.kind === "video"
    ? `This post is a motion picture: a ${m.duration.toFixed(1)}-second video. Above are ${m.frames.length} frames from it, in order, each labeled with its timestamp. Narrate it as a motion picture, following your bible.`
    : "The image above is the post.";
  return `

=== THIS POST ===
${what} The person who posted it tagged you. Write 3 complete scripts for it, following every rule in your bible.

${secs ? `Running time: ${secs} seconds. That is at most ${wordBudget(secs)} spoken words per script (delivery tags and [QUACK] don't count). Fit it the way your bible's running-time rules say.` : "Running time: no limit. Use the full format."}

Make the three genuinely different: build each one around a different main detail or angle, with a different title and a different closer. Do not reuse sentences between them.
Character breaks: at most one per script, only when a detail truly earns it. At least one of the three scripts has no break.${last ? `\nThe previous post's break was ${last}. Don't use that one.` : ""}

Write only the words the narrator speaks: no headings, no beat labels, no stage directions, no markdown, no quotation marks around the whole thing. The only bracketed tokens allowed are [QUACK] and the delivery tags from your bible's palette. Separate paragraphs with a blank line.

Give each script its own caption, following your bible.

Reply in exactly this format and nothing else:
=== POST ===
(one plain sentence saying what the post shows, not in character)
=== SCRIPT 1 ===
(script)
=== CAPTION 1 ===
(caption)
=== SCRIPT 2 ===
(script)
=== CAPTION 2 ===
(caption)
=== SCRIPT 3 ===
(script)
=== CAPTION 3 ===
(caption)`;
}

/** the reply's === POST === / === SCRIPT n === / === CAPTION n === sections */
function parseReply(txt) {
  const out = { post: "", scripts: [], captions: [] };
  const parts = txt.split(/^\s*=+\s*(POST|SCRIPT\s*\d+|CAPTION\s*\d+)\s*=+\s*$/im);
  for (let i = 1; i < parts.length; i += 2) {
    const head = parts[i].toUpperCase(), body = (parts[i + 1] || "").trim();
    if (head === "POST") out.post = body;
    else if (head.startsWith("SCRIPT") && body) out.scripts.push(body);
    else if (head.startsWith("CAPTION")) out.captions[out.scripts.length - 1] = body;
  }
  out.scripts = out.scripts.slice(0, 3);
  return out;
}

/** a still is one image; a video is its frames, each preceded by its timestamp */
function mediaBlocks(m) {
  const img = (b64) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
  if (m.kind !== "video") return [img(m.b64)];
  return m.frames.flatMap((f, i) => [
    { type: "text", text: `Frame ${i + 1} of ${m.frames.length}, at ${fmtTime(f.t)}:` },
    img(f.b64)
  ]);
}

let writeSeq = 0;
async function writeScripts() {
  if (!state.media) return;
  const seq = ++writeSeq;
  $("writeSec").classList.remove("hidden");
  $("rewrite").disabled = true;
  $("scripts").innerHTML = "";
  setStatus("writeStatus", "Roasty is writing three scripts…");
  const t0 = performance.now();
  try {
    const res = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        purpose: "label",
        writer: $("writer").value,
        max_tokens: 16000,
        messages: [{ role: "user", content: [
          { type: "text", text: await loadBible(), cache_control: { type: "ephemeral" } },
          ...mediaBlocks(state.media),
          { type: "text", text: prompt() }
        ] }]
      })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Claude ${res.status}: ${(data && data.error) || ""}`.slice(0, 300));
    if (seq !== writeSeq) return;
    const reply = parseReply(data.text || "");
    if (!reply.scripts.length) throw new Error("couldn't find any scripts in the reply:\n" + (data.text || "").slice(0, 400));
    Object.assign(state, reply, { model: data.model });
    renderScripts();
    logPost("scripts", { model: data.model, target: targetSeconds(), post: reply.post, scripts: reply.scripts, captions: reply.captions });
    setStatus("writeStatus", `${reply.scripts.length} scripts in ${((performance.now() - t0) / 1000).toFixed(1)}s · ${data.model}` +
      (data.cacheRead ? " · bible cached" : ""));
  } catch (e) {
    if (seq === writeSeq) setStatus("writeStatus", e.message, true);
  } finally {
    if (seq === writeSeq) $("rewrite").disabled = false;
  }
}
$("rewrite").onclick = writeScripts;

/** script text as HTML, with [QUACK] shown as a pill */
function scriptHTML(s) {
  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return esc(s).replace(QUACK, '<span class="quack">QUACK</span>')
    .replace(TAG, (t) => `<span class="tag">${t.slice(1, -1)}</span>`);
}

/** a paragraph cut into sentences; "..." is a pause inside one, not an end */
const SENTENCE = /(?:[^.!?…]|\.{2,}|…)+(?:[.!?]+["'”’)\]]*|$)\s*/g;

/** script text as star-able sentences, paragraphs kept */
function starHTML(s) {
  return s.split(/\n\s*\n/).map((para) =>
    (para.match(SENTENCE) || [para]).map((line) =>
      `<span class="line" title="Star a line you love">${scriptHTML(line)}</span>`).join("")
  ).join("\n\n");
}

/** stars only feed the taste log (data/label-stars.jsonl); they change nothing on screen but the mark */
function star(el, script) {
  const starred = el.classList.toggle("starred");
  fetch("/api/label-star", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      line: el.textContent.trim(), starred, script, post: state.post, postId: state.postId,
      kind: state.media?.kind || "", model: state.model || ""
    })
  }).catch(() => {});
}

function renderScripts() {
  $("scripts").innerHTML = "";
  state.scripts.forEach((s, i) => {
    const card = document.createElement("div");
    card.className = "card script";
    const words = spokenWords(s);
    const est = Math.round(words / WORDS_PER_S + WALL_S);
    const over = targetSeconds() && est > targetSeconds();
    card.innerHTML = `<div class="n">Script ${i + 1} · ${words} words · ${(s.replace(QUACK, "").match(TAG) || []).length} tags · <span${over ? ' class="over"' : ""}>~${est}s${targetSeconds() ? ` of ${targetSeconds()}s` : ""}</span></div>
      <div class="text">${starHTML(s)}</div>` +
      (state.captions[i] ? `<div class="caption">${scriptHTML(state.captions[i])}</div>` : "");
    card.querySelectorAll(".line").forEach((el) => { el.onclick = () => star(el, s); });
    const btn = document.createElement("button");
    btn.textContent = "Use this one";
    btn.onclick = () => pick(i, card);
    card.appendChild(btn);
    $("scripts").appendChild(card);
  });
}

function pick(i, card) {
  document.querySelectorAll(".script").forEach((c) => c.classList.remove("picked"));
  card.classList.add("picked");
  state.picked = state.scripts[i];
  state.pickedIndex = i;
  $("editor").value = state.picked;
  countFinal();
  $("caption").value = state.captions[i] || "";
  resetRender();
  $("postSec").classList.remove("hidden");
  const used = BREAKS.find((b) => state.picked.toLowerCase().includes(b.toLowerCase()));
  if (used) store.set("roasty-label-lastbreak", `"${used}"`);
  $("finalText").innerHTML = scriptHTML(state.picked);
  $("voiceSec").classList.remove("hidden");
  $("resultSec").classList.remove("hidden");
  stop();
  state.clips = [];
  $("replay").disabled = true;
  setStatus("voiceStatus", "Picked script " + (i + 1) + ". Edit it if you like, then hit Speak it.");
}

/* the final script: the picked one, edited by hand. Speak and Render use this. */
function countFinal() {
  const words = spokenWords(state.picked || "");
  const est = Math.round(words / WORDS_PER_S + WALL_S);
  const target = targetSeconds();
  const over = target && est > target;
  $("finalCount").innerHTML = `${words} words · <span${over ? ' class="over"' : ""}>~${est}s${target ? ` of ${target}s` : ""}</span>` +
    (state.picked !== state.scripts[state.pickedIndex] ? " · edited" : "");
}
$("editor").oninput = () => {
  state.picked = $("editor").value;
  $("finalText").innerHTML = scriptHTML(state.picked);
  countFinal();
  // the old narration no longer matches the words
  stop();
  state.clips = [];
  $("replay").disabled = true;
  resetRender();
  setStatus("voiceStatus", "Script edited. Hit Speak it to hear the new version.");
};

/* ---------- 3. voice ---------- */
$("voiceId").value = store.get("roasty-label-voice", "");
$("stability").value = store.get("roasty-label-stability", "0.5");
$("style").value = store.get("roasty-label-style", "0.3");
function syncSliders() {
  $("stabVal").textContent = (+$("stability").value).toFixed(2);
  if (!$("style").disabled) $("styleVal").textContent = (+$("style").value).toFixed(2);
}
syncSliders();
for (const id of ["stability", "style"]) $(id).oninput = () => { syncSliders(); store.set("roasty-label-" + id, $(id).value); };
$("voiceId").onchange = () => store.set("roasty-label-voice", $("voiceId").value.trim());

/** a script as [segment, quack, segment, …] — the quack is never sent to TTS */
function segments(script) {
  const parts = script.split(QUACK).map((s) => s.trim());
  const out = [];
  parts.forEach((p, i) => {
    // a piece that's only a tag (e.g. "[excited]" right before the quack) has nothing to say
    if (untagged(p)) out.push({ text: p, prev: parts.slice(0, i).join(" "), next: parts.slice(i + 1).join(" ") });
    if (i < parts.length - 1) out.push({ quack: true });
  });
  return out;
}

async function speak() {
  if (!state.picked) return;
  const voiceId = $("voiceId").value.trim() || defaultVoiceId;
  stop();
  $("speak").disabled = true;
  $("replay").disabled = true;
  const segs = segments(state.picked);
  const n = segs.filter((s) => !s.quack).length;
  setStatus("voiceStatus", `Voicing ${n} segment${n === 1 ? "" : "s"}…`);
  const t0 = performance.now();
  try {
    // all segments at once; each keeps its neighbours as context
    const clips = await Promise.all(segs.map(async (s) => {
      if (s.quack) return QUACK_URL;
      const res = await fetch("/api/label-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: s.text, previousText: s.prev, nextText: s.next, voiceId,
          stability: +$("stability").value, style: +$("style").value
        })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(`ElevenLabs relay ${res.status}: ${(d && d.error) || ""}`.slice(0, 300));
      }
      return URL.createObjectURL(await res.blob());
    }));
    state.clips.forEach((u) => u !== QUACK_URL && URL.revokeObjectURL(u));
    state.clips = clips;
    setStatus("voiceStatus", `Voiced with ${voiceId}${voiceId === defaultVoiceId ? " (the narrator default)" : ""} in ${((performance.now() - t0) / 1000).toFixed(1)}s.`);
    $("replay").disabled = false;
    $("resultSec").scrollIntoView({ behavior: "smooth", block: "start" });
    play();
  } catch (e) {
    setStatus("voiceStatus", e.message, true);
  } finally {
    $("speak").disabled = false;
  }
}
$("speak").onclick = speak;

/* ---------- 4. playback ---------- */
/** the video, muted, from the top. It loops while he talks; once he's done
    it plays out its current pass and stops. No sync beyond starting together. */
function videoEl() {
  return state.media && state.media.kind === "video" ? $("finalVid") : null;
}
function play() {
  stop();
  const run = { cancelled: false, audio: null };
  state.playing = run;
  $("stop").disabled = false;
  const vid = videoEl();
  if (vid) { vid.muted = true; vid.loop = true; vid.currentTime = 0; }
  (async () => {
    let first = true;
    for (const src of state.clips) {
      if (run.cancelled) return;
      run.audio = new Audio(src);
      await new Promise((resolve) => {
        run.audio.onended = run.audio.onerror = resolve;
        run.audio.play().catch(resolve);
        if (first && vid) vid.play().catch(() => {});
        first = false;
        run.resolve = resolve;
      });
    }
    if (vid && !run.cancelled) vid.loop = false;
    if (state.playing === run) { state.playing = null; $("stop").disabled = true; }
  })();
}
function stop() {
  const vid = videoEl();
  if (vid) vid.pause();
  const run = state.playing;
  if (!run) return;
  run.cancelled = true;
  if (run.audio) run.audio.pause();
  if (run.resolve) run.resolve();
  state.playing = null;
  $("stop").disabled = true;
}
$("replay").onclick = play;
$("stop").onclick = stop;

/* ---------- 5. post it: render + caption ---------- */
/* tracks live in music/ at the repo root; "Quirks_in_the_News_2026-09-24T203317.wav" shows as "Quirks in the News" */
const RANDOM = "__random__";
const trackName = (t) => t.replace(/\.[^.]+$/, "").replace(/_\d{4}-\d\d-\d\dT\d+$/, "").replace(/[-_]+/g, " ");
let tracks = [];
fetch("/api/label-music").then((r) => r.json()).then((d) => {
  tracks = d.tracks;
  if (tracks.length > 1) $("music").add(new Option("Random", RANDOM));
  for (const t of tracks) $("music").add(new Option(trackName(t), t));
  const fallback = tracks.length > 1 ? RANDOM : tracks[0] || "";
  const saved = store.get("roasty-label-music", fallback);
  $("music").value = [...$("music").options].some((o) => o.value === saved) ? saved : fallback;
}).catch(() => {});
$("music").onchange = () => store.set("roasty-label-music", $("music").value);
const pickTrack = () => $("music").value === RANDOM
  ? tracks[Math.floor(Math.random() * tracks.length)]
  : $("music").value;

function resetRender() {
  $("renderVid").removeAttribute("src");
  $("renderVid").classList.add("hidden");
  $("saveVid").classList.add("hidden");
  setStatus("renderStatus", "");
}

async function render() {
  if (!state.picked || !state.upload) return;
  stop();
  resetRender();
  $("render").disabled = true;
  setStatus("renderStatus", "Rendering… (new narration is voiced first, if you haven't played it)");
  const t0 = performance.now();
  try {
    const mediaId = await state.upload.catch((e) => { throw new Error("The file never reached the server — " + e.message); });
    const music = pickTrack();
    const res = await fetch("/api/label-render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaId, kind: state.media.kind, seconds: state.media.duration || 0, target: targetSeconds(),
        segments: segments(state.picked),
        voiceId: $("voiceId").value.trim() || defaultVoiceId,
        stability: +$("stability").value, style: +$("style").value,
        music
      })
    });
    const d = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Render ${res.status}: ${(d && d.error) || ""}`.slice(0, 300));
    $("renderVid").src = d.url;
    $("renderVid").classList.remove("hidden");
    $("saveVid").href = d.url;
    $("saveVid").download = d.name;
    $("saveVid").classList.remove("hidden");
    const target = targetSeconds();
    const overBy = d.seconds - target;
    logPost("render", { video: d.name, seconds: d.seconds, narration: d.narration, target, music: music ? trackName(music) : "", script: state.picked, caption: $("caption").value, model: state.model,
      pickedFrom: state.pickedIndex + 1, edited: state.picked !== state.scripts[state.pickedIndex],
      original: state.picked !== state.scripts[state.pickedIndex] ? state.scripts[state.pickedIndex] : undefined });
    setStatus("renderStatus", `${d.seconds.toFixed(1)}s video (narration ${d.narration.toFixed(1)}s), rendered in ${((performance.now() - t0) / 1000).toFixed(1)}s` +
      (music ? ` · music: ${trackName(music)}` : " · no music") +
      (target && overBy > 0.5 ? ` · ran ${overBy.toFixed(1)}s past ${target}s` : "") + ".");
  } catch (e) {
    setStatus("renderStatus", e.message, true);
  } finally {
    $("render").disabled = false;
  }
}
$("render").onclick = render;

$("copyCap").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("caption").value);
    setStatus("renderStatus", "Caption copied.");
  } catch {
    $("caption").select();
    setStatus("renderStatus", "Couldn't reach the clipboard; the caption is selected, press Ctrl+C.", true);
  }
};

function setStatus(id, msg, err = false) {
  $(id).textContent = msg;
  $(id).classList.toggle("err", err);
}
