/* =========================================================
   ROASTY — audio engine.
   Two paths, on purpose:
     library  every line we could know in advance is a local .mp3,
              decoded and fired through WebAudio. Zero latency, zero cost.
     live     ONLY AI-written lines. Streamed from /api/tts and played
              through one unlocked <audio> element, so the first bytes
              start sounding before synthesis has finished.
   He interrupts himself — a new line always kills the one in progress.
   ========================================================= */

const SILENT_WAV =
  "data:audio/wav;base64,UklGRgQCAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YeABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=";

const QUIET = new Set(["murmurNeutral", "murmurConcern", "murmurGroan"]); // under his breath

/* Who is allowed to talk over whom.
   An AI line is the thing we waited two seconds for — nothing steps on it.
   A vamp is a placeholder, so the writer line it was covering for may cut it
   off mid-word; that hand-off IS the instant-vamp pattern. */
const PRIORITY = { ambient: 0, vamp: 1, ai: 2 };

export class RoastyAudio {
  constructor(onDebug, onEvent) {
    this.emit = onEvent || (() => {});
    this.on = true;
    this.ready = false;
    this.ctx = null;
    this.gain = null;
    this.liveEl = null;
    this.manifest = null;
    this.bytes = new Map();    // "emotion|text" -> ArrayBuffer (mp3, small)
    this.buffers = new Map();  // "emotion|text" -> AudioBuffer (LRU)
    this.gen = 0;              // bumps on every interrupt
    this.node = null;
    this.speaking = false;
    this.priority = -1;        // priority of whatever is sounding right now
    this.dbg = onDebug || (() => {});
  }

  key(text, emotion) { return emotion + "|" + text; }

  async loadManifest() {
    try {
      const r = await fetch("/audio/manifest.json", { cache: "no-cache" });
      if (!r.ok) throw new Error("no manifest");
      this.manifest = await r.json();
      this.dbg(`audio library: ${Object.keys(this.manifest.clips).length} clips`);
    } catch {
      this.manifest = { clips: {} };
      this.dbg("audio library MISSING — run npm run pregen (everything goes live)");
    }
  }

  /** must be called from inside a user gesture (iOS) */
  async unlock() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});

    this.liveEl = new Audio();
    this.liveEl.preload = "auto";
    this.liveEl.playsInline = true;
    this.liveEl.crossOrigin = "anonymous";
    try {
      this.liveEl.src = SILENT_WAV;
      // never await this: a play() promise on media that stalls resolves
      // NEITHER way, and the whole voice would be stuck behind it
      const p = this.liveEl.play();
      if (p) p.then(() => this.liveEl.pause()).catch(() => {});
    } catch { /* some browsers don't need it */ }

    this.ready = true;
    this.prefetch();
  }

  /** pull the whole library into memory as mp3 bytes (small); decode on demand */
  async prefetch() {
    if (!this.manifest) return;
    const entries = Object.entries(this.manifest.clips);
    let i = 0;
    const worker = async () => {
      while (i < entries.length) {
        const [k, c] = entries[i++];
        if (this.bytes.has(k)) continue;
        try {
          const r = await fetch("/audio/" + c.file);
          if (r.ok) this.bytes.set(k, await r.arrayBuffer());
        } catch { /* it'll fall back to live */ }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    this.dbg(`audio library cached: ${this.bytes.size} clips`);
  }

  async buffer(key) {
    if (this.buffers.has(key)) return this.buffers.get(key);
    let bytes = this.bytes.get(key);
    if (!bytes) {
      const c = this.manifest?.clips[key];
      if (!c) return null;
      const r = await fetch("/audio/" + c.file);
      if (!r.ok) return null;
      bytes = await r.arrayBuffer();
      this.bytes.set(key, bytes);
    }
    const buf = await this.ctx.decodeAudioData(bytes.slice(0));
    if (this.buffers.size > 60) this.buffers.delete(this.buffers.keys().next().value);
    this.buffers.set(key, buf);
    return buf;
  }

  stop() {
    this.gen++;
    this.speaking = false;
    this.priority = -1;
    if (this.node) { try { this.node.stop(); } catch {} this.node = null; }
    if (this.liveEl) { try { this.liveEl.pause(); this.liveEl.removeAttribute("src"); } catch {} }
  }

  setEnabled(on) { this.on = on; if (!on) this.stop(); }

  /** is a line we paid Claude for sounding right now? */
  isSpeakingAI() { return this.speaking && this.priority === PRIORITY.ai; }

  /**
   * segments: [{text, emotion, profile}] — played back to back.
   * An oath + reflex line is two library clips, not one live call.
   * priority: "ambient" (murmurs, reflexes, openers) | "vamp" | "ai"
   */
  async speak(segments, priority = "ambient", opts = {}) {
    if (!this.on || !this.ready) return;
    const p = PRIORITY[priority] ?? PRIORITY.ambient;
    // dropped, never queued — a murmur that arrives late is not worth hearing
    if (this.speaking && p < this.priority) {
      this.dbg(`audio: held back a ${priority} line, he is mid-sentence`);
      this.emit("held", `${priority}: ${segments[0]?.text || ""}`);
      return;
    }
    this.stop();
    const gen = this.gen;
    this.speaking = true;
    this.priority = p;
    for (const seg of segments) {
      if (gen !== this.gen) return;
      // the censor tone is synthesised on the spot — nothing to fetch, nothing
      // to store, and the bleeped word never exists as audio anywhere.
      // MUST come before the empty-text guard: a bleep segment has no text.
      if (seg.bleep) {
        this.emit("bleep", "%#@!");
        try { await this.playBleep(gen); } catch (e) { this.dbg("bleep: " + e.message); }
        continue;
      }
      if (!seg.text || !seg.text.trim()) continue;
      const emotion = seg.emotion || "suspicion";
      if (emotion === "stare") continue;          // silence IS the read
      const key = this.key(seg.text, emotion);
      const has = this.manifest?.clips[key];
      try {
        // the ticker records what actually reached the speaker, not what was asked for
        this.emit(seg.kind || priority, seg.text);
        // fires the instant sound is actually audible — the number latency work lives on
        const first = () => { if (opts.onFirstSound) { const f = opts.onFirstSound; opts.onFirstSound = null; f(); } };
        if (has) await this.playLocal(key, gen, QUIET.has(emotion) ? 0.6 : 1, first);
        else await this.playLive(seg.text, emotion, seg.profile || "fast", gen, first);
      } catch (e) { this.dbg("audio: " + e.message); }
    }
    if (gen === this.gen) { this.speaking = false; this.priority = -1; }
  }

  /** the classic 1kHz censor tone, with a short fade so it doesn't click */
  playBleep(gen, ms = 380) {
    return new Promise((resolve) => {
      if (gen !== this.gen) return resolve();
      const t = this.ctx.currentTime, dur = ms / 1000;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1000, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.28, t + 0.012);
      g.gain.setValueAtTime(0.28, t + dur - 0.012);
      g.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(g); g.connect(this.gain);
      osc.onended = () => resolve();
      this.node = osc;
      osc.start(t);
      osc.stop(t + dur);
    });
  }

  playLocal(key, gen, vol, onFirstSound) {
    return new Promise(async (resolve) => {
      const buf = await this.buffer(key);
      if (!buf || gen !== this.gen) return resolve();
      const g = this.ctx.createGain();
      g.gain.value = vol;
      g.connect(this.gain);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      src.onended = () => resolve();
      this.node = src;
      src.start();
      if (onFirstSound) onFirstSound();
    });
  }

  playLive(text, emotion, profile, gen, onFirstSound) {
    return new Promise((resolve) => {
      const el = this.liveEl;
      const url = `/api/tts?profile=${profile}&emotion=${encodeURIComponent(emotion)}&text=${encodeURIComponent(text)}`;
      const t0 = performance.now();
      let done = false;
      const finish = () => { if (!done) { done = true; cleanup(); resolve(); } };
      const onPlay = () => {
        this.dbg(`tts first sound ${Math.round(performance.now() - t0)}ms`);
        if (onFirstSound) onFirstSound();
      };
      const cleanup = () => {
        el.removeEventListener("ended", finish);
        el.removeEventListener("error", finish);
        el.removeEventListener("playing", onPlay);
      };
      el.addEventListener("ended", finish);
      el.addEventListener("error", finish);
      el.addEventListener("playing", onPlay);
      el.src = url;                 // the GET (and therefore synthesis) starts here
      el.play().catch(finish);
      // safety: never hang the line queue on a stalled stream
      setTimeout(finish, 20000);
    });
  }

  /**
   * Kick off synthesis for a line we know is coming (the round opener, decided
   * at "3"). The server banks it, so the real request plays off disk.
   */
  warm(text, emotion = "suspicion", profile = "fast") {
    if (!this.on || !text) return;
    if (this.manifest?.clips[this.key(text, emotion)]) return; // already a file
    const url = `/api/tts?profile=${profile}&emotion=${encodeURIComponent(emotion)}&text=${encodeURIComponent(text)}`;
    fetch(url).then((r) => r.arrayBuffer()).catch(() => {});
  }
}
