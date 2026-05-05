import {
  getExercise, getOpenSession, getOrCreateOpenSession, endSession,
  recordSet, updateSet, setsForSession, lastSessionForExercise, updateExercise
} from "../db/repo.js";
import { h, eyebrow, stepper, field, modal, setTypeStructure } from "../ui/components.js";
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

  // The "last time avg" reference looks at the previous session containing this
  // exercise — explicitly excluding the currently open session, which may
  // already have prior sets for this same exercise.
  const openSess = await getOpenSession();
  const lastAvg = await computeLastAvg(exerciseId, openSess?.id);

  const head = h("div", { class: "page-head" }, [
    eyebrow(setTypeStructure(ex)),
    h("h1", { class: "display-l" }, ex.name)
  ]);
  root.appendChild(head);

  // Bilateral and continuous have bespoke renderers (L/R alternation; tap counter).
  // Everything else routes through the standard work/rest renderer with custom phases.
  if (ex.setType === "bilateral") return renderBilateral({ ex, lastAvg, root });
  if (ex.setType === "continuous") return renderContinuous({ ex, lastAvg, root });
  return renderStandard({ ex, lastAvg, root });
}

/* ----------------------------------------------------- helpers */

async function computeLastAvg(exerciseId, openSessionId) {
  const last = await lastSessionForExercise(exerciseId, { excludeSessionId: openSessionId });
  if (!last) return null;
  // The session may contain other exercises too — only this exercise's sets count.
  const sets = (await setsForSession(last.id)).filter((s) => s.exerciseId === exerciseId);
  const valid = sets.filter((s) => s.reps != null && s.reps > 0).map((s) => s.reps);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

function makeSetIndicator(initialEyebrow, lastAvg) {
  const eb = eyebrow(initialEyebrow);
  const sub = lastAvg != null
    ? h("div", { class: "mono", style: "font-size:13px; color: var(--ink-mute); margin-top:4px" },
        `Last time avg: ${lastAvg} reps`)
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

/** Lock a stepper element + tag its field label so it's unmistakably read-only. */
function lockStepper(stepperEl) {
  if (!stepperEl) return;
  stepperEl.classList.add("locked");
  stepperEl.querySelectorAll("button").forEach((b) => { b.disabled = true; b.tabIndex = -1; });
  const input = stepperEl.querySelector("input");
  if (input) { input.disabled = true; input.tabIndex = -1; input.setAttribute("aria-readonly", "true"); }
}

function lockField(fieldEl, stepperEl) {
  lockStepper(stepperEl);
  const labelEl = fieldEl?.querySelector(".label");
  if (labelEl && !labelEl.querySelector(".lock-tag")) {
    const tag = h("span", { class: "lock-tag" }, "LOCKED");
    labelEl.appendChild(tag);
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
  const inputEl = stepperEl?.querySelector("input");
  if (inputEl && inputEl.value !== "") {
    const parsed = Number(inputEl.value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return stateRef.value;
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
    location.hash = "#/exercises";
  });
  endSess.addEventListener("click", async () => {
    await onPersist?.();
    const sid = getSessionId();
    if (sid != null) await endSession(sid);
    releaseWakeLock();
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

/* ----------------------------------------------------- standard */

function renderStandard({ ex, lastAvg, root }) {
  const phases = phasesFor(ex);
  const totalSets = phases.filter((p) => p.kind === "work").length;
  const firstSec = phases[0]?.seconds || 60;
  const ring = renderTimerRing(firstSec);
  ring.setPhase("READY", firstSec);
  const engine = makeIntervalEngine(phases);
  const totalInitial = phases.reduce((sum, p) => sum + p.seconds, 0);
  const totalRemaining = makeTotalRemaining(totalInitial);

  let sessionId = null;
  const weight = { value: ex.bodyweight ? 0 : null };  // blank — user enters from scratch
  const setIds = new Map();

  const indicator = makeSetIndicator(`Set 1 of ${totalSets} · ready`, lastAvg);
  const weightStepper = ex.bodyweight ? null : stepper({
    value: "",                                       // empty by default
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
      setIds.set(round, setId);

      if (phase.kind === "rest") {
        indicator.set(`Set ${round} done · Set ${round + 1} of ${totalSets} next`);
        repsPanel.showPrompt({
          round,
          hint: `Set ${round} done — log the reps`,
          onSave: async (reps) => {
            await updateSet(setId, { reps });
            completed.upsert(round, reps);
          }
        });
      }
    } else if (phase.kind === "work") {
      indicator.set(`Set ${phase.round} of ${totalSets} · working`);
      repsPanel.clear();
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
      setIds.set(round, setId);
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
    endButtons.show();
  });

  root.appendChild(indicator.el);
  root.appendChild(ring.el);
  root.appendChild(totalRemaining.el);
  root.appendChild(h("div", { style: "height:8px" }));
  root.appendChild(completed.el);
  root.appendChild(h("div", { style: "height:16px" }));
  if (weightFieldEl) root.appendChild(weightFieldEl);
  if (bodyweightBadge) root.appendChild(bodyweightBadge);
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(repsPanel.el);
  root.appendChild(h("div", { style: "height:24px" }));
  root.appendChild(startError.el);
  root.appendChild(startBtn);
  root.appendChild(skipBtn);
  root.appendChild(endButtons.el);

  return () => { engine.stop(); releaseWakeLock(); };
}

/* ----------------------------------------------------- bilateral */

function renderBilateral({ ex, lastAvg, root }) {
  const phases = bilateralPhases(3);
  const firstSec = phases[0]?.seconds || 60;
  const ring = renderTimerRing(firstSec);
  ring.setPhase("READY", firstSec);
  const engine = makeIntervalEngine(phases);
  const totalInitial = phases.reduce((sum, p) => sum + p.seconds, 0);
  const totalRemaining = makeTotalRemaining(totalInitial);

  let sessionId = null;
  const weight = { value: ex.bodyweight ? 0 : null };
  const setIds = new Map();

  const indicator = makeSetIndicator("Round 1 of 3 · ready", lastAvg);
  const weightStepper = ex.bodyweight ? null : stepper({
    value: "",
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
      setIds.set(round, setId);
      if (phase.kind === "rest") {
        indicator.set(`Round ${round} done · Round ${round + 1} of 3 next`);
        repsPanel.showPrompt({
          round,
          hint: `Round ${round} done — log reps per side`,
          onSave: async (reps) => {
            await updateSet(setId, { reps });
            completed.upsert(round, reps);
          }
        });
      }
    } else if (phase.kind === "work") {
      const sideText = phase.side === "L" ? "left" : "right";
      indicator.set(`Round ${phase.round} of 3 · ${sideText}`);
      if (phase.side === "L") repsPanel.clear();
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
      setIds.set(round, setId);
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
    endButtons.show();
  });

  root.appendChild(indicator.el);
  root.appendChild(ring.el);
  root.appendChild(totalRemaining.el);
  root.appendChild(h("div", { style: "height:8px" }));
  root.appendChild(completed.el);
  root.appendChild(h("div", { style: "height:16px" }));
  if (weightFieldEl) root.appendChild(weightFieldEl);
  if (bodyweightBadge) root.appendChild(bodyweightBadge);
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(repsPanel.el);
  root.appendChild(h("div", { style: "height:24px" }));
  root.appendChild(startError.el);
  root.appendChild(startBtn);
  root.appendChild(skipBtn);
  root.appendChild(endButtons.el);

  return () => { engine.stop(); releaseWakeLock(); };
}

/* ----------------------------------------------------- continuous */

function renderContinuous({ ex, lastAvg, root }) {
  const phases = continuousPhases();
  const firstSec = phases[0]?.seconds || 60;
  const ring = renderTimerRing(firstSec);
  ring.setPhase("READY", firstSec);
  const engine = makeIntervalEngine(phases);
  const totalInitial = phases.reduce((sum, p) => sum + p.seconds, 0);
  const totalRemaining = makeTotalRemaining(totalInitial);

  let sessionId = null;
  const weight = { value: ex.bodyweight ? 0 : null };
  const tap = makeTapCounter();
  const tapWrap = h("div", { class: "hidden" }, [tap.el, h("p", { class: "tap-hint" }, "Tap to count · long-press to undo")]);

  const indicator = makeSetIndicator("10-minute block · ready", lastAvg);
  const weightStepper = ex.bodyweight ? null : stepper({
    value: "",
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
  engine.onDone(() => {
    skipBtn.classList.add("hidden");
    endButtons.show();
    ring.setPhase("DONE", 0);
    totalRemaining.set(0);
    indicator.set("Exercise complete");
  });

  root.appendChild(indicator.el);
  root.appendChild(ring.el);
  root.appendChild(totalRemaining.el);
  root.appendChild(h("div", { style: "height:8px" }));
  if (weightFieldEl) root.appendChild(weightFieldEl);
  if (bodyweightBadge) root.appendChild(bodyweightBadge);
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(tapWrap);
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(startError.el);
  root.appendChild(startBtn);
  root.appendChild(skipBtn);
  root.appendChild(endButtons.el);

  return () => { engine.stop(); releaseWakeLock(); };
}
