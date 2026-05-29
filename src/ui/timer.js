// Worker-backed interval engine + WAV audio cues.
//
// Timer authority lives in src/ui/timer-worker.js, which uses Date.now()
// to stay accurate across foreground/background transitions. This module
// is a thin main-thread wrapper that reacts to the worker's messages,
// plays a beep via a single shared AudioContext, and exposes the same
// engine API the session view consumes.
//
// Audio cues: a single sound (src/audio/beep.wav) is used for everything —
// every interval transition (ready/work/rest start and exercise end) plays
// it once, and the final 5 seconds of each interval play it three times,
// at 5s / 3s / 1s remaining. The WAV is fetched and decoded once into an
// AudioBuffer, then replayed through a fresh BufferSource per cue, which
// keeps latency low and works within the iOS user-gesture unlock model the
// session view drives.

const BEEP_URL = new URL("../audio/beep.wav", import.meta.url);

let audioCtx = null;
let beepBuffer = null;
let beepLoad = null;

function ensureCtx() {
  if (audioCtx) return audioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) audioCtx = new AC();
  return audioCtx;
}

// Fetch + decode the beep once. decodeAudioData is called with both the
// promise and the legacy callback signatures so older WebKit (no promise
// overload) still resolves. Returns null on any failure so callers no-op.
function loadBeep() {
  if (beepBuffer) return Promise.resolve(beepBuffer);
  if (beepLoad) return beepLoad;
  const c = ensureCtx();
  if (!c) return Promise.resolve(null);
  beepLoad = fetch(BEEP_URL)
    .then((r) => r.arrayBuffer())
    .then((data) => new Promise((resolve, reject) => {
      const ret = c.decodeAudioData(data, resolve, reject);
      if (ret && typeof ret.then === "function") ret.then(resolve, reject);
    }))
    .then((buf) => { beepBuffer = buf; return buf; })
    .catch(() => null);
  return beepLoad;
}

/** Resume the AudioContext in response to a user gesture and warm the beep
 *  buffer. iOS requires the resume before any sound will play. Returns a
 *  promise that resolves once the context is running, so callers can await
 *  before the first cue. A silent one-frame buffer primer helps unblock
 *  older WebKit without using an oscillator. */
export function unlockAudio() {
  const c = ensureCtx();
  if (!c) return Promise.resolve();
  loadBeep();
  try {
    const silent = c.createBuffer(1, 1, c.sampleRate);
    const src = c.createBufferSource();
    src.buffer = silent;
    src.connect(c.destination);
    src.start(0);
  } catch {}
  if (c.state === "suspended" || c.state === "interrupted") {
    return c.resume().catch(() => {});
  }
  return Promise.resolve();
}

// Re-resume the AudioContext as soon as the page comes back to the foreground.
// iOS suspends the context (or marks it 'interrupted') when the page is hidden,
// and beeps scheduled before resume completes are silently dropped.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && audioCtx) {
    if (audioCtx.state === "suspended" || audioCtx.state === "interrupted") {
      audioCtx.resume().catch(() => {});
    }
  }
});

function playBuffer(buf) {
  const c = audioCtx;
  if (!c || !buf) return;
  try {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start();
  } catch {}
}

/** Play the beep. The same sound is used for every cue. If the buffer isn't
 *  decoded yet (first cue racing the fetch) we load it then play once ready. */
function playBeep() {
  const c = audioCtx;
  if (!c) return;
  // Best-effort wake the context if a cue arrives mid-suspension.
  if (c.state !== "running") c.resume().catch(() => {});
  if (beepBuffer) { playBuffer(beepBuffer); return; }
  loadBeep().then((buf) => { if (buf) playBuffer(buf); });
}

/**
 * Build an interval engine backed by a Web Worker.
 * Returns { start, skip, stop, onTick(cb), onPhase(cb), onDone(cb) }.
 *
 * Tick callback signature: { remaining, phase, index }
 * Phase callback signature: { remaining, phase, index }
 */
export function makeIntervalEngine(phases) {
  const worker = new Worker(new URL("./timer-worker.js", import.meta.url));
  worker.postMessage({ type: "init", phases });

  const tickListeners = [];
  const phaseListeners = [];
  const doneListeners = [];

  function emit(arr, ...args) { for (const fn of arr) try { fn(...args); } catch {} }

  worker.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === "tick") {
      // Countdown cue over the final 5 seconds of every interval: 5s, 3s, 1s
      // remaining. The transition beep below fires the moment the interval ends.
      if (m.remaining === 5 || m.remaining === 3 || m.remaining === 1) playBeep();
      emit(tickListeners, { remaining: m.remaining, phase: phases[m.phaseIdx], index: m.phaseIdx });
    } else if (m.type === "phase") {
      playBeep();
      emit(phaseListeners, { phase: phases[m.phaseIdx], index: m.phaseIdx, remaining: m.remaining });
    } else if (m.type === "done") {
      playBeep();
      emit(doneListeners);
    }
  };

  return {
    start() { worker.postMessage({ type: "start" }); },
    skip()  { worker.postMessage({ type: "skip" }); },
    stop()  { worker.postMessage({ type: "stop" }); worker.terminate(); },
    onTick(cb)  { tickListeners.push(cb); },
    onPhase(cb) { phaseListeners.push(cb); },
    onDone(cb)  { doneListeners.push(cb); }
  };
}

/* ---------------- phase builders ---------------- */

const READY_SECONDS = 15;
function readyPhase() {
  return { label: "GET READY", kind: "ready", seconds: READY_SECONDS, round: 0 };
}

/** Standard: 15s ready, then N rounds of 1min work / 1min rest, ending on work. */
export function standardPhases(n) {
  const out = [readyPhase()];
  for (let i = 0; i < n; i++) {
    out.push({ label: "WORK", kind: "work", seconds: 60, round: i + 1 });
    if (i < n - 1) out.push({ label: "REST", kind: "rest", seconds: 60, round: i + 1 });
  }
  return out;
}

/** Bilateral: 15s ready, then 3 rounds of 1min L / 1min R / 1min rest. */
export function bilateralPhases(n = 3) {
  const out = [readyPhase()];
  for (let i = 0; i < n; i++) {
    out.push({ label: "LEFT",  kind: "work", seconds: 60, round: i + 1, side: "L" });
    out.push({ label: "RIGHT", kind: "work", seconds: 60, round: i + 1, side: "R" });
    if (i < n - 1) out.push({ label: "REST", kind: "rest", seconds: 60, round: i + 1 });
  }
  return out;
}

/** 10/10 (continuous): 15s ready, then a single 10-minute work block. */
export function continuousPhases() {
  return [readyPhase(), { label: "WORK", kind: "work", seconds: 600, round: 1 }];
}

/** 90 Bilateral: 15s ready, then 90s work / 60s rest / 90s work. */
export function ninetyBilateralPhases() {
  return [
    readyPhase(),
    { label: "WORK", kind: "work", seconds: 90, round: 1 },
    { label: "REST", kind: "rest", seconds: 60, round: 1 },
    { label: "WORK", kind: "work", seconds: 90, round: 2 }
  ];
}

/** Render the timer ring; returns the root element with helpers to update it. */
export function renderTimerRing(initial = 60) {
  const SIZE = 240;
  const R = 108;
  const C = 2 * Math.PI * R;

  const root = document.createElement("div");
  root.className = "timer";
  root.innerHTML = `
    <svg viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
      <circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${R}" fill="none" stroke="rgba(15,35,64,0.08)" stroke-width="10"/>
      <circle class="ring" cx="${SIZE / 2}" cy="${SIZE / 2}" r="${R}" fill="none" stroke="var(--terracotta)" stroke-width="10" stroke-linecap="round"
              stroke-dasharray="${C}" stroke-dashoffset="0"/>
    </svg>
    <div class="countdown">0:00</div>
    <div class="phase">READY</div>
  `;
  const ring = root.querySelector(".ring");
  const cd = root.querySelector(".countdown");
  const phaseEl = root.querySelector(".phase");

  function fmt(s) {
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, "0");
    return `${m}:${ss}`;
  }

  let totalForPhase = initial;
  return {
    el: root,
    setPhase(label, total) {
      totalForPhase = total;
      phaseEl.textContent = label;
      cd.textContent = fmt(total);
      ring.setAttribute("stroke-dashoffset", "0");
      if (label === "REST") ring.setAttribute("stroke", "var(--brass)");
      else if (label === "GET READY") ring.setAttribute("stroke", "var(--amber)");
      else ring.setAttribute("stroke", "var(--terracotta)");
    },
    setRemaining(remaining) {
      cd.textContent = fmt(remaining);
      const pct = totalForPhase > 0 ? remaining / totalForPhase : 0;
      // Negative dashoffset rotates the gap so the empty arc grows clockwise
      // from 12 o'clock as time elapses.
      ring.setAttribute("stroke-dashoffset", String(-(C * (1 - pct))));
    }
  };
}
