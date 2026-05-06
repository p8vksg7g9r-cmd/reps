// Authoritative interval timer running in a Web Worker.
//
// Why a worker: when the page is in the background, browsers (especially iOS
// Safari) throttle setInterval on the main thread to ~1Hz or less, which
// makes the on-screen timer drift. A worker is throttled too, but every
// computation here is anchored to Date.now() rather than tick count, so the
// state stays correct even if ticks come in late or in a burst when the
// page returns to the foreground.
//
// Protocol — main → worker:
//   { type: "init", phases }     register the phase list
//   { type: "start" }            begin from phase 0
//   { type: "skip" }             advance to next phase immediately
//   { type: "stop" }             halt
//
// Protocol — worker → main:
//   { type: "phase", phaseIdx, remaining }   on entry to a new phase
//   { type: "tick",  phaseIdx, remaining }   every full second of phase change
//   { type: "done" }                         all phases complete

let phases = [];
let phaseIdx = 0;
let phaseStartedAt = 0;
let interval = null;
let running = false;
let lastPostedRemaining = -1;

self.onmessage = (e) => {
  const msg = e.data || {};
  switch (msg.type) {
    case "init":
      phases = Array.isArray(msg.phases) ? msg.phases : [];
      phaseIdx = 0;
      phaseStartedAt = 0;
      lastPostedRemaining = -1;
      break;

    case "start":
      if (running) return;
      running = true;
      phaseIdx = 0;
      phaseStartedAt = Date.now();
      const first = phases[0];
      if (!first) { stopInterval(); running = false; post({ type: "done" }); return; }
      lastPostedRemaining = first.seconds;
      post({ type: "phase", phaseIdx, remaining: first.seconds });
      startInterval();
      break;

    case "skip":
      if (!running) return;
      advance();
      break;

    case "stop":
      stopInterval();
      running = false;
      break;
  }
};

function startInterval() {
  if (interval) clearInterval(interval);
  // 200ms keeps the displayed seconds close to the wall clock without
  // flooding the main thread with messages.
  interval = setInterval(tick, 200);
}

function stopInterval() {
  if (interval) clearInterval(interval);
  interval = null;
}

function tick() {
  if (!running) return;
  const phase = phases[phaseIdx];
  if (!phase) { stopInterval(); running = false; post({ type: "done" }); return; }
  const elapsed = Date.now() - phaseStartedAt;
  if (elapsed >= phase.seconds * 1000) {
    // One or more phase boundaries crossed — advance the right number of
    // times. Each advance() posts its own phase event so the main thread
    // can fire audio + UI updates in order.
    phaseStartedAt += phase.seconds * 1000;
    phaseIdx++;
    if (phaseIdx >= phases.length) {
      stopInterval();
      running = false;
      post({ type: "done" });
      return;
    }
    lastPostedRemaining = phases[phaseIdx].seconds;
    post({ type: "phase", phaseIdx, remaining: phases[phaseIdx].seconds });
    // Recurse to handle any further phases that fully elapsed during the gap.
    return tick();
  }
  const remaining = Math.max(0, Math.ceil((phase.seconds * 1000 - elapsed) / 1000));
  if (remaining !== lastPostedRemaining) {
    lastPostedRemaining = remaining;
    post({ type: "tick", phaseIdx, remaining });
  }
}

function advance() {
  // User-initiated skip: jump to the next phase regardless of elapsed time.
  phaseIdx++;
  if (phaseIdx >= phases.length) {
    stopInterval();
    running = false;
    post({ type: "done" });
    return;
  }
  phaseStartedAt = Date.now();
  lastPostedRemaining = phases[phaseIdx].seconds;
  post({ type: "phase", phaseIdx, remaining: phases[phaseIdx].seconds });
}

function post(m) { self.postMessage(m); }
