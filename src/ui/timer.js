// Auto-advancing 1-minute interval engine with WebAudio cues.
// Tap-anywhere on the timer face skips to the next phase.

let audioCtx = null;
function ctx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  return audioCtx;
}

/** Resume audio in response to a user gesture. Required on iOS. */
export function unlockAudio() {
  const c = ctx();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

function beep({ freq = 880, duration = 0.08, volume = 0.18 } = {}) {
  const c = ctx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.frequency.value = freq;
  osc.type = "sine";
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(c.destination);
  const t = c.currentTime;
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.start(t);
  osc.stop(t + duration);
}

export function tickBeep() { beep({ freq: 660, duration: 0.05, volume: 0.12 }); }
export function chimeBeep() {
  beep({ freq: 880, duration: 0.18, volume: 0.22 });
  setTimeout(() => beep({ freq: 1320, duration: 0.18, volume: 0.18 }), 120);
}
export function endChime() {
  beep({ freq: 880, duration: 0.2, volume: 0.22 });
  setTimeout(() => beep({ freq: 660, duration: 0.2, volume: 0.18 }), 200);
  setTimeout(() => beep({ freq: 440, duration: 0.3, volume: 0.18 }), 400);
}

/**
 * Build an interval engine.
 * phases: array of { label, seconds }   e.g. [{label:"WORK",seconds:60},{label:"REST",seconds:60},...]
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

  function tick() {
    if (!running) return;
    remaining--;
    emit(tickListeners, { remaining, phase: phases[idx], index: idx });
    if (remaining === 3 || remaining === 2 || remaining === 1) tickBeep();
    if (remaining <= 0) advance();
  }

  function advance() {
    chimeBeep();
    idx++;
    if (idx >= phases.length) {
      running = false;
      clearInterval(timer);
      timer = null;
      endChime();
      emit(doneListeners);
      return;
    }
    remaining = phases[idx].seconds;
    emit(phaseListeners, { phase: phases[idx], index: idx, remaining });
  }

  return {
    start() {
      if (running) return;
      running = true;
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

/** Build standard set type phases: N rounds of 1min work / 1min rest, ending on work. */
export function standardPhases(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ label: "WORK", kind: "work", seconds: 60, round: i + 1 });
    if (i < n - 1) out.push({ label: "REST", kind: "rest", seconds: 60, round: i + 1 });
  }
  return out;
}

/** Build bilateral phases: 3 rounds of 1min L / 1min R / 1min rest. */
export function bilateralPhases(n = 3) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ label: "LEFT",  kind: "work", seconds: 60, round: i + 1, side: "L" });
    out.push({ label: "RIGHT", kind: "work", seconds: 60, round: i + 1, side: "R" });
    if (i < n - 1) out.push({ label: "REST", kind: "rest", seconds: 60, round: i + 1 });
  }
  return out;
}

/** Build continuous phase: single 10-min work block. */
export function continuousPhases() {
  return [{ label: "WORK", kind: "work", seconds: 600, round: 1 }];
}

/** Render the timer ring: returns the root element with helpers to update. */
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
      // color by kind hint
      if (label === "REST") ring.setAttribute("stroke", "var(--brass)");
      else if (label === "LEFT" || label === "RIGHT") ring.setAttribute("stroke", "var(--terracotta)");
      else ring.setAttribute("stroke", "var(--terracotta)");
    },
    setRemaining(remaining) {
      cd.textContent = fmt(remaining);
      const pct = totalForPhase > 0 ? remaining / totalForPhase : 0;
      ring.setAttribute("stroke-dashoffset", String(C * (1 - pct)));
    }
  };
}
