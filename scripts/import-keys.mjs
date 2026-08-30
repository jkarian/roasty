#!/usr/bin/env node
/* Pull the API keys out of keys.txt into .env, without printing them.
   Usage: npm run keys [-- path/to/keys.txt] */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../lib/config.mjs";

const src = process.argv[2] || path.join(ROOT, "keys.txt");
const dest = path.join(ROOT, ".env");

if (!fs.existsSync(src)) {
  console.error(`no such file: ${src}`);
  process.exit(1);
}
const raw = fs.readFileSync(src, "utf8");

const found = {};
// explicit KEY=VALUE / KEY: VALUE lines win
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*[:=]\s*(\S+)\s*$/);
  if (!m) continue;
  const k = m[1].toUpperCase();
  if (/ANTHROPIC/.test(k)) found.ANTHROPIC_API_KEY ||= m[2];
  else if (/ELEVEN|XI_API/.test(k)) found.ELEVENLABS_API_KEY ||= m[2];
  else if (/VOICE/.test(k)) found.ELEVENLABS_VOICE_ID ||= m[2];
}
// then bare tokens anywhere in the file
const anth = raw.match(/sk-ant-[A-Za-z0-9_\-]{20,}/);
if (anth) found.ANTHROPIC_API_KEY ||= anth[0];
const el = raw.match(/\bsk_[A-Za-z0-9]{32,}/);
if (el) found.ELEVENLABS_API_KEY ||= el[0];

if (!found.ANTHROPIC_API_KEY && !found.ELEVENLABS_API_KEY) {
  console.error(`found no recognisable keys in ${src}.
Expected lines like:
  ANTHROPIC_API_KEY=sk-ant-...
  ELEVENLABS_API_KEY=sk_...`);
  process.exit(1);
}

// merge into an existing .env rather than clobbering it
const template = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
let env = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : template;
for (const [k, v] of Object.entries(found)) {
  env = new RegExp(`^${k}=.*$`, "m").test(env)
    ? env.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`)
    : env.trimEnd() + `\n${k}=${v}\n`;
}
fs.writeFileSync(dest, env);

console.log(`wrote ${dest}`);
for (const k of Object.keys(found)) console.log(`  ${k}  set (${found[k].length} chars)`);
console.log("\nkeys.txt is gitignored, but you can delete it now — .env is the source of truth.");
