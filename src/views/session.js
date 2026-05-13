import {
  getExercise, getOpenSession, getOrCreateOpenSession, endSession,
  recordSet, updateSet, setsForSession, setsForExercise, lastSessionForExercise, updateExercise
} from "../db/repo.js";
import { h, eyebrow, stepper, field, modal, setTypeStructure, readStepperNumber, fmtKg, fmtVolume } from "../ui/components.js";
import { setVolume } from "../domain/volume.js";
import {
  makeIntervalEngine, standardPhases, bilateralPhases, continuousPhases, ninetyBilateralPhases,
  renderTimerRing, unlockAudio
} from "../ui/timer.js";
import { makeTapCounter } from "../ui/tap-counter.js";
import { acquireWakeLock, releaseWakeLock } from "../ui/wake-lock.js";

/** Format a positive integer of seconds as M:SS. */
function fmtMinSec(totalSec) {
  if (totalSec == null || totalSec < 0) totalSec = 0;
  const m = Math.floor(totalSec / 60);
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${m}:${ss}`;
}

/**
 * Total time remaining for the exercise = remaining of the current phase plus
 * the full duration of every subsequent phase. Recomputes naturally when the
 * user skips because we always feed the current phase index + remaining.
 */
function totalRemainingSec(phases, currentPhaseIdx, currentPhaseRemaining) {
  let total = Math.max(0, currentPhaseRemaining || 0);
  for (let i = (currentPhaseIdx ?? 0) + 1; i < phases.length; i++) {
    total += phases[i].seconds;
  }
  return total;
}

/** Prominent "Exercise time remaining" widget shown below the timer ring. */
function makeTotalRemaining(initialSec) {
  const value = h("div", { class: "tr-value mono" }, fmtMinSec(initialSec));
  const root = h("div", { class: "total-remaining" }, [
    h("div", { class: "tr-label" }, "Exercise time remaining"),
    value
  ]);
  return {
    el: root,
    set(sec) { value.textContent = fmtMinSec(sec); }
  };
}

/** Pick the timing phases for an exercise based on its set type. */
function phasesFor(ex) {
  switch (ex.setType) {
    case "bilateral":        return bilateralPhases(3);
    case "continuous":       return continuousPhases();
    case "six_ten":          return standardPhases(6);
    case "ninety_bilateral": return ninetyBilateralPhases();
    case "standard":
    default:                 return standardPhases(ex.rounds || 3);
  }
}

export async function SessionView(params, root) {
  const exerciseId = Number(params.exerciseId);
  const ex = await getExercise(exerciseId);
  if (!ex) {
    root.appendChild(h("p", {}, "Exercise not found."));
    return;
  }

  // Cardio and no-timer exercises don't have a structured timer — redirect
  // to the manual entry route. This guards against deep links / hand-typed
  // URLs landing in the wrong renderer.
  if (ex.category === "cardio" || ex.setType === "no_timer") {
    location.hash = `#/quicklog/${ex.id}`;
    return;
  }

  // The "last time" reference looks at the previous session containing this
  // exercise — explicitly excluding the currently open session, which may
  // already have prior sets for this same exercise. Returns both avg weight
  // and avg reps so we can pre-fill the weight stepper AND display a
  // "Last time: 40kg × 12 reps" hint at the top of the screen.
  const openSess = await getOpenSession();
  const lastRef = await computeLastRef(exerciseId, openSess?.id);

  // Inform the router so the persistent active-bar can show the right name.
  window.dispatchEvent(new CustomEvent("session:setname", {
    detail: { exerciseId: ex.id, name: ex.name }
  }));

  const head = h("div", { class: "page-head" }, [
    eyebrow(setTypeStructure(ex)),
    h("h1", { class: "display-l" }, ex.name)
  ]);
  root.appendChild(head);

  // Once Start is clicked we collapse the title block so the timer + log +
  // controls fit within a phone viewport without scrolling. Wired into each
  // renderer's start handler.
  const collapseHead = () => head.classList.add("hidden");

  // Add a scoping class so session-specific layout rules (smaller timer,
  // collapsed page-head after Start, etc.) apply only here.
  root.classList.add("session-page");

  // Bilateral and continuous have bespoke renderers (L/R alternation; tap counter).
  // Everything else routes through the standard work/rest renderer with custom phases.
  if (ex.setType === "bilateral") return renderBilateral({ ex, lastRef, root, collapseHead });
  if (ex.setType === "continuous") return renderContinuous({ ex, lastRef, root, collapseHead });
  return renderStandard({ ex, lastRef, root, collapseHead });
}

/* ----------------------------------------------------- helpers */

/**
 * Resolve the "last time" reference for an exercise: the average weight and
 * average reps from the most recent previous session that contained it.
 * Returns null if no previous session exists. Average weight is used both for
 * pre-filling the weight stepper and for the "Last time: 40kg × 12 reps" hint.
 */
async function computeLastRef(exerciseId, openSessionId) {
  const last = await lastSessionForExercise(exerciseId, { excludeSessionId: openSessionId });
  if (!last) return null;
  // The session may contain other exercises too — only this exercise's sets count.
  const sets = (await setsForSession(last.id)).filter((s) => s.exerciseId === exerciseId);
  const validReps = sets.filter((s) => s.reps != null && s.reps > 0).map((s) => s.reps);
  const validWeights = sets.filter((s) => s.weight != null && s.weight > 0).map((s) => s.weight);
  return {
    weight: validWeights.length
      ? validWeights.reduce((a, b) => a + b, 0) / validWeights.length
      : null,
    reps: validReps.length
      ? Math.round(validReps.reduce((a, b) => a + b, 0) / validReps.length)
      : null
  };
}

/**
 * Pre-fill rule for the weight stepper:
 *   1. Bodyweight exercises always start at 0 (field is hidden anyway).
 *   2. Otherwise prefer the average weight from the most recent previous
 *      session — within a session weights are usually constant, so the
 *      average equals "what they lifted last time".
 *   3. Fall back to the exercise's stored workingWeight if any.
 *   4. Otherwise blank (null) — the start button validation will prompt.
 */
function pickInitialWeight(ex, lastRef) {
  if (ex.bodyweight) return 0;
  const lastW = lastRef?.weight;
  if (lastW != null && lastW > 0) return Math.round(lastW * 2) / 2;
  if (ex.workingWeight > 0) return ex.workingWeight;
  return null;
}

function makeSetIndicator(initialEyebrow, lastRef) {
  const eb = eyebrow(initialEyebrow);
  let subText = null;
  if (lastRef) {
    const w = lastRef.weight;
    const r = lastRef.reps;
    if (w != null && r != null) subText = `Last time: ${fmtKg(w)} × ${r} reps`;
    else if (r != null) subText = `Last time: ${r} reps`;
  }
  const sub = subText
    ? h("div", { class: "mono", style: "font-size:13px; color: var(--ink-mute); margin-top:4px" }, subText)
    : null;
  const card = h("div", { class: "card stack-sm" }, [eb, sub].filter(Boolean));
  return { el: card, set(text) { eb.textContent = text; } };
}

/** Running log of completed sets shown below the timer. Hidden until the first save. */
function makeCompletedLog({ unitLabel = "Set" } = {}) {
  const eb = eyebrow("Completed");
  const rows = h("div");
  const card = h("div", { class: "card stack-sm completed-log hidden" }, [eb, rows]);
  const seen = new Map(); // round → row element

  function upsert(round, reps) {
    card.classList.remove("hidden");
    const text = `${reps} reps`;
    if (seen.has(round)) {
      seen.get(round).querySelector(".val").textContent = text;
      return;
    }
    const row = h("div", { class: "row" }, [
      h("span", { class: "lbl" }, `${unitLabel} ${round}`),
      h("span", { class: "val" }, text)
    ]);
    rows.appendChild(row);
    seen.set(round, row);
  }
  return { el: card, upsert };
}

/** Reps prompt panel. Starts BLANK each time it's shown — no pre-fill.
 *  After save, the panel just collapses silently — the saved set is already
 *  visible in the completed-sets log above, so a 'Set N saved' card here
 *  would be redundant. */
function makeRepsPanel({ setType }) {
  const root = h("div", { class: "hidden" });

  function clear() {
    root.classList.add("hidden");
    root.innerHTML = "";
  }

  function showPrompt({ round, hint, onSave }) {
    root.classList.remove("hidden");
    root.innerHTML = "";
    let value = null;
    const stp = stepper({
      value: "",                      // start blank
      step: 1,
      placeholder: "—",
      onChange: (n) => { value = n; }
    });
    const label = setType === "bilateral" ? `Round ${round} — reps per side` : `Set ${round} — reps`;
    const saveBtn = h("button", { class: "btn btn-primary btn-block" }, `Save set ${round}`);
    saveBtn.onclick = async () => {
      if (value == null || !Number.isFinite(value) || value < 1) {
        alert("Enter the number of reps you completed.");
        return;
      }
      await onSave(value);
      clear();
    };
    root.appendChild(h("div", { class: "card stack-sm" }, [
      eyebrow(hint),
      field(label, stp),
      saveBtn
    ]));

    // Auto-focus the reps input so the numeric keyboard opens immediately.
    // Mobile browsers may block programmatic focus that isn't tied to a user
    // gesture, but the rest-phase transition is the most recent action on
    // screen — a rAF + click() pair is the most reliable nudge we have.
    const input = stp.querySelector("input");
    if (input) {
      requestAnimationFrame(() => {
        try { input.focus({ preventScroll: false }); } catch { input.focus(); }
        try { input.click(); } catch {}
      });
    }
  }

  function showText(text) {
    root.classList.remove("hidden");
    root.innerHTML = "";
    root.appendChild(h("div", { class: "card card-tight body-s", style: "color: var(--ink-mute); text-align:center" }, text));
  }

  return { el: root, clear, showPrompt, showText };
}

/** Modal for any sets that didn't get reps entered during their rest period. Blank entries. */
function promptMissingReps(missing, { setType }) {
  return new Promise((resolve) => {
    const refs = missing.map((s) => ({ setId: s.id, round: s.round, value: null }));
    const fields = refs.map((r) => {
      const stp = stepper({
        value: "",
        step: 1,
        placeholder: "—",
        onChange: (n) => { r.value = n; }
      });
      const lbl = setType === "bilateral" ? `Round ${r.round} reps per side` : `Set ${r.round} reps`;
      return field(lbl, stp);
    });
    const saveAll = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Save all & finish");
    saveAll.onclick = async () => {
      for (const r of refs) {
        if (r.value == null || !Number.isFinite(r.value) || r.value < 1) {
          alert("Fill in reps for every set before saving.");
          return;
        }
      }
      for (const r of refs) await updateSet(r.setId, { reps: r.value });
      m.close();
      resolve();
    };
    const m = modal([
      eyebrow("Before we save"),
      h("h2", { class: "display-m" }, missing.length === 1 ? "1 set needs reps" : `${missing.length} sets need reps`),
      h("p", { class: "body-s", style: "color: var(--ink-mute)" }, "Fill these in and we'll wrap up the session."),
      ...fields,
      saveAll
    ]);
  });
}

/** Mark a weight field unmistakably read-only: dim the stepper, disable its
 *  buttons + input, and append a "LOCKED" tag to the label. */
function lockField(fieldEl, stepperEl) {
  if (stepperEl) {
    stepperEl.classList.add("locked");
    stepperEl.querySelectorAll("button").forEach((b) => { b.disabled = true; b.tabIndex = -1; });
    const input = stepperEl.querySelector("input");
    if (input) { input.disabled = true; input.tabIndex = -1; input.setAttribute("aria-readonly", "true"); }
  }
  const labelEl = fieldEl?.querySelector(".label");
  if (labelEl && !labelEl.querySelector(".lock-tag")) {
    labelEl.appendChild(h("span", { class: "lock-tag" }, "LOCKED"));
  }
}

/** Inline error label that lives next to the Start button. Toggled via show/hide. */
function makeStartError() {
  const el = h("p", {
    class: "body-s hidden",
    style: "color: var(--terracotta); margin: 0 0 8px; text-align:center; font-weight:600"
  }, "");
  return {
    el,
    show(text) { el.textContent = text; el.classList.remove("hidden"); },
    hide() { el.classList.add("hidden"); }
  };
}

/** Read the current weight from both the bound state and the live input element
 *  (the bound state may be stale if the user typed without blurring). */
function currentWeightValue(stateRef, stepperEl) {
  const live = readStepperNumber(stepperEl);
  return live != null ? live : stateRef.value;
}

/**
 * The two-button block shown after an exercise's sets are all logged:
 *   [Start new exercise]   — keeps the current session open, returns to picker
 *   [End session]          — closes the session and goes to its summary
 * Both call the provided onPersist hook first so the exercise's working
 * weight is saved before we navigate away.
 */
function makeEndOfExerciseButtons({ getSessionId, onPersist }) {
  const wrap = h("div", { class: "stack hidden" });
  const startNew = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Start new exercise");
  const endSess = h("button", { class: "btn btn-ghost btn-block btn-lg" }, "End session");
  startNew.addEventListener("click", async () => {
    await onPersist?.();
    releaseWakeLock();
    window.dispatchEvent(new CustomEvent("session:teardown"));
    location.hash = "#/exercises";
  });
  endSess.addEventListener("click", async () => {
    await onPersist?.();
    const sid = getSessionId();
    if (sid != null) await endSession(sid);
    releaseWakeLock();
    window.dispatchEvent(new CustomEvent("session:teardown"));
    location.hash = `#/summary/${sid}`;
  });
  wrap.appendChild(startNew);
  wrap.appendChild(endSess);
  return {
    el: wrap,
    show() { wrap.classList.remove("hidden"); },
    hide() { wrap.classList.add("hidden"); }
  };
}

/* ----------------------------------------------------- trend graph */

/**
 * Aggregate every recorded set for this exercise into per-session points.
 * One point = one gym visit's total volume (weight × reps summed, with the
 * bilateral ×2 already baked into setVolume) and total reps. Returns the
 * last `limit` points sorted oldest → newest, suitable for plotting.
 */
async function buildTrendData(exerciseId, limit = 12) {
  const all = await setsForExercise(exerciseId);
  if (all.length === 0) return [];
  const byS = new Map();
  for (const s of all) {
    if (s.reps == null || s.reps <= 0) continue;
    let e = byS.get(s.sessionId);
    if (!e) {
      e = { sessionId: s.sessionId, volume: 0, reps: 0, completedAt: s.completedAt };
      byS.set(s.sessionId, e);
    }
    e.volume += setVolume(s);
    e.reps += Number(s.reps) || 0;
    if (s.completedAt < e.completedAt) e.completedAt = s.completedAt;
  }
  return [...byS.values()]
    .sort((a, b) => a.completedAt - b.completedAt)
    .slice(-limit);
}

/** Container that holds a dual-line SVG chart of volume + reps per session.
 *  Hidden until populate() is called with a non-empty series. */
function makeTrendCard() {
  const root = h("div", { class: "card stack-sm hidden trend-card" });
  function populate(series) {
    if (!series || series.length === 0) {
      root.classList.add("hidden");
      return;
    }
    root.classList.remove("hidden");
    root.innerHTML = "";
    root.appendChild(eyebrow("Trend across past sessions"));
    if (series.length < 2) {
      root.appendChild(h("p", {
        class: "body-s",
        style: "color: var(--ink-mute); text-align:center; margin:8px 0"
      }, "First session logged — trend appears next time."));
      return;
    }
    const last = series[series.length - 1];
    root.appendChild(renderTrendSVG(series));
    root.appendChild(h("div", { class: "trend-legend" }, [
      h("span", { class: "row" }, [
        h("span", { class: "dot dot-vol" }),
        h("span", { class: "mono" }, `Volume · ${fmtVolume(last.volume)}`)
      ]),
      h("span", { class: "row" }, [
        h("span", { class: "dot dot-reps" }),
        h("span", { class: "mono" }, `Reps · ${last.reps}`)
      ])
    ]));
  }
  return { el: root, populate };
}

/** Two-series line chart inside a single SVG. Volume + reps share an x-axis
 *  but each gets its own linear scale across the available height (so two
 *  series with wildly different magnitudes both fill the chart). */
function renderTrendSVG(series) {
  const W = 320, H = 140, P = 22;
  const n = series.length;
  const xs = series.map((_, i) => P + (i * (W - 2 * P)) / Math.max(1, n - 1));
  const vols = series.map((d) => d.volume);
  const reps = series.map((d) => d.reps);
  const vmax = Math.max(...vols, 1);
  const rmax = Math.max(...reps, 1);
  const yFor = (val, max) => {
    const t = max === 0 ? 0 : val / max;
    return H - P - t * (H - 2 * P);
  };
  const path = (vals, max) => vals
    .map((v, i) => `${i === 0 ? "M" : "L"} ${xs[i].toFixed(1)} ${yFor(v, max).toFixed(1)}`)
    .join(" ");
  const dots = (vals, max, fill) => vals
    .map((v, i) => `<circle cx="${xs[i].toFixed(1)}" cy="${yFor(v, max).toFixed(1)}" r="2.5" fill="${fill}"/>`)
    .join("");
  const svg = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" class="trend-svg" role="img" aria-label="Volume and reps across past sessions">
      <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="rgba(15,35,64,0.15)"/>
      <path d="${path(vols, vmax)}" fill="none" stroke="var(--terracotta)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${path(reps, rmax)}" fill="none" stroke="var(--sage)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots(vols, vmax, "var(--terracotta)")}
      ${dots(reps, rmax, "var(--sage)")}
    </svg>`;
  const wrap = document.createElement("div");
  wrap.innerHTML = svg.trim();
  return wrap.firstElementChild;
}

/* ----------------------------------------------------- standard */

function renderStandard({ ex, lastRef, root, collapseHead }) {
  const phases = phasesFor(ex);
  const totalSets = phases.filter((p) => p.kind === "work").length;
  const firstSec = phases[0]?.seconds || 60;
  const ring = renderTimerRing(firstSec);
  ring.setPhase("READY", firstSec);
  const engine = makeIntervalEngine(phases);
  const totalInitial = phases.reduce((sum, p) => sum + p.seconds, 0);
  const totalRemaining = makeTotalRemaining(totalInitial);

  let sessionId = null;
  // Pre-populate the weight from the most recent previous session for this
  // exercise (lastRef.weight). Falls back to the exercise's stored
  // workingWeight, then blank. Bodyweight exercises always start at 0.
  const initialWeight = pickInitialWeight(ex, lastRef);
  const weight = { value: initialWeight };

  const indicator = makeSetIndicator(`Set 1 of ${totalSets} · ready`, lastRef);
  const weightStepper = ex.bodyweight ? null : stepper({
    value: initialWeight != null ? String(initialWeight) : "",
    step: 1,
    placeholder: "—",
    onChange: (n) => weight.value = n
  });
  const weightFieldEl = ex.bodyweight ? null : field("Weight (kg)", weightStepper);
  const startError = makeStartError();
  const bodyweightBadge = ex.bodyweight ? h("div", { class: "card card-tight body-s row", style: "justify-content:center; gap:8px" }, [
    h("span", { class: "badge badge-brass" }, "Bodyweight"),
    h("span", { style: "color: var(--ink-mute)" }, "no external load")
  ]) : null;
  const completed = makeCompletedLog({ unitLabel: "Set" });
  // For all standard-like types (standard, six_ten, ninety_bilateral) we use
  // "Set" labeling; bilateral uses "Round" labeling in its own renderer.
  const repsPanel = makeRepsPanel({ setType: ex.setType });
  const trend = makeTrendCard();

  const startBtn = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Start");
  const skipBtn = h("button", { class: "btn btn-ghost btn-block hidden", onclick: () => engine.skip() }, "Skip phase");
  const endButtons = makeEndOfExerciseButtons({
    getSessionId: () => sessionId,
    onPersist: async () => updateExercise(ex.id, { workingWeight: weight.value })
  });

  startBtn.addEventListener("click", async () => {
    if (!ex.bodyweight) {
      const w = currentWeightValue(weight, weightStepper);
      if (w == null || !(w > 0)) {
        startError.show("Enter a weight before starting.");
        weightStepper?.querySelector("input")?.focus();
        return;
      }
      weight.value = w;
    }
    startError.hide();
    const open = await getOrCreateOpenSession();
    sessionId = open.id;
    if (weightFieldEl) lockField(weightFieldEl, weightStepper);
    collapseHead?.();
    await unlockAudio();
    acquireWakeLock().catch(() => {});
    engine.start();
    startBtn.classList.add("hidden");
    skipBtn.classList.remove("hidden");
  });
  ring.el.addEventListener("click", () => engine.skip());

  let lastPhaseIdx = -1;

  engine.onPhase(async ({ phase, index, remaining }) => {
    ring.setPhase(phase.label, phase.seconds);
    totalRemaining.set(totalRemainingSec(phases, index, remaining));
    const prev = lastPhaseIdx;
    lastPhaseIdx = index;
    const prevPhase = phases[prev];

    if (prev >= 0 && prevPhase?.kind === "work") {
      const round = prevPhase.round;
      const setId = await recordSet({
        sessionId, exerciseId: ex.id, round,
        weight: weight.value, reps: null, setType: ex.setType
      });

      if (phase.kind === "rest") {
        indicator.set(`Set ${round} done · Set ${round + 1} of ${totalSets} next`);
        // Hide the weight field while the reps prompt is showing so the
        // active screen fits in a phone viewport without scrolling.
        if (weightFieldEl) weightFieldEl.classList.add("hidden");
        repsPanel.showPrompt({
          round,
          hint: `Set ${round} done — log the reps`,
          onSave: async (reps) => {
            await updateSet(setId, { reps });
            completed.upsert(round, reps);
            if (weightFieldEl) weightFieldEl.classList.remove("hidden");
          }
        });
      }
    } else if (phase.kind === "work") {
      indicator.set(`Set ${phase.round} of ${totalSets} · working`);
      repsPanel.clear();
      if (weightFieldEl) weightFieldEl.classList.remove("hidden");
    }
  });

  engine.onTick(({ remaining, index }) => {
    ring.setRemaining(remaining);
    totalRemaining.set(totalRemainingSec(phases, index, remaining));
  });

  engine.onDone(async () => {
    const last = phases[phases.length - 1];
    if (last?.kind === "work") {
      const round = last.round;
      const setId = await recordSet({
        sessionId, exerciseId: ex.id, round,
        weight: weight.value, reps: null, setType: ex.setType
      });
    }
    skipBtn.classList.add("hidden");
    ring.setPhase("DONE", 0);
    totalRemaining.set(0);
    indicator.set("Exercise complete");

    // Filter to this exercise's sets only — sessions are now multi-exercise.
    const all = (await setsForSession(sessionId)).filter((s) => s.exerciseId === ex.id);
    const missing = all.filter((s) => s.reps == null).sort((a, b) => a.round - b.round);
    if (missing.length > 0) {
      await promptMissingReps(missing, { setType: ex.setType });
      const fresh = (await setsForSession(sessionId)).filter((s) => s.exerciseId === ex.id);
      for (const s of fresh) if (s.reps != null) completed.upsert(s.round, s.reps);
    }
    repsPanel.showText("All sets logged. Pick the next exercise or end the session.");
    trend.populate(await buildTrendData(ex.id));
    endButtons.show();
  });

  root.appendChild(indicator.el);
  root.appendChild(ring.el);
  root.appendChild(totalRemaining.el);
  root.appendChild(completed.el);
  root.appendChild(h("div", { class: "session-gap" }));
  if (weightFieldEl) root.appendChild(weightFieldEl);
  if (bodyweightBadge) root.appendChild(bodyweightBadge);
  root.appendChild(repsPanel.el);
  root.appendChild(trend.el);
  root.appendChild(h("div", { class: "session-gap" }));
  root.appendChild(startError.el);
  root.appendChild(startBtn);
  root.appendChild(skipBtn);
  root.appendChild(endButtons.el);

  return () => { engine.stop(); releaseWakeLock(); };
}

/* ----------------------------------------------------- bilateral */

function renderBilateral({ ex, lastRef, root, collapseHead }) {
  const phases = bilateralPhases(3);
  const firstSec = phases[0]?.seconds || 60;
  const ring = renderTimerRing(firstSec);
  ring.setPhase("READY", firstSec);
  const engine = makeIntervalEngine(phases);
  const totalInitial = phases.reduce((sum, p) => sum + p.seconds, 0);
  const totalRemaining = makeTotalRemaining(totalInitial);

  let sessionId = null;
  const initialWeight = pickInitialWeight(ex, lastRef);
  const weight = { value: initialWeight };

  const indicator = makeSetIndicator("Round 1 of 3 · ready", lastRef);
  const weightStepper = ex.bodyweight ? null : stepper({
    value: initialWeight != null ? String(initialWeight) : "",
    step: 0.5,
    placeholder: "—",
    onChange: (n) => weight.value = n
  });
  const weightFieldEl = ex.bodyweight ? null : field("Weight per side (kg)", weightStepper);
  const startError = makeStartError();
  const bodyweightBadge = ex.bodyweight ? h("div", { class: "card card-tight body-s row", style: "justify-content:center; gap:8px" }, [
    h("span", { class: "badge badge-brass" }, "Bodyweight"),
    h("span", { style: "color: var(--ink-mute)" }, "no external load")
  ]) : null;
  const completed = makeCompletedLog({ unitLabel: "Round" });
  const repsPanel = makeRepsPanel({ setType: "bilateral" });
  const trend = makeTrendCard();

  const startBtn = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Start");
  const skipBtn = h("button", { class: "btn btn-ghost btn-block hidden", onclick: () => engine.skip() }, "Skip phase");
  const endButtons = makeEndOfExerciseButtons({
    getSessionId: () => sessionId,
    onPersist: async () => updateExercise(ex.id, { workingWeight: weight.value })
  });

  startBtn.addEventListener("click", async () => {
    if (!ex.bodyweight) {
      const w = currentWeightValue(weight, weightStepper);
      if (w == null || !(w > 0)) {
        startError.show("Enter a weight before starting.");
        weightStepper?.querySelector("input")?.focus();
        return;
      }
      weight.value = w;
    }
    startError.hide();
    const open = await getOrCreateOpenSession();
    sessionId = open.id;
    if (weightFieldEl) lockField(weightFieldEl, weightStepper);
    collapseHead?.();
    await unlockAudio();
    acquireWakeLock().catch(() => {});
    engine.start();
    startBtn.classList.add("hidden");
    skipBtn.classList.remove("hidden");
  });
  ring.el.addEventListener("click", () => engine.skip());

  let lastPhaseIdx = -1;

  engine.onPhase(async ({ phase, index, remaining }) => {
    ring.setPhase(phase.label, phase.seconds);
    totalRemaining.set(totalRemainingSec(phases, index, remaining));
    const prev = lastPhaseIdx;
    lastPhaseIdx = index;
    const prevPhase = phases[prev];

    if (prev >= 0 && prevPhase?.kind === "work" && prevPhase?.side === "R") {
      const round = prevPhase.round;
      const setId = await recordSet({
        sessionId, exerciseId: ex.id, round,
        weight: weight.value, reps: null, setType: "bilateral"
      });
      if (phase.kind === "rest") {
        indicator.set(`Round ${round} done · Round ${round + 1} of 3 next`);
        if (weightFieldEl) weightFieldEl.classList.add("hidden");
        repsPanel.showPrompt({
          round,
          hint: `Round ${round} done — log reps per side`,
          onSave: async (reps) => {
            await updateSet(setId, { reps });
            completed.upsert(round, reps);
            if (weightFieldEl) weightFieldEl.classList.remove("hidden");
          }
        });
      }
    } else if (phase.kind === "work") {
      const sideText = phase.side === "L" ? "left" : "right";
      indicator.set(`Round ${phase.round} of 3 · ${sideText}`);
      if (phase.side === "L") {
        repsPanel.clear();
        if (weightFieldEl) weightFieldEl.classList.remove("hidden");
      }
    }
  });

  engine.onTick(({ remaining, index }) => {
    ring.setRemaining(remaining);
    totalRemaining.set(totalRemainingSec(phases, index, remaining));
  });

  engine.onDone(async () => {
    const last = phases[phases.length - 1];
    if (last?.kind === "work" && last.side === "R") {
      const round = last.round;
      const setId = await recordSet({
        sessionId, exerciseId: ex.id, round,
        weight: weight.value, reps: null, setType: "bilateral"
      });
    }
    skipBtn.classList.add("hidden");
    ring.setPhase("DONE", 0);
    totalRemaining.set(0);
    indicator.set("Exercise complete");

    const all = (await setsForSession(sessionId)).filter((s) => s.exerciseId === ex.id);
    const missing = all.filter((s) => s.reps == null).sort((a, b) => a.round - b.round);
    if (missing.length > 0) {
      await promptMissingReps(missing, { setType: "bilateral" });
      const fresh = (await setsForSession(sessionId)).filter((s) => s.exerciseId === ex.id);
      for (const s of fresh) if (s.reps != null) completed.upsert(s.round, s.reps);
    }
    repsPanel.showText("All rounds logged. Pick the next exercise or end the session.");
    trend.populate(await buildTrendData(ex.id));
    endButtons.show();
  });

  root.appendChild(indicator.el);
  root.appendChild(ring.el);
  root.appendChild(totalRemaining.el);
  root.appendChild(completed.el);
  root.appendChild(h("div", { class: "session-gap" }));
  if (weightFieldEl) root.appendChild(weightFieldEl);
  if (bodyweightBadge) root.appendChild(bodyweightBadge);
  root.appendChild(repsPanel.el);
  root.appendChild(trend.el);
  root.appendChild(h("div", { class: "session-gap" }));
  root.appendChild(startError.el);
  root.appendChild(startBtn);
  root.appendChild(skipBtn);
  root.appendChild(endButtons.el);

  return () => { engine.stop(); releaseWakeLock(); };
}

/* ----------------------------------------------------- continuous */

function renderContinuous({ ex, lastRef, root, collapseHead }) {
  const phases = continuousPhases();
  const firstSec = phases[0]?.seconds || 60;
  const ring = renderTimerRing(firstSec);
  ring.setPhase("READY", firstSec);
  const engine = makeIntervalEngine(phases);
  const totalInitial = phases.reduce((sum, p) => sum + p.seconds, 0);
  const totalRemaining = makeTotalRemaining(totalInitial);

  let sessionId = null;
  const initialWeight = pickInitialWeight(ex, lastRef);
  const weight = { value: initialWeight };
  const tap = makeTapCounter();
  const tapWrap = h("div", { class: "hidden" }, [tap.el, h("p", { class: "tap-hint" }, "Tap to count · long-press to undo")]);

  const indicator = makeSetIndicator("10-minute block · ready", lastRef);
  const weightStepper = ex.bodyweight ? null : stepper({
    value: initialWeight != null ? String(initialWeight) : "",
    step: 0.5,
    placeholder: "—",
    onChange: (n) => weight.value = n
  });
  const weightFieldEl = ex.bodyweight ? null : field("Weight (kg)", weightStepper);
  const startError = makeStartError();
  const bodyweightBadge = ex.bodyweight ? h("div", { class: "card card-tight body-s row", style: "justify-content:center; gap:8px" }, [
    h("span", { class: "badge badge-brass" }, "Bodyweight"),
    h("span", { style: "color: var(--ink-mute)" }, "no external load")
  ]) : null;
  const trend = makeTrendCard();

  const startBtn = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Start");
  const skipBtn = h("button", { class: "btn btn-ghost btn-block hidden", onclick: () => engine.skip() }, "End early");
  const endButtons = makeEndOfExerciseButtons({
    getSessionId: () => sessionId,
    onPersist: async () => {
      // Persist the single continuous-block set + working weight.
      if (sessionId != null) {
        await recordSet({
          sessionId, exerciseId: ex.id, round: 1,
          weight: weight.value, reps: tap.count, setType: "continuous"
        });
      }
      await updateExercise(ex.id, { workingWeight: weight.value });
    }
  });

  startBtn.addEventListener("click", async () => {
    if (!ex.bodyweight) {
      const w = currentWeightValue(weight, weightStepper);
      if (w == null || !(w > 0)) {
        startError.show("Enter a weight before starting.");
        weightStepper?.querySelector("input")?.focus();
        return;
      }
      weight.value = w;
    }
    startError.hide();
    const open = await getOrCreateOpenSession();
    sessionId = open.id;
    if (weightFieldEl) lockField(weightFieldEl, weightStepper);
    collapseHead?.();
    await unlockAudio();
    acquireWakeLock().catch(() => {});
    engine.start();
    startBtn.classList.add("hidden");
    skipBtn.classList.remove("hidden");
    indicator.set("Get ready · 10-minute block starting");
  });

  engine.onPhase(({ phase, index, remaining }) => {
    ring.setPhase(phase.label, phase.seconds);
    totalRemaining.set(totalRemainingSec(phases, index, remaining));
    // Tap counter only appears once the WORK block actually begins, so the
    // user can't rack up taps during the 15-second get-ready countdown.
    if (phase.kind === "work") {
      tapWrap.classList.remove("hidden");
      indicator.set("10-minute block · working");
    }
  });
  engine.onTick(({ remaining, index }) => {
    ring.setRemaining(remaining);
    totalRemaining.set(totalRemainingSec(phases, index, remaining));
  });
  engine.onDone(async () => {
    skipBtn.classList.add("hidden");
    ring.setPhase("DONE", 0);
    totalRemaining.set(0);
    indicator.set("Exercise complete");

    // The continuous block's set is persisted via onPersist (on End/Start
    // new), so the trend reflects past sessions only at this point — still
    // a useful "you're picking up where you left off" reference.
    trend.populate(await buildTrendData(ex.id));
    endButtons.show();
  });

  root.appendChild(indicator.el);
  root.appendChild(ring.el);
  root.appendChild(totalRemaining.el);
  root.appendChild(h("div", { class: "session-gap" }));
  if (weightFieldEl) root.appendChild(weightFieldEl);
  if (bodyweightBadge) root.appendChild(bodyweightBadge);
  root.appendChild(tapWrap);
  root.appendChild(trend.el);
  root.appendChild(h("div", { class: "session-gap" }));
  root.appendChild(startError.el);
  root.appendChild(startBtn);
  root.appendChild(skipBtn);
  root.appendChild(endButtons.el);

  return () => { engine.stop(); releaseWakeLock(); };
}
