/* =========================================================
   Wall Label render: the post, framed on the gallery wall, with the
   narration, the quacks and the music bed mixed in. One vertical MP4
   (1080x1920, H.264 + AAC) that Reels and TikTok both take as-is.
   ========================================================= */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { mp3Seconds } from "./eleven.mjs";
import { ROOT } from "./config.mjs";

const W = 1080, H = 1920, FPS = 30;
const LEAD = 0.6;  // wall before he starts talking
const TAIL = 1.5;  // wall after he stops, while the music fades
const WALL = "0xefe9dc", FRAME = "0x3a2f24", GILT = "0xc9a13b";

/** length of a PCM wav, from its header */
export function wavSeconds(buf) {
  let o = 12, rate = 0, data = 0;
  while (o < buf.length - 8) {
    const id = buf.toString("ascii", o, o + 4), sz = buf.readUInt32LE(o + 4);
    if (id === "fmt ") rate = buf.readUInt32LE(o + 16); // bytes per second
    if (id === "data") { data = sz; break; }
    o += 8 + sz + (sz & 1);
  }
  return rate ? data / rate : 0;
}

export const audioSeconds = (file) => {
  const buf = fs.readFileSync(file);
  return /\.wav$/i.test(file) ? wavSeconds(buf) : mp3Seconds(buf);
};

/**
 * @param media     { file, kind: "image"|"video", seconds }  (seconds: clip length, 0 for a still)
 * @param clips     audio files in play order: narration segments and quacks
 * @param music     a music file, looped and faded to length; null for none
 * @param target    running time (20/30/45/60). The video is exactly this long unless
 *                  the narration overruns it; a longer clip is cut. 0 = fit the clip.
 * @param words     per clip: [{ text, start, end }] (seconds within that clip) to burn in
 *                  as subtitles, or null for none on that clip (the quacks). null = no subtitles.
 * @param out       the .mp4 to write
 */
export function renderLabel({ media, clips, music, musicVolume = 0.4, target = 0, words = null, out }) {
  const lengths = clips.map(audioSeconds);
  const narration = lengths.reduce((a, b) => a + b, 0);
  // he is never cut off: the film runs past the target if the narration needs it
  const T = +Math.max(target || media.seconds || 0, LEAD + narration + TAIL).toFixed(3);

  const subs = words ? writeSubs(words, lengths, out) : null;

  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  if (media.kind === "image") args.push("-loop", "1", "-framerate", String(FPS));
  // a clip shorter than the film loops, like the bench plays it; a frozen last frame reads as broken
  else args.push("-stream_loop", "-1");
  args.push("-i", media.file);
  for (const f of clips) args.push("-i", f);
  if (music) args.push("-stream_loop", "-1", "-i", music);

  const n = clips.length;
  const norm = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  const f = [
    // the piece, fitted, in a dark frame with a gilt edge, hung a little above centre
    `[0:v]fps=${FPS},scale=w=960:h=1500:force_original_aspect_ratio=decrease,` +
      `pad=w=iw+20:h=ih+20:x=10:y=10:color=${FRAME},pad=w=iw+4:h=ih+4:x=2:y=2:color=${GILT},setsar=1[fg]`,
    `color=c=${WALL}:s=${W}x${H}:r=${FPS}:d=${T}[wall]`,
    `[wall][fg]overlay=x=(W-w)/2:y=(H-h)/2-60` +
      (subs ? `[pic];[pic]ass=${subs.rel}:fontsdir=assets/fonts[v]` : "[v]"),
    ...clips.map((_, i) => `[${i + 1}:a]${norm}[s${i}]`),
    `${clips.map((_, i) => `[s${i}]`).join("")}concat=n=${n}:v=0:a=1,adelay=${LEAD * 1000}:all=1,apad=whole_dur=${T}[narr]`
  ];
  if (music) {
    f.push(
      `[narr]asplit=2[nv][key]`,
      // tracks are mastered ~5 dB apart; level them first so the volume means the same for all
      `[${n + 1}:a]loudnorm=I=-18:TP=-2:LRA=11,${norm},atrim=0:${T},volume=${musicVolume}[mus]`,
      // the music ducks whenever he talks
      `[mus][key]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=450[bed]`,
      `[nv][bed]amix=inputs=2:duration=first:normalize=0,afade=t=out:st=${T - TAIL}:d=${TAIL},alimiter=limit=0.95[a]`
    );
  } else {
    f.push(`[narr]anull[a]`);
  }
  args.push(
    "-filter_complex", f.join(";"),
    "-map", "[v]", "-map", "[a]", "-t", String(T),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    out
  );

  return new Promise((resolve, reject) => {
    // cwd = repo root, so the ass filter gets short relative paths (a Windows
    // drive colon would break its option syntax)
    const p = spawn(ffmpegPath, args, { windowsHide: true, cwd: ROOT });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", (code) => {
      if (subs) fs.rmSync(subs.abs, { force: true });
      if (code === 0) resolve({ seconds: T, narration });
      else reject(new Error("ffmpeg: " + (err.trim().split("\n").pop() || "exit " + code)));
    });
  });
}

/* ---------- subtitles: style B, "film print" ----------
   Bold white serif (Gelasio, a free Georgia-alike in assets/fonts) with a
   black outline, lower third of the picture, a few words at a time in step
   with his voice. Kept clear of the Reels/TikTok buttons on the right. */
const SUB_STYLE = "Style: S,Gelasio,80,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,1,0,1,5,3,2,120,170,430,1";

/** words on the film's timeline -> short chunks: up to 3 words, fewer at punctuation */
function chunkWords(all) {
  const out = [];
  let cur = [];
  const flush = () => { if (cur.length) out.push(cur); cur = []; };
  for (const w of all) {
    cur.push(w);
    const chars = cur.map((x) => x.text).join(" ").length;
    if (cur.length >= 3 || chars >= 18 || /[.!?,;:…]["'”’)]*$/.test(w.text)) flush();
  }
  flush();
  return out.map((c, i) => {
    const next = out[i + 1];
    const said = c[c.length - 1].end + 0.25;
    // hold until the next chunk across short gaps; clear the screen when he pauses
    const end = next ? (next[0].start - said < 0.6 ? next[0].start : said) : said;
    return { text: c.map((x) => x.text).join(" "), start: c[0].start, end };
  });
}

const assTime = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

/** this render's .ass file, in cache/label/ (removed after); null if there's nothing to show */
function writeSubs(words, lengths, out) {
  const all = [];
  let t = LEAD;
  words.forEach((ws, i) => {
    for (const w of ws || []) all.push({ text: w.text, start: t + w.start, end: t + w.end });
    t += lengths[i];
  });
  if (!all.length) return null;
  const events = chunkWords(all).map((c) =>
    `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},S,,0,0,0,,${c.text.replace(/[{}\\]/g, "")}`);
  const ass = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${W}`, `PlayResY: ${H}`, "WrapStyle: 0", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    SUB_STYLE, "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events, ""
  ].join("\n");
  const dir = path.join(ROOT, "cache", "label");
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, path.basename(out).replace(/\.mp4$/i, "") + ".ass");
  fs.writeFileSync(abs, ass);
  return { abs, rel: path.relative(ROOT, abs).split(path.sep).join("/") };
}
