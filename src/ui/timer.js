// Auto-advancing interval engine with WebAudio cues.
// Tap-anywhere on the timer face skips to the next phase.
//
// Phase model:
//   { kind: "ready" | "work" | "rest", label, seconds, round?, side? }
// Every phase list begins with a 15-second READY phase so the user can get
// into position before the first work interval starts.
//
// Audio cues:
//   READY phase starts → soft single beep
//   WORK phase starts  → two short beeps  (high pitch)
//   REST phase starts  → single short beep (mid pitch)
//   Final phase ends   → three ascending tones (exercise complete)
//   Last 3 seconds of any phase → quiet tick beep

let audioCtx = null;

function ensureCtx() {
  if (audioCtx) return audioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) audioCtx = new AC();
  return audioCtx;
}

/** Resume the AudioContext in response to a user gesture. iOS requires this
 *  before any sound will play. Returns a promise that resolves once the
 *  context is running, so callers can await it before scheduling beeps.
 *  Plays a near-silent primer oscillator that helps unblock some older
 *  WebKit versions. Safe to call repeatedly — only ever resumes if needed. */
export function unlockAudio() {
  const c = ensureCtx();
  if (!c) return Promise.resolve();
  try {
    const osc = c.createOscillator();
    const gain = c.createGain();
    gain.gain.value = 0.00001;
    osc.connect(gain);
    gain.connect(c.destination);
    const t = c.currentTime;
    osc.start(t);
    osc.stop(t + 0.02);
  } catch {}
  if (c.state === "suspended") return c.resume().catch(() => {});
  return Promise.resolve();
}

function beep({ freq = 880, duration = 0.08, volume = 0.18, when = 0 } = {}) {
  const c = audioCtx;
  if (!c || c.state !== "running") return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.frequency.value = freq;
  osc.type = "sine";
  osc.connect(gain);
  gain.connect(c.destination);
  const t = c.currentTime + when;
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.start(t);
  osc.stop(t + duration);
}

export function tickBeep()         { beep({ freq: 660, duration: 0.05, volume: 0.10 }); }
export function readyStartBeep()   { beep({ freq: 520, duration: 0.10, volume: 0.16 }); }
export function workStartBeep() {
  beep({ freq: 880, duration: 0.12, volume: 0.22, when: 0.00 });
  beep({ freq: 880, duration: 0.12, volume: 0.22, when: 0.16 });
}
export function restStartBeep()    { beep({ freq: 660, duration: 0.16, volume: 0.20 }); }
export function exerciseEndBeep() {
  beep({ freq: 660,  duration: 0.16, volume: 0.22, when: 0.00 });
  beep({ freq: 880,  duration: 0.16, volume: 0.22, when: 0.18 });
  beep({ freq: 1100, duration: 0.32, volume: 0.24, when: 0.36 });
}

// Backward-compat aliases (kept in case anything else imports them).
export function chimeBeep() { workStartBeep(); }
export function endChime()  { exerciseEndBeep(); }

/**
 * Build an interval engine.
 * phases: ordered list of { kind, label, seconds, ... }.
 *
 * Returns { start, pause, resume, skip, stop, onTick(cb), onPhase(cb), onDone(cb) }
 */
export function makeIntervalEngine(phases) {
  let idx = 0;
  let remaining = phases[0]?.seconds ?? 0;
  let timer = null;
  let running = false;

  const tickListeners = [];
  const phaseListeners = [];
  const doneListeners = [];

  function emit(arr, ...args) { for (const fn of arr) fn(...args); }

  function transitionBeep(phase) {
    if (!phase) return;
    if (phase.kind === "work")  workStartBeep();
    else if (phase.kind === "rest")  restStartBeep();
    else if (phase.kind === "ready") readyStartBeep();
  }

  function tick() {
    if (!running) return;
    remaining--;
    emit(tickListeners, { remaining, phase: phases[idx], index: idx });
    if (remaining === 3 || remaining === 2 || remaining === 1) tickBeep();
    if (remaining <= 0) advance();
  }

  function advance() {
    idx++;
    if (idx >= phases.length) {
      running = false;
      clearInterval(timer);
      timer = null;
      exerciseEndBeep();
      emit(doneListeners);
      return;
    }
    remaining = phases[idx].seconds;
    transitionBeep(phases[idx]);
    emit(phaseListeners, { phase: phases[idx], index: idx, remaining });
  }

  return {
    start() {
      if (running) return;
      running = true;
      transitionBeep(phases[idx]);
      emit(phaseListeners, { phase: phases[idx], index: idx, remaining });
      timer = setInterval(tick, 1000);
    },
    pause() {
      running = false;
      if (timer) { clearInterval(timer); timer = null; }
    },
    resume() {
      if (running || idx >= phases.length) return;
      running = true;
      timer = setInterval(tick, 1000);
    },
    skip() { if (idx < phases.length) advance(); },
    stop() {
      running = false;
      if (timer) { clearInterval(timer); timer = null; }
      idx = phases.length;
    },
    onTick(cb) { tickListeners.push(cb); },
    onPhase(cb) { phaseListeners.push(cb); },
    onDone(cb) { doneListeners.push(cb); },
    state() { return { idx, remaining, phase: phases[idx], running, total: phases.length }; }
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
      else if (label === "LEFT" || label === "RIGHT") ring.setAttribute("stroke", "var(--terracotta)");
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
