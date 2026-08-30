/* =========================================================
   ROASTY — dev ticker.
   An on-screen tape of every audio event in the last 30 seconds, so the
   real density of his presence is visible instead of inferred.
   Off unless the page is opened with ?dev=1 (or window.__roasty.ticker.show()).
   ========================================================= */

const WINDOW_MS = 30000;

const COLOR = {
  murmur:   "#9fe0a8",
  reflex:   "#e0c86a",
  vamp:     "#7db3d8",
  ai:       "#ff9b6a",
  opener:   "#c9a13b",
  held:     "#8a8375",
  stale:    "#e0562c",
  moment:   "#b8a6ff",
  latency:  "#ffffff"
};

export class Ticker {
  constructor() {
    this.events = [];
    this.el = null;
    this.listEl = null;
    this.on = false;
    this.t0 = performance.now();
    this.timer = null;
  }

  mount() {
    if (this.el) return;
    const el = document.createElement("div");
    el.id = "devTicker";
    el.innerHTML =
      `<div id="devTickerHead">audio ticker · last 30s<span id="devTickerRate"></span></div>` +
      `<div id="devTickerList"></div>`;
    Object.assign(el.style, {
      position: "fixed", right: "8px", top: "8px", zIndex: "40",
      width: "260px", maxHeight: "52dvh", overflow: "hidden",
      background: "rgba(29,26,22,.92)", color: "#f6f2e9",
      font: "10px/1.35 ui-monospace,Menlo,monospace",
      border: "1px solid #8a8375", borderRadius: "8px",
      padding: "6px 8px", pointerEvents: "none", whiteSpace: "pre"
    });
    document.body.appendChild(el);
    this.el = el;
    this.listEl = el.querySelector("#devTickerList");
    this.rateEl = el.querySelector("#devTickerRate");
    Object.assign(el.querySelector("#devTickerHead").style, {
      color: "#8a8375", borderBottom: "1px solid #3a352c",
      paddingBottom: "3px", marginBottom: "3px",
      display: "flex", justifyContent: "space-between"
    });
    this.timer = setInterval(() => this.render(), 250);
  }

  show() { this.on = true; this.mount(); if (this.el) this.el.style.display = "block"; }
  hide() { this.on = false; if (this.el) this.el.style.display = "none"; }
  toggle() { this.on ? this.hide() : this.show(); }

  /** type: murmur|reflex|vamp|ai|opener|held|stale|moment|latency */
  push(type, detail = "") {
    this.events.push({ t: performance.now(), type, detail });
    const cut = performance.now() - WINDOW_MS;
    while (this.events.length && this.events[0].t < cut) this.events.shift();
  }

  /** how many audible clips landed in the last N ms — the density number */
  densityPerSec(ms = WINDOW_MS) {
    const cut = performance.now() - ms;
    const heard = this.events.filter((e) => e.t >= cut && !["held", "stale", "moment", "latency"].includes(e.type));
    return heard.length / (ms / 1000);
  }

  /** gaps between audible events, to see if he ever goes quiet for too long */
  longestGapMs() {
    const heard = this.events.filter((e) => !["held", "stale", "moment", "latency"].includes(e.type));
    let worst = 0;
    for (let i = 1; i < heard.length; i++) worst = Math.max(worst, heard[i].t - heard[i - 1].t);
    return Math.round(worst);
  }

  render() {
    if (!this.on || !this.listEl) return;
    const cut = performance.now() - WINDOW_MS;
    while (this.events.length && this.events[0].t < cut) this.events.shift();
    const now = performance.now();
    const rows = this.events.slice(-26).map((e) => {
      const ago = ((now - e.t) / 1000).toFixed(1).padStart(4);
      const c = COLOR[e.type] || "#f6f2e9";
      const d = e.detail.length > 26 ? e.detail.slice(0, 25) + "…" : e.detail;
      return `<div style="color:${c}">-${ago}s ${e.type.padEnd(7)} ${escapeHtml(d)}</div>`;
    });
    this.listEl.innerHTML = rows.join("") || `<div style="color:#8a8375">(nothing yet)</div>`;
    const gap = this.longestGapMs();
    this.rateEl.textContent = `${this.densityPerSec().toFixed(2)}/s gap ${(gap / 1000).toFixed(1)}s`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
