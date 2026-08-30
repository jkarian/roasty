#!/usr/bin/env node
/* =========================================================
   Pre-generate Roasty's free audio library.
   Every murmur, vamp, reflex line, artist oath and opener template becomes
   an .mp3 on disk. The game plays those locally at zero latency and zero
   cost; ONLY the AI-written lines ever hit live TTS.

     node scripts/pregen-audio.mjs              generate what's missing
     node scripts/pregen-audio.mjs --dry-run    show the bill, write nothing
     node scripts/pregen-audio.mjs --group=vamp only one group
     node scripts/pregen-audio.mjs --force      re-cut everything
     node scripts/pregen-audio.mjs --probe      one line, to audition settings
   Groups: vamp murmur oath reflex opener closefallback fixed
   ========================================================= */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { CONFIG, ROOT } from "../lib/config.mjs";
import { synth, clipId, taggedText, mp3Seconds, minPlausibleSeconds } from "../lib/eleven.mjs";
import { buildAudioLibrary } from "../public/js/lines.js";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const a = args.find((x) => x.startsWith(f + "=")); return a ? a.split("=")[1] : null; };

const DRY = has("--dry-run");
const FORCE = has("--force");
const YES = has("--yes") || has("-y");
const ONLY = val("--group");
const LIMIT = parseInt(val("--limit") || "0", 10);
const PROFILE = val("--profile") || "rich";   // bake the library at the good quality
// ElevenLabs caps concurrent requests per plan (2 on the free/starter tiers)
const CONCURRENCY = parseInt(val("--concurrency") || "2", 10);

const OUT = path.join(ROOT, "public", "audio");
const MANIFEST = path.join(OUT, "manifest.json");

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(q, (a) => { rl.close(); r(a.trim().toLowerCase()); }));
}

async function probe() {
  const text = "Okay. Okay okay okay. We're drawing. Good.";
  console.log(`probe  voice ${CONFIG.voiceId}  model ${CONFIG.eleven[PROFILE].model}`);
  console.log(`sent   ${taggedText(text, "suspicion", CONFIG.eleven[PROFILE].model)}`);
  const t0 = Date.now();
  const res = await synth(text, "suspicion", PROFILE);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.mkdir(OUT, { recursive: true });
  const file = path.join(OUT, "_probe.mp3");
  await fsp.writeFile(file, buf);
  console.log(`ok     ${buf.length} bytes in ${Date.now() - t0}ms -> ${file}`);
}

/* Sweep the library for clips that are too short to be a real reading —
   the signature of a throttled 200 response — and bin them so the next
   normal run cuts them again. */
async function verify() {
  const bad = [];
  let ok = 0;
  for (const c of buildAudioLibrary()) {
    const file = path.join(OUT, `${c.group}-${clipId(c.text, c.emotion)}.mp3`);
    if (!fs.existsSync(file)) continue;
    const sec = mp3Seconds(await fsp.readFile(file));
    if (sec < minPlausibleSeconds(c.text)) bad.push({ file, sec, text: c.text });
    else ok++;
  }
  console.log(`${ok} clips sound real, ${bad.length} are too short to be speech.`);
  bad.slice(0, 10).forEach((b) => console.log(`  ${b.sec.toFixed(2)}s  ${b.text.slice(0, 56)}`));
  if (bad.length > 10) console.log(`  ...and ${bad.length - 10} more`);
  if (!bad.length || DRY) return;
  if (!YES) {
    const a = await ask(`delete ${bad.length} dead clips so they get re-cut? [y/N] `);
    if (a !== "y" && a !== "yes") return console.log("left alone.");
  }
  for (const b of bad) await fsp.unlink(b.file);
  console.log(`deleted ${bad.length}. re-run without --verify to cut them again.`);
}

async function main() {
  if (!CONFIG.elevenKey) {
    console.error("ELEVENLABS_API_KEY is not set. Copy .env.example to .env and fill it in\n(or run: npm run keys).");
    process.exit(1);
  }
  if (has("--probe")) return probe();

  await fsp.mkdir(OUT, { recursive: true });
  if (has("--verify")) return verify();
  let lib = buildAudioLibrary();
  if (ONLY) lib = lib.filter((c) => c.group === ONLY);
  if (LIMIT) lib = lib.slice(0, LIMIT);

  const clips = lib.map((c) => ({ ...c, file: `${c.group}-${clipId(c.text, c.emotion)}.mp3` }));
  const todo = clips.filter((c) => FORCE || !fs.existsSync(path.join(OUT, c.file)));
  const chars = todo.reduce((n, c) => n + taggedText(c.text, c.emotion, CONFIG.eleven[PROFILE].model).length, 0);

  const byGroup = {};
  for (const c of todo) byGroup[c.group] = (byGroup[c.group] || 0) + 1;

  console.log(`library   ${clips.length} clips`);
  console.log(`to cut    ${todo.length} ${JSON.stringify(byGroup)}`);
  console.log(`model     ${CONFIG.eleven[PROFILE].model} @ ${CONFIG.eleven[PROFILE].format}`);
  console.log(`billed    ~${chars} credits (1 per character, emotion tags included)`);

  if (DRY) return;
  if (todo.length && !YES) {
    const a = await ask("cut them? [y/N] ");
    if (a !== "y" && a !== "yes") return console.log("nothing written.");
  }

  let done = 0, failed = 0;
  let i = 0;
  let drained = null;   // set once the account stops delivering real audio
  const worker = async () => {
    while (i < todo.length && !drained) {
      const c = todo[i++];
      const dest = path.join(OUT, c.file);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await synth(c.text, c.emotion, PROFILE, { stream: false });
          const buf = Buffer.from(await res.arrayBuffer());
          // a throttled account answers 200 with ~0.3s of nothing — don't bake that
          const sec = mp3Seconds(buf);
          const need = minPlausibleSeconds(c.text);
          if (sec < need) {
            // A 200 carrying a third of a second of nothing means the credits
            // ran out mid-request. Retrying bills again and gets another stub,
            // so stop the whole run here rather than grinding through the queue.
            drained = `got ${sec.toFixed(2)}s of audio for a ${c.text.length}-character line`;
            break;
          }
          await fsp.writeFile(dest, buf);
          done++;
          console.log(`  ${String(done + failed).padStart(3)}/${todo.length}  ${c.group.padEnd(13)} ${sec.toFixed(1).padStart(4)}s  ${c.text.slice(0, 46)}`);
          break;
        } catch (e) {
          if (/quota_exceeded|detected_unusual_activity/.test(e.message)) {
            drained = e.message.slice(0, 160);
            break;
          }
          if (attempt === 2) {
            failed++;
            console.error(`  FAILED  ${c.text.slice(0, 46)} — ${e.message}`);
          } else {
            await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
          }
        }
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // manifest covers every clip that actually exists on disk
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    voiceId: CONFIG.voiceId,
    model: CONFIG.eleven[PROFILE].model,
    format: CONFIG.eleven[PROFILE].format,
    clips: {}
  };
  for (const c of buildAudioLibrary()) {
    const file = `${c.group}-${clipId(c.text, c.emotion)}.mp3`;
    if (fs.existsSync(path.join(OUT, file)))
      manifest.clips[c.emotion + "|" + c.text] = { file, group: c.group };
  }
  await fsp.writeFile(MANIFEST, JSON.stringify(manifest, null, 1));

  console.log(`\ndone. ${done} cut, ${failed} failed, ${Object.keys(manifest.clips).length} clips in the library.`);
  if (drained) {
    const left = todo.length - done - failed;
    const owed = todo.slice(done + failed).reduce((n, c) => n + taggedText(c.text, c.emotion, CONFIG.eleven[PROFILE].model).length, 0);
    console.log(`\nSTOPPED — the ElevenLabs credits ran out: ${drained}`);
    console.log(`${left} clips still to cut, ~${owed} credits. Top up, then re-run (existing files are skipped).`);
  } else if (failed) console.log("re-run to retry the failures (existing files are skipped).");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
