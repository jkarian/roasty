/* =========================================================
   ROASTY — humor test bench (local build)
   Pipeline: canvas snapshot -> blind Guesser -> local match
   check -> Writer (bible) -> pick line -> bubble + expression + voice

   Ported from poc/roasty-poc.html. The bible, the prompts, the trigger
   timings and the comedy stack are VERBATIM. What changed: the keys moved
   server-side, and say() now goes to Roasty's real voice.
   ========================================================= */
import {
  WORDS, VAMPS, MURMURS, REFLEX, REFLEX_FACE, EXCLAIMS,
  OPENERS, REPEAT_WORDS, repeatOpener, winFallback,
  tierFor, poolFor, hasBleep, splitBleep, bleepForScreen, hasProfanity
} from "./lines.js";
import { RoastyAudio } from "./audio.js";
import { Ticker } from "./ticker.js";

/* ---------- word list (tiered) ---------- */
function pickWord(round){
  // adaptive: winning pushes you into harder words — the comedy lives where you struggle
  let tier;
  if(S.streak>=3) tier = Math.random()<.5 ? "hard" : "medium";
  else if(S.streak>=1 || round>=3) tier = "medium";
  else tier = "easy";
  const list = WORDS[tier];
  return list[Math.floor(Math.random()*list.length)];
}

/* ---------- character bible (docs/roasty-bible.md, editable in-app) ---------- */
let DEFAULT_BIBLE = "";
let bible = "";

/* ---------- state ---------- */
const S = {
  phase:"idle",          // idle | countdown | drawing | done
  word:"", round:0, wins:0, streak:0,
  timeLeft:30, timerId:null,
  strokes:[], current:null, dirty:false,
  saidLines:[], guesses:[], lastDetails:[], lastResembles:"",
  busy:false, guessMoments:[4,10,16,22], nextMoment:0,
  won:false
};

/* ---------- canvas ---------- */
const pad = document.getElementById("pad");
const ctx = pad.getContext("2d");
function sizeCanvas(){
  const r = pad.getBoundingClientRect();
  const d = window.devicePixelRatio||1;
  pad.width = r.width*d; pad.height = r.height*d;
  ctx.setTransform(d,0,0,d,0,0);
  redraw();
}
window.addEventListener("resize",sizeCanvas);

function redraw(){
  const r = pad.getBoundingClientRect();
  ctx.fillStyle="#fffdf7"; ctx.fillRect(0,0,r.width,r.height);
  ctx.lineCap="round"; ctx.lineJoin="round";
  ctx.strokeStyle="#1d1a16"; ctx.lineWidth=4;
  for(const s of S.strokes) drawStroke(s);
  if(S.current) drawStroke(S.current);
}
function drawStroke(s){
  if(s.length<2) return;
  ctx.beginPath(); ctx.moveTo(s[0].x,s[0].y);
  for(let i=1;i<s.length;i++) ctx.lineTo(s[i].x,s[i].y);
  ctx.stroke();
}
function pos(e){
  const r = pad.getBoundingClientRect();
  return {x:e.clientX-r.left, y:e.clientY-r.top};
}
pad.addEventListener("pointerdown",e=>{
  if(S.phase!=="drawing")return;
  pad.setPointerCapture(e.pointerId);
  S.current=[pos(e)];
});
pad.addEventListener("pointermove",e=>{
  if(!S.current)return;
  const p=pos(e);
  S.current.push(p); redraw();
  // eyes follow the pen
  const r=pad.getBoundingClientRect();
  pupil.setAttribute("cx",59+ (p.x/r.width)*5);
  pupil.setAttribute("cy",26+ (p.y/r.height)*4);
});
pad.addEventListener("pointerup",()=>{
  if(!S.current)return;
  if(S.current.length>1){
    const wasStalled = S.lastStrokeAt && Date.now()-S.lastStrokeAt>5000;
    S.strokes.push(S.current); S.dirty=true; S.lastStrokeAt=Date.now();
    if(!S.hadFirstStroke){ S.hadFirstStroke=true; reflex("first"); }
    else if(wasStalled){ reflex("resume","alarm"); }
    else {
      const k=strokeKind(S.current);
      const spoke = k && canReflex();
      if(spoke) reflex(k, k==="scribble"||k==="shaky"?"alarm":"suspicion");
      else murmur(); // no joke available — he still makes a noise
    }
  }
  S.current=null; redraw();
});
document.getElementById("undoBtn").onclick=()=>{ S.strokes.pop(); S.dirty=true; redraw(); };
document.getElementById("clearBtn").onclick=()=>{
  if(!S.strokes.length)return;
  S.strokes=[]; S.dirty=true; redraw();
  say("Oh. Oh, we're starting OVER. Bold use of our week.", "alarm");
};

function snapshotB64(){
  // downscale + JPEG for a small payload
  const tmp=document.createElement("canvas");
  const w=320, h=Math.max(64,Math.round(320*(pad.height/pad.width)))||320;
  tmp.width=w; tmp.height=h;
  const t=tmp.getContext("2d");
  t.fillStyle="#ffffff"; t.fillRect(0,0,w,h);
  t.drawImage(pad,0,0,w,h);
  return tmp.toDataURL("image/jpeg",0.8).split(",")[1];
}

/* ---------- joke log ---------- */
const JOKES=[]; // {round, word, kind, line, guess, rating}
function logJoke(kind,line,guess,mode){
  if(!line||line==="__SILENCE__")return;
  JOKES.push({round:S.round,word:S.word,kind,line,guess:guess||"",rating:"",mode:mode||"classic"});
  renderJokes();
}
function renderJokes(){
  const el=document.getElementById("jokeList"); if(!el)return;
  el.innerHTML=JOKES.map((j,i)=>
    `<div style="padding:5px 2px;border-bottom:1px dashed #d8d2c4">
      <span style="color:var(--quiet)">r${j.round} · ${j.word} · ${j.kind}${j.guess?" · guessed: "+j.guess:""}</span><br>
      “${j.line}”
      <span style="float:right;white-space:nowrap">
        <button data-i="${i}" data-r="funny" style="border:none;background:${j.rating==="funny"?"#cfe8d4":"none"};border-radius:4px;padding:2px 4px">😂</button>
        <button data-i="${i}" data-r="fine" style="border:none;background:${j.rating==="fine"?"#eee3c0":"none"};border-radius:4px;padding:2px 4px">😐</button>
        <button data-i="${i}" data-r="cringe" style="border:none;background:${j.rating==="cringe"?"#f2cfc4":"none"};border-radius:4px;padding:2px 4px">🗑️</button>
      </span>
    </div>`).join("")||"<em>no jokes yet — play a round</em>";
  el.querySelectorAll("button").forEach(b=>b.onclick=()=>{
    JOKES[+b.dataset.i].rating=b.dataset.r; renderJokes();
  });
}
document.getElementById("dumpBtn").onclick=()=>{
  const box=document.getElementById("dumpBox");
  box.style.display="block";
  box.value=JOKES.map(j=>
    `[${j.rating||"unrated"}] (mode:${j.mode||"classic"}, r${j.round}, word:${j.word}, ${j.kind}${j.guess?", guessed:"+j.guess:""}) "${j.line}"`).join("\n")||"(empty)";
  box.focus(); box.select();
};

/* ---------- murmur layer: constant tiny presence, below jokes ---------- */
const MURMUR_EMOTION={early:"murmurNeutral",mid:"murmurConcern",late:"murmurGroan"};

/* Turn a line into playable segments: speech, censor tone, speech.
   A line with no [BLEEP] is just one segment, exactly as before. */
function segmentsFor(text, emotion, kind, profile){
  return splitBleep(text).map(p =>
    p.bleep ? {bleep:true, kind}
            : {text:p.text, emotion, kind, ...(profile?{profile}:{})});
}
function murmur(minGap){
  const now=Date.now();
  if(S.phase!=="drawing")return false;
  // NB: deliberately not gated on S.busy. The gap between the vamp ending and
  // the writer line arriving is exactly where he must not go quiet — what
  // matters is whether something bigger is SOUNDING, which audio decides.
  if(audio.isSpeakingAI())return false;   // he is mid-roast; do not step on it
  if(audio.speaking && audio.priority>0)return false; // nor over a vamp
  if(now-(S.lastMurmurAt||0)<(minGap??MURMUR_MIN))return false;  // 2s floor, every path
  if(now-(S.lastSayAt||0)<1600)return false; // don't step on a real line
  S.lastMurmurAt=now;
  // the composure ladder: which pool he reaches for is the clock's decision
  const tier=tierFor(S.timeLeft);
  const pool=MURMURS[tier];
  const m=pool[Math.floor(Math.random()*pool.length)];
  bubble.classList.add("quiet");
  bubble.classList.remove("thinking");
  bubble.textContent=bleepForScreen(m);
  audio.speak(segmentsFor(m, MURMUR_EMOTION[tier], "murmur"));
  return true;
}

/* ---------- murmur density: keep him present while the pen is moving ----------
   Every 2-4s of ACTIVE drawing he makes a noise. Anything bigger than a murmur
   already playing takes precedence — the scheduler just tries again next tick,
   so a suppressed murmur is skipped rather than queued up. */
const MURMUR_MIN=2000, MURMUR_MAX=4000;
const rollGap=()=>MURMUR_MIN+Math.random()*(MURMUR_MAX-MURMUR_MIN);
function penIsMoving(){
  // pen down, or a stroke landed within the last beat
  return !!S.current || (S.lastStrokeAt && Date.now()-S.lastStrokeAt<1200);
}
function murmurPulse(){
  if(S.phase!=="drawing"||!penIsMoving())return;
  const gap=S.murmurGap||MURMUR_MIN;
  if(Date.now()-(S.lastMurmurAt||0) < gap)return;
  if(murmur(gap)){
    S.murmurGap=rollGap();
  }else if(Date.now()-(S.lastMurmurAt||0) > MURMUR_MAX*2){
    // he has been held back so long the cadence is lost — take the next
    // opening rather than waiting out another full gap
    S.murmurGap=MURMUR_MIN;
  }
}

/* ---------- reflex layer: algorithmic commentary, zero AI ---------- */
const usedReflex={};
function pickReflex(kind){
  // the ladder: composed early, blunt late. urge1/2/3 are flat pools —
  // they already climb by how many times he has had to ask.
  const tier=tierFor(S.timeLeft);
  const pool=poolFor(REFLEX[kind], tier); if(!pool||!pool.length) return null;
  const seen=usedReflex[kind]=usedReflex[kind]||[];
  let avail=pool.filter(l=>!seen.includes(l));
  if(!avail.length){ usedReflex[kind]=[]; avail=pool; }
  const line=avail[Math.floor(Math.random()*avail.length)];
  usedReflex[kind].push(line);
  return line;
}
function canReflex(){
  const now=Date.now();
  return S.phase==="drawing" && !S.busy
    && !audio.isSpeakingAI()          // he is mid-roast; do not step on it
    && now-(S.lastReflexAt||0)>3500
    && now-(S.lastSayAt||0)>2500;
}
function reflex(kind,face){
  if(!canReflex()) return;
  if(kind==="urge"){
    S.urgeCount=(S.urgeCount||0)+1;
    kind = S.urgeCount<=2 ? "urge1" : S.urgeCount<=4 ? "urge2" : "urge3";
    face="alarm";
  }
  let line=pickReflex(kind); if(!line) return;
  const segs=segmentsFor(line, REFLEX_FACE[kind]||"suspicion", "reflex");
  // artist oath spice: at most once per round, on startled kinds
  if(!S.usedExclaim && Math.random()<0.3 && ["scribble","shaky","big","resume","urge3"].includes(kind)){
    S.usedExclaim=true;
    const oath=EXCLAIMS[Math.floor(Math.random()*EXCLAIMS.length)];
    line=oath+" "+line;
    face="alarm";
    segs.unshift(...segmentsFor(oath,"oath","reflex")); // two library clips, not one live call
  }
  S.lastReflexAt=Date.now();
  say(line,face||"suspicion",segs);
  logJoke("reflex:"+kind,line);
}
function strokeKind(s){
  if(s.length<3) return "dot";
  let len=0,minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9,dirChanges=0;
  for(let i=1;i<s.length;i++){
    len+=Math.hypot(s[i].x-s[i-1].x,s[i].y-s[i-1].y);
    minX=Math.min(minX,s[i].x);maxX=Math.max(maxX,s[i].x);
    minY=Math.min(minY,s[i].y);maxY=Math.max(maxY,s[i].y);
    if(i>1){
      const c=(s[i-1].x-s[i-2].x)*(s[i].y-s[i-1].y)-(s[i-1].y-s[i-2].y)*(s[i].x-s[i-1].x);
      if(i>2 && Math.sign(c)!==0 && Math.sign(c)!==strokeKind._p) dirChanges++;
      strokeKind._p=Math.sign(c)||strokeKind._p;
    }
  }
  const w=maxX-minX,h=maxY-minY,diag=Math.hypot(w,h)||1;
  const closure=Math.hypot(s[0].x-s[s.length-1].x,s[0].y-s[s.length-1].y);
  const chord=closure, straightness=chord/(len||1);
  const r=pad.getBoundingClientRect();
  if(len<16) return "dot";
  if(len>90 && closure<0.22*len && w>20 && h>20 && w/h>0.45 && w/h<2.2) return "circle";
  if(len>420 && len/diag>4) return "scribble";
  if(len>70 && straightness>0.93) return "straight";
  if(len>90 && dirChanges/s.length>0.32) return "shaky";
  if(w>r.width*0.6||h>r.height*0.6) return "big";
  return null;
}

const wrap=document.getElementById("duckSvgWrap");
const lid=document.getElementById("lid"), brow=document.getElementById("brow"),
      pupil=document.getElementById("pupil"), sweat=document.getElementById("sweat"),
      beakBot=document.getElementById("beakBot"), eyeWhite=document.getElementById("eyeWhite");
function setFace(mode){
  wrap.classList.toggle("melt", mode==="meltdown");
  // defaults
  lid.setAttribute("height","0");
  brow.setAttribute("d","M50 18 L70 16");
  pupil.setAttribute("r","3.2"); pupil.setAttribute("cx","62");
  sweat.setAttribute("opacity","0");
  eyeWhite.setAttribute("r","8");
  beakBot.setAttribute("d","M74 40 q13 0 17 3 q-6 5 -17 2 z");
  if(mode==="suspicion"){
    lid.setAttribute("height","7");
    brow.setAttribute("d","M50 15 L70 20");
  }else if(mode==="alarm"){
    eyeWhite.setAttribute("r","9.5"); pupil.setAttribute("r","2.6");
    sweat.setAttribute("opacity","1");
    brow.setAttribute("d","M50 13 L70 12");
  }else if(mode==="meltdown"){
    eyeWhite.setAttribute("r","10"); pupil.setAttribute("r","2.2");
    sweat.setAttribute("opacity","1");
    brow.setAttribute("d","M50 20 L70 12");
    beakBot.setAttribute("d","M74 40 q13 4 16 9 q-7 3 -16 -3 z");
  }else if(mode==="stare"){ // dead silence
    lid.setAttribute("height","9");
    brow.setAttribute("d","M50 17 L70 17");
    pupil.setAttribute("cx","60");
  }else if(mode==="defeat"){
    lid.setAttribute("height","10");
    brow.setAttribute("d","M50 20 L70 22");
  }else if(mode==="grudge"){ // reluctant respect
    lid.setAttribute("height","6");
    brow.setAttribute("d","M50 16 L70 18");
  }
}
setFace("suspicion");

/* ---------- voice: ElevenLabs, Ym1lepVbBruoa0yJFohT ---------- */
const ticker = new Ticker();
const audio = new RoastyAudio(dbg, (type, detail) => ticker.push(type, detail));
const voiceBtn=document.getElementById("voiceBtn");
voiceBtn.classList.add("on");
voiceBtn.onclick=()=>{
  const on=!audio.on;
  audio.setEnabled(on);
  voiceBtn.classList.toggle("on",on);
  voiceBtn.textContent=on?"🔊 voice":"🔇 muted";
};

/* ---------- speech ---------- */
const bubble=document.getElementById("bubble");
function say(text,face,segments,priority,kind,opts){
  bubble.classList.remove("quiet","thinking");
  if(text==="__SILENCE__"){
    bubble.innerHTML='<span class="stagedir">( he says nothing. he just looks at it. )</span>';
    setFace("stare");
    audio.stop();
    return;
  }
  bubble.textContent=bleepForScreen(text);          // [BLEEP] -> %#@!
  if(face) setFace(face);
  S.saidLines.push(text);
  S.lastSayAt=Date.now();
  const segs=(segments||segmentsFor(text, face||"suspicion", kind))
    .map(s=>kind&&!s.kind?{...s,kind}:s);
  audio.speak(segs, priority, opts);
}
function thinking(on){ bubble.classList.toggle("thinking",on); }

/* ---------- AI calls ---------- */
const LAT=[];   // per-moment latency, readable at window.__roasty.latency()
function latencyReport(){
  if(!LAT.length) return "no AI lines measured yet";
  const col=k=>LAT.map(r=>r[k]).filter(v=>typeof v==="number");
  const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:0;};
  const rows=LAT.map(r=>`  @${String(r.moment).padStart(2)}s  ${(r.strokeToAudio/1000).toFixed(2)}s`+
    `  wait ${String(r.preRoll).padStart(5)}  guess ${String(r.guess).padStart(5)}`+
    `  write ${String(r.write).padStart(5)}  tts ${String(r.tts).padStart(5)}`+
    (r.strokeToAudio<=2500?"  OK":"  OVER")).join("\n");
  const s=col("strokeToAudio");
  return `${LAT.length} AI lines\n${rows}\n  median stroke→audio ${(med(s)/1000).toFixed(2)}s`+
    `  ·  under 2.5s: ${s.filter(v=>v<=2500).length}/${s.length}`+
    `\n  median stages: guess ${med(col("guess"))}ms  write ${med(col("write"))}ms  tts ${med(col("tts"))}ms`;
}
const LOG=[];
function dbg(msg){
  LOG.push(new Date().toISOString().slice(11,19)+" "+msg);
  if(LOG.length>40) LOG.shift();
  const el=document.getElementById("dbgOut");
  if(el) el.textContent=LOG.join("\n");
}
async function callClaude(body){
  let lastErr;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const res=await fetch("/api/claude",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body)
      });
      const data=await res.json().catch(()=>null);
      if(!res.ok) throw new Error("API "+res.status+": "+((data&&data.error)||"").slice(0,160));
      if(!data||!data.text) throw new Error("empty response");
      return data.text;
    }catch(e){
      lastErr=e;
      dbg("call fail (try "+(attempt+1)+"): "+e.message);
      await new Promise(r=>setTimeout(r,700));
    }
  }
  throw lastErr;
}
function parseJSON(txt){
  try{ return JSON.parse(txt.replace(/```json|```/g,"").trim()); }
  catch(e){}
  // fallback: extract the first {...} block from surrounding prose
  const m=txt.match(/\{[\s\S]*\}/);
  if(m){ try{ return JSON.parse(m[0]); }catch(e){ dbg("parse fail: "+txt.slice(0,120)); } }
  else dbg("no JSON in: "+txt.slice(0,120));
  return null;
}

/* Guesser: sees drawing, does NOT know the word */
async function guesserCall(){
  const img=snapshotB64();
  const txt=await callClaude({
    purpose:"guess", max_tokens:1000,
    messages:[{role:"user",content:[
      {type:"image",source:{type:"base64",media_type:"image/jpeg",data:img}},
      {type:"text",text:
`You are looking at a rough doodle, possibly unfinished, drawn in under 30 seconds. It depicts either an object OR a concept (via common symbols).
${S.guesses.length?`Your previous guess from an earlier look was "${S.guesses[S.guesses.length-1]}". Other wrong guesses: ${S.guesses.slice(0,-1).join(", ")||"none"}.`:"This is your first look."}
Commit to your single best guess even if unsure (a NEW guess if the old one no longer fits, or recommit if it still does). Guess like a regular person, not a scholar: everyday objects, animals, places, common symbols. Never guess letters, glyphs, math symbols, or anything requiring specialist knowledge to picture.
Then give:
- "changed": one short sentence on what is NEW or DIFFERENT since a previous look would have seen it (new parts, things that grew, things that make your old guess wrong). If first look, describe what's there.
- "resembles": one blunt visual comparison of what it looks like INSTEAD of anything intentional (e.g. "a meatball on sticks", "two soap bubbles in a knife fight"). Concrete, physical, drawn from what is actually there.
- "details": 2-3 weirdly specific visual observations (proportions, placements, things that look off or funny). Concrete, not mean.
Reply ONLY with JSON, no other text:
{"guess":"...","confidence":"low|medium|high","changed":"...","resembles":"...","details":["...","..."]}`}
    ]}]
  });
  return parseJSON(txt);
}

/* Writer: knows everything, speaks as Roasty */
const RECENT_LINES=[]; // across rounds: fights template convergence
let HIST=[]; // shared history: {word, won, lastGuess, resembles}
function loadHist(){
  try{
    const r=localStorage.getItem("roasty-history");
    if(r) HIST=JSON.parse(r).slice(-20);
  }catch(e){ /* first run */ }
}
function saveHist(){
  try{ localStorage.setItem("roasty-history",JSON.stringify(HIST.slice(-20))); }catch(e){}
}
function histSummary(){
  if(!HIST.length) return "";
  return "History with this artist (past rounds, oldest first). Reference SPARINGLY — only when a callback is natural and obvious:\n"
    + HIST.slice(-8).map(h=>`- "${h.word}": ${h.won?"they pulled it off":"disaster"}${h.resembles?` (looked like ${h.resembles})`:""}`).join("\n")+"\n";
}
function rememberLine(l){ if(!l||l==="__SILENCE__")return; RECENT_LINES.push(l); if(RECENT_LINES.length>14)RECENT_LINES.shift(); }
/** the clock leads the moment — it sets his composure before anything else */
function secondsHeader(secondsLeft){
  if(secondsLeft==null) return "";
  const t=secondsLeft>=20?"EARLY: you still have room. Composed, patient, hopeful."
         :secondsLeft>=10?"MID: time is going. Blunter. Less patient."
         :"LATE: almost out of time. Blunt and desperate. No composure left.";
  return `SECONDS LEFT: ${secondsLeft}  —  ${t}\n\n`;
}
async function writerCall(situation,purpose,secondsLeft){
  // The bible is byte-identical on every call, so it is split into its own
  // content block and cached. Same prompt text, same order — the model sees
  // exactly what it saw before; we just stop paying to re-read it every line.
  const txt=await callClaude({
    purpose:purpose||"write", max_tokens:1000,
    messages:[{role:"user",content:[
      {type:"text", text:bible, cache_control:{type:"ephemeral"}},
      {type:"text", text:
`

=== THIS MOMENT ===
${secondsHeader(secondsLeft)}${histSummary()}${situation}
Lines you already said this round (never repeat, keep escalating):
${S.saidLines.map(l=>"- "+l).join("\n")||"- (nothing yet)"}
Lines from RECENT ROUNDS — do NOT echo their phrasing, sentence shapes, or closing buttons. If one of these ends a certain way, yours cannot end the same way:
${RECENT_LINES.map(l=>"- "+l).join("\n")||"- (none)"}

Write 3 candidate lines for Roasty for THIS moment, following every rule. Order them YOUR FUNNIEST FIRST. Vary the attack: one built on the resemblance comparison, one committing to / defending a guess, one built on a specific detail. If all your options are weak, a candidate may be exactly the word SILENCE.
Reply ONLY with JSON, no other text:
{"candidates":["...","...","..."]}`
      }
    ]}]
  });
  const j=parseJSON(txt);
  if(!j||!j.candidates||!j.candidates.length) return null;
  const silent=j.candidates.filter(c=>c.trim().toUpperCase()==="SILENCE").length;
  if(silent>=3) return "__SILENCE__";
  let real=j.candidates.filter(c=>c.trim().toUpperCase()!=="SILENCE");
  // He swears with the token or not at all. A candidate carrying the real
  // word is dropped outright — it must never reach the screen or the voice.
  const clean=real.filter(c=>!hasProfanity(c));
  if(clean.length<real.length) dbg(`writer: dropped ${real.length-clean.length} candidate(s) with real profanity`);
  real=clean;
  if(!real.length) return null;
  // Mid-round he sputters — long is out of character and out of time.
  // Drop anything over 90 chars, but only when a shorter one is on offer;
  // the closing roast is exempt, it is allowed its 1-2 sentences.
  if(purpose!=="close"){
    const short=real.filter(c=>c.trim().length<=90);
    if(short.length && short.length<real.length)
      dbg(`writer: dropped ${real.length-short.length} long candidate(s), kept ${short[0].trim().length} chars`);
    if(short.length) return short[0];
  }
  return real[0]; // writer's own top pick
}

/* ---------- match check ---------- */
function norm(s){return (s||"").toLowerCase().replace(/[^a-zà-ÿ ]/g,"").trim();}
function isMatch(guess,word){
  let g=norm(guess), w=norm(word);
  if(!g||!w) return false;
  const strip=x=>x.endsWith("s")?x.slice(0,-1):x;
  g=strip(g); w=strip(w);
  return g===w || g.includes(w) || w.includes(g);
}

/* ---------- round flow ---------- */
const timerEl=document.getElementById("timer");
const veil=document.getElementById("canvasVeil");
const intro=document.getElementById("introBlock");
const countBlock=document.getElementById("countBlock");
const resultCard=document.getElementById("resultCard");
const toolRow=document.getElementById("toolRow");

function pickOpener(word){
  const last=HIST[HIST.length-1];
  if(last && Math.random()<0.45){
    if(REPEAT_WORDS.includes(word) && HIST.filter(h=>h.word===word).length>=1)
      return repeatOpener(word);
    return last.won
      ? `"${word}." The ${last.word} worked. Don't get comfortable.`
      : `"${word}." After the ${last.word}, I need this. WE need this.`;
  }
  return OPENERS[Math.floor(Math.random()*OPENERS.length)](word);
}

/* =========================================================
   MODE PICKER
   Classic is the original round flow, untouched. Director Mode lives
   entirely in director.js and borrows this file's machinery through a
   context object — it never reaches into Classic's own flow.
   ========================================================= */
let MODE="classic";
let director=null;
const MODE_BLURB={
  classic:"He gives you a word and guesses what you drew.",
  director:"He picks the picture and talks you through it, one shape at a time. A stranger judges the result. You both win or you both don't."
};
const MODE_CTA={classic:"Give him a word", director:"Let him direct"};
function setMode(m){
  MODE=m;
  document.querySelectorAll(".modeBtn").forEach(b=>b.classList.toggle("on",b.dataset.mode===m));
  document.getElementById("modeBlurb").textContent=MODE_BLURB[m];
  document.getElementById("startBtn").textContent=MODE_CTA[m];
  try{ localStorage.setItem("roasty-mode",m); }catch(e){}
}
document.querySelectorAll(".modeBtn").forEach(b=>b.onclick=()=>setMode(b.dataset.mode));

/** shared presence beat — Classic starts it inline; Director uses these */
function startPresence(){ S.murmurGap=rollGap(); clearInterval(S.pulseId); S.pulseId=setInterval(murmurPulse,200); }
function stopPresence(){ clearInterval(S.pulseId); }

/** the result card, for Director (Classic keeps its own inline version) */
function showResult({won,verdict,sub}){
  const v=document.getElementById("verdict");
  v.textContent=verdict;
  v.className=won?"win":"loss";
  document.getElementById("streakLine").textContent=
    `${sub} · round ${S.round} · ${S.wins} hung · streak ${S.streak}`;
  veil.style.display="flex";
  veil.style.background="transparent";
  veil.style.pointerEvents="none";
  resultCard.classList.add("show");
  resultCard.style.pointerEvents="auto";
  resultCard.style.background="rgba(255,253,247,.92)";
  resultCard.style.padding="16px 22px";
  resultCard.style.borderRadius="12px";
  resultCard.style.border="2px solid var(--ink)";
}

async function beginRound(){
  audio.unlock().catch(e=>dbg("audio unlock FAILED: "+e.message));
  if(MODE!=="director") return startRound();
  if(!director){
    const {createDirector}=await import("./director.js");
    director=createDirector({
      S, say, audio, ticker, dbg, callClaude, parseJSON, snapshotB64,
      setFace, thinking, logJoke, isMatch, pickWord,
      sizeCanvas, redraw, startPresence, stopPresence, showResult, squintQuietly,
      els:{
        wordText:document.getElementById("wordText"), timer:timerEl, veil,
        intro, countBlock, resultCard, toolRow, bubble,
        bigWord:document.getElementById("bigWord"), countNum:document.getElementById("countNum")
      }
    });
    window.__roasty.director=director;
  }
  return director.start();
}

document.getElementById("startBtn").onclick=beginRound;
document.getElementById("againBtn").onclick=beginRound;
document.getElementById("backToModes").onclick=()=>{
  if(director) director.stop();
  audio.stop();
  resultCard.classList.remove("show");
  veil.style.display="flex"; veil.style.background=""; veil.style.pointerEvents="";
  intro.style.display="block";
  S.phase="idle";
  bubble.classList.add("quiet");
  bubble.textContent="He's setting up the gallery. Allegedly.";
};

function startRound(){
  audio.unlock().catch(e=>dbg("audio unlock FAILED: "+e.message)); // this click is our iOS gesture
  S.round++; S.word=pickWord(S.round);
  S.phase="countdown"; S.timeLeft=30; S.won=false;
  S.strokes=[]; S.current=null; S.dirty=false;
  S.saidLines=[]; S.guesses=[]; S.lastDetails=[]; S.lastResembles=""; S.nextMoment=0; S.busy=false;
  S.hadFirstStroke=false; S.lastStrokeAt=0; S.lastReflexAt=0; S.lastSayAt=0; S.lastMurmurAt=0; S.usedExclaim=false; S.urgeCount=0;
  document.getElementById("wordText").textContent=S.word;
  intro.style.display="none"; resultCard.classList.remove("show");
  countBlock.style.display="block"; veil.style.display="flex";
  document.getElementById("bigWord").textContent=S.word;
  timerEl.textContent="30"; timerEl.classList.remove("low");
  setFace("suspicion");
  bubble.classList.add("quiet");
  bubble.textContent="He is watching. Closely.";
  // the opener is decided NOW so the 3-2-1 buys us its synthesis time
  const opener=pickOpener(S.word);
  audio.warm(opener,"suspicion");
  let n=3; const cEl=document.getElementById("countNum");
  cEl.textContent=n;
  const cd=setInterval(()=>{
    n--; if(n>0){cEl.textContent=n;return;}
    clearInterval(cd);
    veil.style.display="none"; countBlock.style.display="none";
    toolRow.style.display="flex";
    S.phase="drawing"; sizeCanvas();
    say(opener,"suspicion",null,null,"opener");
    S.timerId=setInterval(tick,1000);
    S.murmurGap=rollGap();
    clearInterval(S.pulseId);
    S.pulseId=setInterval(murmurPulse,200);   // the 2-4s presence beat
  },800);
}

function tick(){
  S.timeLeft--;
  timerEl.textContent=S.timeLeft;
  if(S.timeLeft<=10) timerEl.classList.add("low");
  const elapsed=30-S.timeLeft;
  const now=Date.now();
  // pre-first-stroke urging
  if(!S.strokes.length && elapsed>=3 && canReflex()){
    reflex("urge","alarm");
  }
  // idle: strokes exist but nothing new for 5s
  else if(S.strokes.length && S.lastStrokeAt && now-S.lastStrokeAt>5000 && canReflex()){
    S.lastStrokeAt=now; // one idle poke per stall
    reflex("idle","alarm");
  }
  // heartbeat: never more than ~4s of total silence
  else if(now-(S.lastSayAt||0)>4000 && now-(S.lastMurmurAt||0)>4000){
    murmur();
  }
  if(S.nextMoment<S.guessMoments.length && elapsed>=S.guessMoments[S.nextMoment]){
    S.nextMoment++;
    attemptGuess(elapsed);
  }
  if(S.timeLeft<=0) endRound(false);
}

async function attemptGuess(elapsed){
  if(S.busy) return;
  if(!S.strokes.length){
    say(elapsed<12?"The canvas is empty. The canvas is EMPTY.":"Still nothing. The opening is THURSDAY.","alarm");
    return;
  }
  if(!S.dirty){ setFace("suspicion"); return; } // nothing new: he just squints
  S.busy=true; S.dirty=false;
  // everything downstream is timed against the stroke that prompted this look
  const strokeAt=S.lastStrokeAt||Date.now();
  const strokesAtSnap=S.strokes.length;
  const t={};
  // instant vamp: he reacts NOW, the punchline arrives when it arrives
  // (marked "vamp" so the writer line it covers for may cut it off)
  say(VAMPS[Math.floor(Math.random()*VAMPS.length)],"suspicion",null,"vamp",null,
      {onFirstSound:()=>{ t.vamp=Date.now()-strokeAt; }});
  thinking(true);
  ticker.push("moment",`@${elapsed}s ${S.strokes.length} strokes`);
  dbg("guess moment @"+elapsed+"s, strokes:"+S.strokes.length);
  try{
    const snapAt=Date.now();
    t.preRoll=snapAt-strokeAt;          // stroke landed -> this guess moment fired
    const g=await guesserCall();
    t.guess=Date.now()-snapAt;
    if(!g){ dbg("guesser returned null"); S.dirty=true; S.busy=false; thinking(false); squintQuietly(); return; }
    dbg("guess: "+g.guess+" ["+(g.confidence||"?")+"]");
    S.lastDetails=g.details||[];
    if(isMatch(g.guess,S.word)){ S.busy=false; thinking(false); endRound(true,g.guess); return; }
    S.guesses.push(g.guess);
    S.lastResembles=g.resembles||"";
    const phase = elapsed<11?"EARLY (suspicion, first confident guess)"
               : elapsed<18?"MID (rising alarm, wrong again)"
               : "LATE (near meltdown, time almost gone)";
    const prevGuess=S.guesses.length>1?S.guesses[S.guesses.length-2]:null;
    const drewHim=/duck|roasty/i.test(g.guess||"");
    const tw=Date.now();
    const line=await writerCall(
`Round phase: ${phase}
Seconds left: ${S.timeLeft}
The target word (only you know it): "${S.word}"
${prevGuess?`Your running theory was "${prevGuess}". `:""}Your guess on this look (you believe it): "${g.guess}" — which is WRONG.
What CHANGED since you last looked: ${g.changed||"(first look)"}
What the drawing actually resembles right now: ${g.resembles||"(no comparison available)"}
Specific visual observations of the drawing right now:
${S.lastDetails.map(d=>"- "+d).join("\n")}
${drewHim?"ALERT: the drawing appears to be A DUCK. It might be YOU. Realize this mid-line. Panic. Then immediately grovel: \"Okay. You're doing great. Maybe don't draw anymore.\"":""}
THE THREAD: this is one continuous conversation about one evolving drawing. React to the CHANGE — what they just did to the thing you had a theory about ("what did you do to the horse"). Keep calling it what you called it. Think out loud, revise mid-line ("A potato. No. Horse. Yes. Horse."). A small honest reaction beats a constructed joke.`,
      "write", S.timeLeft);
    t.write=Date.now()-tw;
    thinking(false);

    // STALENESS: the drawing has moved on and the vamp already covered the beat.
    // A joke about a canvas that no longer exists is worse than silence.
    const age=Date.now()-snapAt;
    if(line && age>6000 && S.strokes.length>strokesAtSnap){
      dbg(`stale line dropped (${(age/1000).toFixed(1)}s old, +${S.strokes.length-strokesAtSnap} strokes since)`);
      ticker.push("stale",`${(age/1000).toFixed(1)}s +${S.strokes.length-strokesAtSnap} strokes`);
      S.busy=false;
      return;                                   // silently. he just keeps watching.
    }

    if(line){
      dbg("writer line ok");
      say(line, elapsed<12?"suspicion":elapsed<20?"alarm":"meltdown", null, "ai", null,
          {onFirstSound:()=>{
            t.audio=Date.now()-strokeAt;
            t.tts=t.audio-t.preRoll-t.guess-t.write;
            const verdict=t.audio<=2500?"OK  ":"OVER";
            dbg(`${verdict} stroke→audio ${(t.audio/1000).toFixed(2)}s `+
                `(wait ${t.preRoll}ms · guess ${t.guess}ms · write ${t.write}ms · tts ${t.tts}ms`+
                `${t.vamp!==undefined?` · vamp @${(t.vamp/1000).toFixed(2)}s`:""})`);
            ticker.push("latency",`${(t.audio/1000).toFixed(2)}s ${verdict.trim()}`);
            LAT.push({moment:elapsed, strokeToAudio:t.audio, vamp:t.vamp,
                      preRoll:t.preRoll, guess:t.guess, write:t.write, tts:t.tts});
          }});
      logJoke("ai-roast",line,g.guess); rememberLine(line);
    }
    else { dbg("writer returned null"); squintQuietly(); }
  }catch(e){
    thinking(false);
    dbg("pipeline error: "+e.message);
    S.dirty=true; // let the next moment retry with the same strokes
    squintQuietly();
  }
  S.busy=false;
}
function squintQuietly(){
  bubble.classList.add("quiet");
  bubble.classList.remove("thinking");
  bubble.innerHTML='<span class="stagedir">( he squints. hard. )</span>';
  setFace("suspicion");
}

async function endRound(won,winningGuess){
  if(S.phase!=="drawing")return;
  S.phase="done";
  clearInterval(S.timerId);
  clearInterval(S.pulseId);
  toolRow.style.display="none";
  S.won=won;
  if(won){S.wins++;S.streak++;}else{S.streak=0;}
  // a vamp again: the closing roast is allowed to cut this one off
  say(won?"Wait. Wait wait wait. Is that—":"Okay. Okay. Give me a second.", won?"alarm":"defeat", null, "vamp");
  thinking(true);
  let line=null;
  try{
    line=await writerCall( won?
`ROUND OVER — YOU GUESSED IT. The word was "${S.word}" and your guess "${winningGuess}" was RIGHT. The drawing was good enough to be recognizable. Deliver the grudging concession: brief respect that clearly costs you. One or two sentences. What the drawing resembled along the way: ${S.lastResembles||"n/a"}. Details you observed:
${S.lastDetails.map(d=>"- "+d).join("\n")}`
:
`ROUND OVER — TIME RAN OUT. The word was "${S.word}". Your guesses (${S.guesses.join(", ")||"none, you never even guessed"}) were all wrong, OR the drawing never became recognizable. Deliver the closing roast. 1-2 sentences, or (if it feels right) a 3-sentence mini-story from your life where this drawing is the punchline. What the drawing actually resembles: ${S.lastResembles||"n/a"}. Details you observed:
${S.lastDetails.map(d=>"- "+d).join("\n")||"- the canvas was essentially empty"}`, "close");
  }catch(e){}
  thinking(false);
  const closing = line||( won? winFallback(S.word) : "__SILENCE__");
  const face = won? "grudge":"defeat";
  // the closing roast is the one line that can afford the slower, richer model
  say(closing, face, segmentsFor(closing, face, "ai", "rich"), "ai");
  logJoke(won?"closing-win":"closing-loss", line||"", winningGuess);
  rememberLine(line);
  HIST.push({word:S.word,won,lastGuess:winningGuess||S.guesses[S.guesses.length-1]||"",resembles:S.lastResembles||""});
  saveHist();
  const v=document.getElementById("verdict");
  v.textContent = won? "He guessed it." : "He never got it.";
  v.className = won? "win":"loss";
  document.getElementById("streakLine").textContent=
    `round ${S.round} · ${S.wins} hung in the gallery · streak ${S.streak}`;
  veil.style.display="flex";
  veil.style.background="transparent";
  veil.style.pointerEvents="none";
  resultCard.classList.add("show");
  resultCard.style.pointerEvents="auto";
  resultCard.style.background="rgba(255,253,247,.92)";
  resultCard.style.padding="16px 22px";
  resultCard.style.borderRadius="12px";
  resultCard.style.border="2px solid var(--ink)";
}

/* ---------- settings sheet ---------- */
const sheet=document.getElementById("sheet");
const bibleBox=document.getElementById("bibleBox");
document.getElementById("settingsBtn").onclick=()=>{
  bibleBox.value=bible; sheet.classList.add("open");
};
function commitBible(){
  bible=bibleBox.value;
  try{
    if(bible.trim()===DEFAULT_BIBLE.trim()) localStorage.removeItem("roasty-bible");
    else localStorage.setItem("roasty-bible",bible);
  }catch(e){}
}
document.getElementById("closeSheet").onclick=()=>{ commitBible(); sheet.classList.remove("open"); };
document.getElementById("resetBible").onclick=()=>{ bibleBox.value=DEFAULT_BIBLE; };
sheet.addEventListener("click",e=>{ if(e.target===sheet){ commitBible(); sheet.classList.remove("open"); } });

/* ---------- kill Safari page-bounce while drawing ---------- */
pad.addEventListener("touchstart",e=>e.preventDefault(),{passive:false});
pad.addEventListener("touchmove",e=>e.preventDefault(),{passive:false});
document.addEventListener("touchmove",e=>{
  if(e.target===bibleBox||e.target.id==="dbgOut") return; // allow scrolling editor + log
  e.preventDefault();
},{passive:false});

/* =========================================================
   AUDIO HEALTH CHECK
   Decodes every clip in the library AND the server's live-TTS cache through
   the same WebAudio decoder the game plays them with, and reports the ones
   that are too short or too quiet to be a real reading. File size cannot see
   this — a silent CBR mp3 is exactly as big as a spoken one.
     await window.__roasty.audioHealth()              report only
     await window.__roasty.audioHealth({delete:true}) bin the bad ones
   ========================================================= */
const HEALTH_MIN_SEC=0.4, HEALTH_MIN_PEAK=0.02, HEALTH_MIN_RMS=0.004;
async function audioHealth(opts={}){
  await audio.unlock().catch(()=>{});
  if(!audio.ctx) return "audio context is locked — press 'Give him a word' once, then re-run";
  const {clips}=await (await fetch("/api/dev/clips")).json();
  const bad=[], ok=[];
  let i=0;
  const worker=async()=>{
    while(i<clips.length){
      const c=clips[i++];
      try{
        const buf=await (await fetch(c.url)).arrayBuffer();
        const pcm=await audio.ctx.decodeAudioData(buf.slice(0));
        const d=pcm.getChannelData(0);
        let peak=0,sum=0;
        for(let n=0;n<d.length;n++){const v=Math.abs(d[n]); if(v>peak)peak=v; sum+=d[n]*d[n];}
        const rms=Math.sqrt(sum/(d.length||1));
        const rec={...c, sec:+pcm.duration.toFixed(2), peak:+peak.toFixed(4), rms:+rms.toFixed(4)};
        const short=pcm.duration<HEALTH_MIN_SEC;
        const quiet=peak<HEALTH_MIN_PEAK||rms<HEALTH_MIN_RMS;
        if(short||quiet){ rec.why=[short&&"short",quiet&&"near-silent"].filter(Boolean).join("+"); bad.push(rec); }
        else ok.push(rec);
      }catch(e){ bad.push({...c, sec:0, peak:0, rms:0, why:"undecodable"}); }
    }
  };
  await Promise.all(Array.from({length:6},worker));

  let out=`scanned ${clips.length} clips (${clips.filter(c=>c.kind==="library").length} library, `+
          `${clips.filter(c=>c.kind==="cache").length} tts-cache)\n`+
          `healthy ${ok.length}   bad ${bad.length}\n`;
  if(ok.length){
    const secs=ok.map(c=>c.sec).sort((a,b)=>a-b);
    out+=`shortest healthy ${secs[0]}s   median ${secs[Math.floor(secs.length/2)]}s\n`;
  }
  for(const b of bad.slice(0,40))
    out+=`  ${String(b.sec).padStart(5)}s peak ${String(b.peak).padStart(6)} rms ${String(b.rms).padStart(6)}  ${b.why.padEnd(12)} ${b.kind} ${(b.text||b.file).slice(0,40)}\n`;
  if(bad.length>40) out+=`  ...and ${bad.length-40} more\n`;

  if(opts.delete && bad.length){
    const r=await fetch("/api/dev/delete-clips",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({files:bad.map(b=>b.file)})});
    const {deleted}=await r.json();
    out+=`\ndeleted ${deleted.length}. Library clips: re-run "npm run pregen". Cache clips regenerate on next use.`;
  }
  window.__roasty.lastHealth={ok,bad};
  return out;
}

/* ---------- boot ---------- */
window.__roasty = {                                    // tuning bench handle
  S, audio, ticker, JOKES, get bible(){return bible;}, HIST:()=>HIST,
  latency:()=>latencyReport(),
  audioHealth:(opts)=>audioHealth(opts)
};

async function boot(){
  // the bible now lives in docs/roasty-bible.md — one source of truth
  try{
    DEFAULT_BIBLE=await (await fetch("/api/bible")).text();
  }catch(e){ dbg("bible load FAILED: "+e.message); }
  try{ bible=localStorage.getItem("roasty-bible")||DEFAULT_BIBLE; }catch(e){ bible=DEFAULT_BIBLE; }

  try{
    const h=await (await fetch("/api/health")).json();
    dbg(`claude:${h.anthropic?h.claudeModels.write:"NO KEY"} thinking:${h.thinking}`);
    dbg(`voice:${h.elevenlabs?h.elevenModels.fast.model:"NO KEY"} library:${h.audioLibrary} clips`);
    if(!h.anthropic) say("No Anthropic key. I can't see a thing.","defeat");
    else if(!h.elevenlabs) dbg("no ElevenLabs key — he will be silent");
    if(h.voiceQuotaExhausted) dbg("VOICE OFF — ElevenLabs quota: "+h.voiceError);
  }catch(e){ dbg("health check failed: "+e.message); }

  await audio.loadManifest();
  loadHist();
  sizeCanvas();
  renderJokes();

  const qs=new URLSearchParams(location.search);
  let m=qs.get("mode");
  if(m!=="classic"&&m!=="director"){ try{ m=localStorage.getItem("roasty-mode"); }catch(e){ m=null; } }
  setMode(m==="director"?"director":"classic");
  if(qs.has("dev")){ ticker.show(); dbg("dev ticker on"); }
  if(qs.has("selftest")) selfTest();
}

/* ---------- optional boot self-test: ?selftest=1 ---------- */
async function selfTest(){
  try{
    await callClaude({purpose:"write",max_tokens:1000,
      messages:[{role:"user",content:"Reply with the single word: ok"}]});
    dbg("SELF-TEST text call: OK");
  }catch(e){ dbg("SELF-TEST text call FAILED: "+e.message); }
  try{
    const t=document.createElement("canvas"); t.width=64; t.height=64;
    const c=t.getContext("2d"); c.fillStyle="#fff"; c.fillRect(0,0,64,64);
    c.fillStyle="#000"; c.beginPath(); c.arc(32,32,20,0,7); c.stroke();
    const b64=t.toDataURL("image/jpeg",0.8).split(",")[1];
    await callClaude({purpose:"guess",max_tokens:1000,
      messages:[{role:"user",content:[
        {type:"image",source:{type:"base64",media_type:"image/jpeg",data:b64}},
        {type:"text",text:"Reply with the single word: ok"}]}]});
    dbg("SELF-TEST image call: OK");
  }catch(e){ dbg("SELF-TEST image call FAILED: "+e.message); }
}

boot();
