// Worker-backed interval engine + WebAudio cues.
//
// Timer authority lives in src/ui/timer-worker.js, which uses Date.now()
// to stay accurate across foreground/background transitions. This module
// is a thin main-thread wrapper that reacts to the worker's messages,
// plays beeps via a single shared AudioContext, and exposes the same
// engine API the session view consumes.
//
// Audio cues:
//   READY phase starts → soft single beep (520 Hz)
//   WORK phase starts  → two short beeps  (880 Hz × 2)
//   REST phase starts  → single short beep (660 Hz)
//   Final phase ends   → three ascending tones (660 / 880 / 1100 Hz)
//   Last 3 seconds of any phase → quiet tick beep
//
// All beeps are scheduled with AudioContext.currentTime + an offset, so the
// sub-tones inside workStartBeep / exerciseEndBeep fire at deterministic
// times regardless of main-thread responsiveness.

let audioCtx = null;

function ensureCtx() {
  if (audioCtx) return audioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) audioCtx = new AC();
  return audioCtx;
}

/** Resume the AudioContext in response to a user gesture. iOS requires this
 *  before any sound will play. Returns a promise that resolves once the
 *  context is running, so callers can await before scheduling beeps.
 *  Plays a near-silent primer oscillator that helps unblock older WebKit. */
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

// Volume notes: amplitudes were quiet enough to disappear under music in
// earbuds. Pushed close to unity gain on the loud cues, with a 5ms attack
// ramp so the high amplitude doesn't click. Triangle waveform on the loud
// cues has more harmonic content than sine and cuts through music better
// without sounding harsh.
function beep({ freq = 880, duration = 0.08, volume = 0.4, when = 0, type = "sine" } = {}) {
  const c = audioCtx;
  if (!c) return;
  // Best-effort wake the context if a beep arrives mid-suspension.
  if (c.state !== "running") c.resume().catch(() => {});
  if (c.state !== "running") return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.frequency.value = freq;
  osc.type = type;
  osc.connect(gain);
  gain.connect(c.destination);
  const t = c.currentTime + when;
  // 5ms linear attack from silence avoids the click that comes from
  // setValueAtTime jumping straight to a loud value.
  gain.gain.setValueAtTime(0.00001, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

export function tickBeep()       { beep({ freq: 660,  duration: 0.06, volume: 0.40 }); }
export function readyStartBeep() { beep({ freq: 520,  duration: 0.14, volume: 0.70, type: "triangle" }); }
export function workStartBeep() {
  beep({ freq: 880,  duration: 0.18, volume: 0.95, type: "triangle", when: 0.00 });
  beep({ freq: 880,  duration: 0.18, volume: 0.95, type: "triangle", when: 0.22 });
}
export function restStartBeep()  { beep({ freq: 660,  duration: 0.22, volume: 0.85, type: "triangle" }); }
export function exerciseEndBeep() {
  beep({ freq: 660,  duration: 0.22, volume: 0.90, type: "triangle", when: 0.00 });
  beep({ freq: 880,  duration: 0.22, volume: 0.90, type: "triangle", when: 0.24 });
  beep({ freq: 1100, duration: 0.40, volume: 0.95, type: "triangle", when: 0.48 });
}

// Backward-compat aliases.
export function chimeBeep() { workStartBeep(); }
export function endChime()  { exerciseEndBeep(); }

function transitionBeep(phase) {
  if (!phase) return;
  if (phase.kind === "work")       workStartBeep();
  else if (phase.kind === "rest")  restStartBeep();
  else if (phase.kind === "ready") readyStartBeep();
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
      if (m.remaining === 3 || m.remaining === 2 || m.remaining === 1) tickBeep();
      emit(tickListeners, { remaining: m.remaining, phase: phases[m.phaseIdx], index: m.phaseIdx });
    } else if (m.type === "phase") {
      transitionBeep(phases[m.phaseIdx]);
      emit(phaseListeners, { phase: phases[m.phaseIdx], index: m.phaseIdx, remaining: m.remaining });
    } else if (m.type === "done") {
      exerciseEndBeep();
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
