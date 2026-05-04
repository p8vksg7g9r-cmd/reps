import {
  getExercise, startSession, endSession,
  recordSet, updateSet, setsForSession, lastSessionForExercise, updateExercise
} from "../db/repo.js";
import { h, eyebrow, stepper, field, modal } from "../ui/components.js";
import {
  makeIntervalEngine, standardPhases, bilateralPhases, continuousPhases,
  renderTimerRing, unlockAudio
} from "../ui/timer.js";
import { makeTapCounter } from "../ui/tap-counter.js";

/**
 * Session flow (standard / bilateral):
 *   Pre-Start screen — exercise name, "Set N of N · ready", "Last time avg: X reps",
 *                      weight stepper, Start button. NO reps input visible.
 *   On Start        — startSession() runs; engine starts; timer ring becomes active.
 *   Work phase      — set indicator updates to "Set N of N · working".
 *   Work ends       — stub set written (reps=null) for durability.
 *   Rest phase      — reps prompt slides in; user enters reps for the set just done.
 *   Final set ends  — any rounds still missing reps are gathered into one modal
 *                     before the session is finalized.
 */
export async function SessionView(params, root) {
  const exerciseId = Number(params.exerciseId);
  const ex = await getExercise(exerciseId);
  if (!ex) {
    root.appendChild(h("p", {}, "Exercise not found."));
    return;
  }

  // Compute the previous session's average reps BEFORE creating a new session,
  // so the lookup never returns the in-progress one.
  const lastAvg = await computeLastAvg(exerciseId);

  const head = h("div", { class: "page-head" }, [
    eyebrow(ex.setType === "standard" ? `Standard · ${ex.rounds} rounds`
            : ex.setType === "bilateral" ? "Bilateral · 3 rounds"
            : "Continuous · 10 min"),
    h("h1", { class: "display-l" }, ex.name)
  ]);
  root.appendChild(head);

  if (ex.setType === "standard") return renderStandard({ ex, lastAvg, root });
  if (ex.setType === "bilateral") return renderBilateral({ ex, lastAvg, root });
  if (ex.setType === "continuous") return renderContinuous({ ex, lastAvg, root });
}

/* ----------------------------------------------------- helpers */

/** Average reps across the most recent prior session for an exercise. Null if none. */
async function computeLastAvg(exerciseId) {
  const last = await lastSessionForExercise(exerciseId);
  if (!last) return null;
  const sets = await setsForSession(last.id);
  const valid = sets.filter((s) => s.reps != null && s.reps > 0).map((s) => s.reps);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

/** Set-indicator card with eyebrow status + last-time reference. Mutable in place. */
function makeSetIndicator(initialEyebrow, lastAvg) {
  const eb = eyebrow(initialEyebrow);
  const sub = lastAvg != null
    ? h("div", { class: "mono", style: "font-size:13px; color: var(--ink-mute); margin-top:4px" },
        `Last time avg: ${lastAvg} reps`)
    : null;
  const card = h("div", { class: "card stack-sm" }, [eb, sub].filter(Boolean));
  return {
    el: card,
    set(text) { eb.textContent = text; }
  };
}

/** Reps prompt panel — hidden until showPrompt() is called, then either prompt or saved-state. */
function makeRepsPanel({ setType }) {
  const root = h("div", { class: "hidden" });

  function clear() {
    root.classList.add("hidden");
    root.innerHTML = "";
  }

  function showPrompt({ round, hint, defaultReps, onSave }) {
    root.classList.remove("hidden");
    root.innerHTML = "";
    let value = defaultReps;
    const stp = stepper({ value, step: 1, onChange: (n) => { value = n; } });
    const label = setType === "bilateral" ? `Round ${round} — reps per side` : `Set ${round} — reps`;
    root.appendChild(h("div", { class: "card stack-sm" }, [
      eyebrow(hint),
      field(label, stp),
      h("button", { class: "btn btn-primary btn-block", onclick: async () => {
        await onSave(value);
        showSaved({ round, reps: value });
      } }, `Save set ${round}`)
    ]));
  }

  function showSaved({ round, reps }) {
    root.classList.remove("hidden");
    root.innerHTML = "";
    root.appendChild(h("div", { class: "card card-tight body-s row-between" }, [
      h("span", {}, `Set ${round} saved`),
      h("span", { class: "mono" }, `${reps} reps`)
    ]));
  }

  function showText(text) {
    root.classList.remove("hidden");
    root.innerHTML = "";
    root.appendChild(h("div", { class: "card card-tight body-s", style: "color: var(--ink-mute); text-align:center" }, text));
  }

  return { el: root, clear, showPrompt, showSaved, showText };
}

function promptMissingReps(missing, { setType, lastAvg }) {
  const fallback = lastAvg ?? 8;
  return new Promise((resolve) => {
    const refs = missing.map((s) => ({ setId: s.id, round: s.round, value: fallback }));
    const fields = refs.map((r) => {
      const stp = stepper({ value: r.value, step: 1, onChange: (n) => { r.value = n; } });
      const lbl = setType === "bilateral" ? `Round ${r.round} reps per side` : `Set ${r.round} reps`;
      return field(lbl, stp);
    });
    const m = modal([
      eyebrow("Before we save"),
      h("h2", { class: "display-m" }, missing.length === 1 ? "1 set needs reps" : `${missing.length} sets need reps`),
      h("p", { class: "body-s", style: "color: var(--ink-mute)" }, "Fill these in and we'll wrap up the session."),
      ...fields,
      h("button", { class: "btn btn-primary btn-block btn-lg", onclick: async () => {
        for (const r of refs) await updateSet(r.setId, { reps: r.value });
        m.close();
        resolve();
      } }, "Save all & finish")
    ]);
  });
}

/* ----------------------------------------------------- standard */

function renderStandard({ ex, lastAvg, root }) {
  const phases = standardPhases(ex.rounds);
  const ring = renderTimerRing(60);
  ring.setPhase("READY", 60);
  const engine = makeIntervalEngine(phases);

  let sessionId = null;
  const weight = { value: ex.workingWeight || 0 };
  const setIds = new Map();

  const indicator = makeSetIndicator(`Set 1 of ${ex.rounds} · ready`, lastAvg);
  const weightInput = stepper({ value: weight.value, step: 1, onChange: (n) => weight.value = n });
  const repsPanel = makeRepsPanel({ setType: "standard" });

  const startBtn = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Start");
  const skipBtn = h("button", { class: "btn btn-ghost btn-block hidden", onclick: () => engine.skip() }, "Skip phase");
  const finishBtn = h("button", { class: "btn btn-primary btn-block btn-lg hidden", onclick: async () => {
    await updateExercise(ex.id, { workingWeight: weight.value });
    await endSession(sessionId);
    location.hash = `#/exercise/${ex.id}`;
  } }, "Finish & save");

  startBtn.addEventListener("click", async () => {
    sessionId = await startSession(ex.id);
    unlockAudio();
    engine.start();
    startBtn.classList.add("hidden");
    skipBtn.classList.remove("hidden");
  });
  ring.el.addEventListener("click", () => engine.skip());

  let lastPhaseIdx = -1;

  engine.onPhase(async ({ phase, index }) => {
    ring.setPhase(phase.label, phase.seconds);
    const prev = lastPhaseIdx;
    lastPhaseIdx = index;
    const prevPhase = phases[prev];

    if (prev >= 0 && prevPhase?.kind === "work") {
      const round = prevPhase.round;
      const setId = await recordSet({
        sessionId,
        exerciseId: ex.id,
        round,
        weight: weight.value,
        reps: null,
        setType: "standard"
      });
      setIds.set(round, setId);

      if (phase.kind === "rest") {
        indicator.set(`Set ${round} done · Set ${round + 1} of ${ex.rounds} next`);
        repsPanel.showPrompt({
          round,
          hint: `Set ${round} done — log the reps`,
          defaultReps: lastAvg ?? 8,
          onSave: async (reps) => updateSet(setId, { reps })
        });
      }
    } else if (phase.kind === "work") {
      indicator.set(`Set ${phase.round} of ${ex.rounds} · working`);
      repsPanel.clear();
    }
  });

  engine.onTick(({ remaining }) => ring.setRemaining(remaining));

  engine.onDone(async () => {
    const last = phases[phases.length - 1];
    if (last?.kind === "work") {
      const round = last.round;
      const setId = await recordSet({
        sessionId,
        exerciseId: ex.id,
        round,
        weight: weight.value,
        reps: null,
        setType: "standard"
      });
      setIds.set(round, setId);
    }
    skipBtn.classList.add("hidden");
    ring.setPhase("DONE", 0);
    indicator.set("Workout complete");

    const all = await setsForSession(sessionId);
    const missing = all.filter((s) => s.reps == null).sort((a, b) => a.round - b.round);
    if (missing.length > 0) {
      await promptMissingReps(missing, { setType: "standard", lastAvg });
    }
    repsPanel.showText("All sets logged. Finish to save.");
    finishBtn.classList.remove("hidden");
  });

  root.appendChild(indicator.el);
  root.appendChild(ring.el);
  root.appendChild(h("div", { style: "height:24px" }));
  root.appendChild(field("Weight (kg)", weightInput));
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(repsPanel.el);
  root.appendChild(h("div", { style: "height:24px" }));
  root.appendChild(startBtn);
  root.appendChild(skipBtn);
  root.appendChild(finishBtn);

  return () => engine.stop();
}

/* ----------------------------------------------------- bilateral */

function renderBilateral({ ex, lastAvg, root }) {
  const phases = bilateralPhases(3);
  const ring = renderTimerRing(60);
  ring.setPhase("READY", 60);
  const engine = makeIntervalEngine(phases);

  let sessionId = null;
  const weight = { value: ex.workingWeight || 0 };
  const setIds = new Map();

  const indicator = makeSetIndicator("Round 1 of 3 · ready", lastAvg);
  const weightInput = stepper({ value: weight.value, step: 0.5, onChange: (n) => weight.value = n });
  const repsPanel = makeRepsPanel({ setType: "bilateral" });

  const startBtn = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Start");
  const skipBtn = h("button", { class: "btn btn-ghost btn-block hidden", onclick: () => engine.skip() }, "Skip phase");
  const finishBtn = h("button", { class: "btn btn-primary btn-block btn-lg hidden", onclick: async () => {
    await updateExercise(ex.id, { workingWeight: weight.value });
    await endSession(sessionId);
    location.hash = `#/exercise/${ex.id}`;
  } }, "Finish & save");

  startBtn.addEventListener("click", async () => {
    sessionId = await startSession(ex.id);
    unlockAudio();
    engine.start();
    startBtn.classList.add("hidden");
    skipBtn.classList.remove("hidden");
  });
  ring.el.addEventListener("click", () => engine.skip());

  let lastPhaseIdx = -1;

  engine.onPhase(async ({ phase, index }) => {
    ring.setPhase(phase.label, phase.seconds);
    const prev = lastPhaseIdx;
    lastPhaseIdx = index;
    const prevPhase = phases[prev];

    if (prev >= 0 && prevPhase?.kind === "work" && prevPhase?.side === "R") {
      const round = prevPhase.round;
      const setId = await recordSet({
        sessionId,
        exerciseId: ex.id,
        round,
        weight: weight.value,
        reps: null,
        setType: "bilateral"
      });
      setIds.set(round, setId);
      if (phase.kind === "rest") {
        indicator.set(`Round ${round} done · Round ${round + 1} of 3 next`);
        repsPanel.showPrompt({
          round,
          hint: `Round ${round} done — log reps per side`,
          defaultReps: lastAvg ?? 8,
          onSave: async (reps) => updateSet(setId, { reps })
        });
      }
    } else if (phase.kind === "work") {
      const sideText = phase.side === "L" ? "left" : "right";
      indicator.set(`Round ${phase.round} of 3 · ${sideText}`);
      if (phase.side === "L") repsPanel.clear();
    }
  });

  engine.onTick(({ remaining }) => ring.setRemaining(remaining));

  engine.onDone(async () => {
    const last = phases[phases.length - 1];
    if (last?.kind === "work" && last.side === "R") {
      const round = last.round;
      const setId = await recordSet({
        sessionId,
        exerciseId: ex.id,
        round,
        weight: weight.value,
        reps: null,
        setType: "bilateral"
      });
      setIds.set(round, setId);
    }
    skipBtn.classList.add("hidden");
    ring.setPhase("DONE", 0);
    indicator.set("Workout complete");

    const all = await setsForSession(sessionId);
    const missing = all.filter((s) => s.reps == null).sort((a, b) => a.round - b.round);
    if (missing.length > 0) {
      await promptMissingReps(missing, { setType: "bilateral", lastAvg });
    }
    repsPanel.showText("All rounds logged. Finish to save.");
    finishBtn.classList.remove("hidden");
  });

  root.appendChild(indicator.el);
  root.appendChild(ring.el);
  root.appendChild(h("div", { style: "height:24px" }));
  root.appendChild(field("Weight per side (kg)", weightInput));
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(repsPanel.el);
  root.appendChild(h("div", { style: "height:24px" }));
  root.appendChild(startBtn);
  root.appendChild(skipBtn);
  root.appendChild(finishBtn);

  return () => engine.stop();
}

/* ----------------------------------------------------- continuous */
// Continuous has no rest period to insert a per-set prompt into. The tap counter
// IS the rep recorder, so it stays — but it's hidden until Start is pressed,
// keeping the pre-set screen free of any rep UI.

function renderContinuous({ ex, lastAvg, root }) {
  const phases = continuousPhases();
  const ring = renderTimerRing(600);
  ring.setPhase("READY", 600);
  const engine = makeIntervalEngine(phases);

  let sessionId = null;
  const weight = { value: ex.workingWeight || 0 };
  const tap = makeTapCounter();
  const tapWrap = h("div", { class: "hidden" }, [tap.el, h("p", { class: "tap-hint" }, "Tap to count · long-press to undo")]);

  const indicator = makeSetIndicator("10-minute block · ready", lastAvg);
  const weightInput = stepper({ value: weight.value, step: 0.5, onChange: (n) => weight.value = n });

  const startBtn = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Start");
  const skipBtn = h("button", { class: "btn btn-ghost btn-block hidden", onclick: () => engine.skip() }, "End early");
  const finishBtn = h("button", { class: "btn btn-primary btn-block btn-lg hidden", onclick: async () => {
    if (!sessionId) return;
    await recordSet({
      sessionId,
      exerciseId: ex.id,
      round: 1,
      weight: weight.value,
      reps: tap.count,
      setType: "continuous"
    });
    await updateExercise(ex.id, { workingWeight: weight.value });
    await endSession(sessionId);
    location.hash = `#/exercise/${ex.id}`;
  } }, "Finish & save");

  startBtn.addEventListener("click", async () => {
    sessionId = await startSession(ex.id);
    unlockAudio();
    engine.start();
    startBtn.classList.add("hidden");
    skipBtn.classList.remove("hidden");
    tapWrap.classList.remove("hidden");
    indicator.set("10-minute block · working");
  });

  engine.onPhase(({ phase }) => ring.setPhase(phase.label, phase.seconds));
  engine.onTick(({ remaining }) => ring.setRemaining(remaining));
  engine.onDone(() => {
    skipBtn.classList.add("hidden");
    finishBtn.classList.remove("hidden");
    ring.setPhase("DONE", 0);
    indicator.set("Block complete");
  });

  root.appendChild(indicator.el);
  root.appendChild(ring.el);
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(field("Weight (kg)", weightInput));
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(tapWrap);
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(startBtn);
  root.appendChild(skipBtn);
  root.appendChild(finishBtn);

  return () => engine.stop();
}
