/* =========================================================
   ROASTY — shared line data.
   Imported by the browser AND by node (server.js, scripts/pregen-audio.mjs)
   so the pre-generated audio manifest and the game can never drift apart.
   Every string here is verbatim from poc/roasty-poc.html.
   ========================================================= */

/* ---------- word list (tiered) — docs/words.md ---------- */
export const WORDS = {
  easy:["sun","fish","house","tree","cat","cup","bicycle","snake","clock","banana","umbrella","star"],
  medium:["giraffe","windmill","rocket","penguin","cactus","dragon","guitar","lighthouse","octopus","robot"],
  hard:["love","loud","Monday","jealousy","déjà vu","gravity"]
};
export const ALL_WORDS = [...WORDS.easy, ...WORDS.medium, ...WORDS.hard];

/* ---------- instant vamps: he reacts NOW, punchline arrives later ---------- */
export const VAMPS = ["Wait. What is that.","Hold on. Hold on.","Okay what am I looking at. What AM I looking at.","Wait wait wait.","Hold on. Let me look. LET ME LOOK.","Whaaaat is— hold on.","Wh— okay. Okay. Looking."];

/* =========================================================
   THE COMPOSURE LADDER
   Which canned pool he draws from is a function of the clock. Early he is
   composed and patient; late he is blunt and out of road. One selector,
   used by every canned layer.
     20s+      early
     19-10s    mid
     under 10  late
   ========================================================= */
export const TIERS = ["early", "mid", "late"];
export function tierFor(secondsLeft) {
  if (secondsLeft >= 20) return "early";
  if (secondsLeft >= 10) return "mid";
  return "late";
}
/** pools are either a flat array (no ladder) or {early,mid,late} */
export function poolFor(pool, tier) {
  if (!pool) return null;
  return Array.isArray(pool) ? pool : (pool[tier] || pool.mid || pool.early);
}

/* ---------- murmur layer: constant tiny presence, below jokes ----------
   The old neutral/concern/groan split was already a clock ladder; this is
   the same idea made explicit, plus the bleeped clips for the late tier. */
export const MURMURS = {
  early:["Mm.","Hm.","Okay.","Uh huh.","Right. Right.","Mm hm.","Sure. Sure.","Okay okay.","Mhm. Good.","Fine. That's fine."],
  mid:["Oh no.","Wait.","Hm. Hmmm.","What is— okay.","Oh boy.","Huh.","Tsk.","Really.","No. No no no.","Ehh?","Wha—"],
  late:["Ugh.","Oof.","Hoo boy.","Nngh.","Hhh.","Oh man.","Why.","Wow. Okay. Wow.","Unbelievable.","B-b-but—","Whyyy.",
        "Oh [BLEEP]. Oh no.","[BLEEP]. Okay. Okay.","Are you [BLEEP] kidding me.","Oh for [BLEEP] sake.","[BLEEP] it. Keep going."]
};

/* ---------- artist oaths ---------- */
export const EXCLAIMS = [
  "By Van Gogh's missing ear!","Sweet mother of Monet!","By Picasso's cubes!",
  "Holy Pollock paint splotch!","By Dali's melting clocks!","Great Michelangelo's David!",
  "What in the Andy Warhol is that!","Bob Ross's happy little accidents!",
  "Holy Frida's unibrow!","By the ghost of Rembrandt!","Son of a Munch scream!",
  "Holy Da Vinci code!","What the Banksy!"
];

/* ---------- reflex layer: algorithmic commentary, zero AI ----------
   Stroke reactions climb the ladder. urge1/2/3 do not: they are already a
   composure ladder, driven by how many times he has had to ask. */
export const REFLEX = {
  first:{
    early:["Okay. Okay okay okay. We're drawing. Good.","First mark. That's... something. Keep going.","There it is. A line. We have a line."],
    mid:["FINALLY. Okay. Go. Keep going.","Okay. Late, but okay. Show me.","We're starting. We're actually starting."],
    late:["Oh, NOW you draw.","You're starting. Now. With the clock like THAT.","Fine. Go. Go go go."]
  },
  urge1:["Come on come on. Draw something. ANYTHING.","Draw. Please. Anything. A shape. A dot. GO.","The canvas is still empty. Why is it empty.","Hello. HELLO. The pen works, I checked."],
  urge2:["I'm begging. I'm actually begging now.","Draw ANYTHING. A worm. A sock. I'll take a sock.","Do you know what Thursday means. THURSDAY.","Any minute now. Any minute. ANY minute."],
  urge3:["Gerald was right about you.","This is how it ends. Not with a drawing. With NOTHING.","I could have hired a pigeon. The pigeon would be DONE by now.","I can hear the critics laughing. From HERE. From the FUTURE."],
  resume:{
    early:["Oh. Good. You're back.","Movement. We have movement. Okay.","There we go. Continue."],
    mid:["Oh. OH. Okay. Something's happening.","He lives. He DRAWS. Okay okay okay.","Back. Good. We lost time but we're back."],
    late:["NOW. Okay. Fine. Now.","Oh, you're awake. Wonderful. Nine seconds.","Moving. Finally moving. Too late, but moving."]
  },
  circle:{
    early:["A circle. Okay. Circles are fine. Circles are FINE.","A circle. Good. Circles are a start.","Round. That's round. I can work with round."],
    mid:["Another circle. Why do you keep making circles.","That circle almost closed. Almost.","That's three circles. THREE."],
    late:["Another circle. Of course. Another circle.","If the next thing is a circle I'm leaving. I mean it.","Circles. Still circles. We're out of TIME."]
  },
  straight:{
    early:["A line. One line. Where is this going.","Straight line. Okay. I can work with a line. Probably.","A clean line. See, that's fine. That's fine."],
    mid:["Another line. Great. We're building a FENCE apparently.","More lines. Is it a fence. Tell me it isn't a fence.","Lines. Just lines. Where's the THING."],
    late:["Lines. You're still doing LINES.","Not another line. Please. Not another line.","A line. That's what we're spending our last seconds on."]
  },
  shaky:{
    early:["That line wobbled a bit. It's okay. Steady.","Take your time. The line's shaking.","Little wobble. Fine. Breathe."],
    mid:["Why is the line shaking. Are YOU shaking.","That line has anxiety. That makes two of us.","Is there an earthquake I should know about."],
    late:["Your hand is GOING. Hold it steady.","Everything's shaking now. Everything.","That's not a line, that's a tremor."]
  },
  dot:{
    early:["A dot. Okay. Dots can go somewhere.","One dot. Sure. Build on it.","A dot. Fine. That's a start, technically."],
    mid:["A dot. You gave me a dot.","A dot. Okay. Is more coming. Please say more is coming.","Another dot. We're collecting dots now."],
    late:["One dot. Thursday is RIGHT there and you're doing dots.","A DOT. With eight seconds left.","Dots. He's doing dots. Unbelievable."]
  },
  scribble:{
    early:["Some texture. Okay. I see what you're doing.","Filling it in. Alright. Carefully.","That's a lot of pen. Ease up a bit."],
    mid:["Scribbling. Great. We've entered the scribbling phase.","That's not shading, that's panic.","Why is there so much SCRIBBLE."],
    late:["STOP. Stop the scribbling. You're making it WORSE.","No no no. You're burying it. You're BURYING it.","That's not fixing it. That's a cover-up."]
  },
  big:{
    early:["Nice and big. Good. Use the space.","It's growing. That's fine. Keep it contained.","Big shape. Okay. Committed. I like commitment."],
    mid:["It's getting bigger. Why is it getting bigger.","It's taking up the whole canvas. Should I be worried. I'm worried.","That's the whole canvas now. The WHOLE canvas."],
    late:["It's eating the canvas and we have NINE seconds.","Bigger. It's still getting bigger. Why.","There's no room left. There's no room LEFT."]
  },
  idle:{
    early:["Take a beat. It's fine. We have time.","You stopped. That's okay. Thinking is allowed.","A pause. Fine. Think it through."],
    mid:["You stopped. Why did you stop. Don't do the stopping thing.","The staring is not drawing.","Oh good, a break. We EARNED that."],
    late:["HELLO. Still here. Still waiting. Still aging.","Don't stop NOW. Not now. Not NOW.","You're STARING. The clock is right there."]
  }
};

/* which face (and therefore which emotion tag) each reflex kind is spoken with */
export const REFLEX_FACE = {
  first:"suspicion", urge1:"alarm", urge2:"alarm", urge3:"alarm", resume:"alarm",
  circle:"suspicion", straight:"suspicion", shaky:"alarm", dot:"suspicion",
  scribble:"alarm", big:"suspicion", idle:"alarm"
};

/* ---------- round openers ---------- */
export const OPENERS = [
  f=>`"${f}." Fine. I can hang a ${f}. Probably.`,
  f=>`"${f}." The critics like a ${f}. Don't ruin this.`,
  f=>`A ${f}. Okay. Okay okay okay. Show me the ${f}.`,
  f=>`"${f}." Gerald said you couldn't. PROVE HIM WRONG.`
];
/* the "again" opener only fires for these words */
export const REPEAT_WORDS = ["cat","dog","giraffe","dragon","fish","octopus","penguin"];
export const repeatOpener = w=>`"${w}." Again. You and the ${w}s. Okay. Go.`;

/* ---------- fixed lines spoken by the game loop ---------- */
export const FIXED = [
  { text:"Oh. Oh, we're starting OVER. Bold use of our week.", face:"alarm"   }, // clear
  { text:"The canvas is empty. The canvas is EMPTY.",          face:"alarm"   }, // guess moment, early, nothing drawn
  { text:"Still nothing. The opening is THURSDAY.",            face:"alarm"   }, // guess moment, late, nothing drawn
  { text:"Wait. Wait wait wait. Is that—",                     face:"alarm"   }, // round over, win
  { text:"Okay. Okay. Give me a second.",                      face:"defeat"  }  // round over, loss
];
/* fallback closing line if the writer call dies on a win */
export const winFallback = w=>`...fine. It's a ${w}. FINE.`;

/* =========================================================
   THE BLEEP
   A writer line may contain the literal token [BLEEP]. The word itself is
   never written, never synthesised and never stored — the token IS the joke.
   Audio: speech, censor tone over the gap, speech.
   Screen: %#@!
   ========================================================= */
export const BLEEP_TOKEN = "[BLEEP]";
export const BLEEP_GLYPH = "%#@!";
export const hasBleep = (s) => String(s).includes(BLEEP_TOKEN);

/** "Oh [BLEEP]. Oh no." -> [{text:"Oh"},{bleep:true},{text:". Oh no."}] */
export function splitBleep(text) {
  const out = [];
  for (const piece of String(text).split(BLEEP_TOKEN)) {
    if (out.length) out.push({ bleep: true });
    const t = piece.trim();
    if (t) out.push({ text: t });
  }
  return out;
}

/** what the speech bubble shows */
export const bleepForScreen = (s) => String(s).split(BLEEP_TOKEN).join(BLEEP_GLYPH);

/* Real profanity never reaches the voice and is never accepted from the
   writer — if he wants to swear he uses the token. Word-boundary matched, so
   "class" and "Scunthorpe" survive. */
const PROFANITY = [
  "fuck","fucks","fucked","fucking","fucker","fuckers","motherfucker","motherfucking",
  "shit","shits","shitty","shitting","bullshit","horseshit",
  "cunt","cunts","bastard","bastards","bitch","bitches","bitching",
  "asshole","assholes","arsehole","dickhead","prick","pricks","wanker","twat",
  "goddamn","goddamnit","bollocks","piss","pissed","pissing","slut","whore"
];
const PROFANITY_RE = new RegExp(`\\b(${PROFANITY.join("|")})\\b`, "i");
export const hasProfanity = (s) => PROFANITY_RE.test(String(s));

/* =========================================================
   EMOTION -> ElevenLabs tags.  docs/voice.md is canonical for the
   six game expression states; the murmur/oath rows extend that map
   for the layers voice.md says to pre-generate as files.
   ========================================================= */
export const EMOTION_TAGS = {
  suspicion:     "[nervous]",
  alarm:         "[worried, faster]",
  meltdown:      "[screaming, panicked]",
  defeat:        "[exhausted, flat]",
  grudge:        "[reluctant, relieved]",
  stare:         null,               // silence IS the read
  murmurNeutral: "[mutters]",
  murmurConcern: "[nervous, quiet]",
  murmurGroan:   "[groans, exhausted]",
  oath:          "[dramatic]"
};

/* =========================================================
   The free audio library: every line that is knowable ahead of
   time. Pre-generated once, played locally at zero latency.
   ONLY AI-written lines hit live TTS.
   ========================================================= */
export function buildAudioLibrary(){
  const out = [];
  // A bleeped line is baked as its speakable halves; the tone is generated
  // locally at play time, so the word never exists as audio anywhere.
  const add = (group, emotion, text) => {
    for(const part of splitBleep(text))
      if(part.text) out.push({ group, emotion, text: part.text });
  };

  VAMPS.forEach(t => add("vamp", "suspicion", t));
  MURMURS.early.forEach(t => add("murmur", "murmurNeutral", t));
  MURMURS.mid  .forEach(t => add("murmur", "murmurConcern", t));
  MURMURS.late .forEach(t => add("murmur", "murmurGroan",   t));
  EXCLAIMS.forEach(t => add("oath", "oath", t));
  for(const [kind, pool] of Object.entries(REFLEX)){
    const face = REFLEX_FACE[kind] || "suspicion";
    if(Array.isArray(pool)) pool.forEach(t => add("reflex", face, t));
    else for(const tier of TIERS) (pool[tier]||[]).forEach(t => add("reflex", face, t));
  }

  for(const w of ALL_WORDS){
    OPENERS.forEach(f => add("opener", "suspicion", f(w)));
    add("closefallback", "grudge", winFallback(w));
  }
  REPEAT_WORDS.forEach(w => add("opener", "suspicion", repeatOpener(w)));
  FIXED.forEach(f => add("fixed", f.face, f.text));

  // de-dupe on (text, emotion)
  const seen = new Set();
  return out.filter(c => {
    const k = c.emotion + " " + c.text;
    if(seen.has(k)) return false;
    seen.add(k); return true;
  });
}
