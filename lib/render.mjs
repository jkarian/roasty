/* =========================================================
   Wall Label render: the post, framed on the gallery wall, with the
   narration, the quacks and the music bed mixed in. One vertical MP4
   (1080x1920, H.264 + AAC) that Reels and TikTok both take as-is.
   ========================================================= */
import { spawn } from "node:child_process";
import fs from "node:fs";
import ffmpegPath from "ffmpeg-static";
import { mp3Seconds } from "./eleven.mjs";

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
 * @param out       the .mp4 to write
 */
export function renderLabel({ media, clips, music, musicVolume = 0.4, target = 0, out }) {
  const narration = clips.reduce((s, f) => s + audioSeconds(f), 0);
  // he is never cut off: the film runs past the target if the narration needs it
  const T = +Math.max(target || media.seconds || 0, LEAD + narration + TAIL).toFixed(3);

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
    `[wall][fg]overlay=x=(W-w)/2:y=(H-h)/2-60[v]`,
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
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", (code) => code === 0
      ? resolve({ seconds: T, narration })
      : reject(new Error("ffmpeg: " + (err.trim().split("\n").pop() || "exit " + code))));
  });
}
