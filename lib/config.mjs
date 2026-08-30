/* Tiny .env loader + config. No dependencies: the whole point of this app is
   that `node server.js` just works. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadEnv(file = path.join(ROOT, ".env")) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (let line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
    if (process.env[k] === undefined) process.env[k] = v; // real env wins
  }
  return out;
}

loadEnv();

const E = process.env;
const num = (v, d) => (v === undefined || v === "" || isNaN(parseFloat(v)) ? d : parseFloat(v));

/* Models that honour v3 audio tags ([nervous], [screaming], ...).
   Anything else gets the tags stripped before synthesis — a turbo/flash
   model would otherwise read "[worried, faster]" out loud. */
export const TAG_MODELS = new Set(["eleven_v3", "eleven_v3_alpha"]);

export const CONFIG = {
  port: parseInt(E.PORT || "8787", 10),
  host: E.HOST || "0.0.0.0",

  anthropicKey: E.ANTHROPIC_API_KEY || "",
  elevenKey: E.ELEVENLABS_API_KEY || "",
  voiceId: E.ELEVENLABS_VOICE_ID || "Ym1lepVbBruoa0yJFohT", // docs/voice.md

  claudeModels: {
    // the Guesser only has to name what it sees — the fastest model we have.
    // The Writer is where the comedy lives; it stays on Sonnet.
    guess: E.CLAUDE_MODEL_GUESS || "claude-haiku-4-5",
    write: E.CLAUDE_MODEL_WRITE || "claude-sonnet-5",
    close: E.CLAUDE_MODEL_CLOSE || "claude-sonnet-5"
  },
  // adaptive thinking costs whole seconds per line; the product lives on latency
  thinking: (E.CLAUDE_THINKING || "off").toLowerCase() === "adaptive"
    ? { type: "adaptive" }
    : { type: "disabled" },

  eleven: {
    fast: {
      model: E.ELEVEN_MODEL_FAST || "eleven_v3",
      format: E.ELEVEN_FORMAT_FAST || "mp3_22050_32",
      // 0=none .. 4=max. Trades a little pronunciation care for first-byte speed.
      latency: E.ELEVEN_LATENCY_FAST === undefined ? 4 : parseInt(E.ELEVEN_LATENCY_FAST, 10)
    },
    rich: {
      model: E.ELEVEN_MODEL_RICH || "eleven_v3",
      format: E.ELEVEN_FORMAT_RICH || "mp3_44100_128",
      latency: E.ELEVEN_LATENCY_RICH === undefined ? 0 : parseInt(E.ELEVEN_LATENCY_RICH, 10)
    },
    stability: num(E.ELEVEN_STABILITY, 0.0),
    similarity: num(E.ELEVEN_SIMILARITY, 0.75),
    style: num(E.ELEVEN_STYLE, 0.6),
    speed: num(E.ELEVEN_SPEED, 1.0)
  }
};

export const supportsTags = (model) => TAG_MODELS.has(model);
