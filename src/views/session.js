import {
  getExercise, startSession, endSession,
  recordSet, updateSet, setsForSession, updateExercise
} from "../db/repo.js";
import { h, eyebrow, stepper, field, modal } from "../ui/components.js";
import {
  makeIntervalEngine, standardPhases, bilateralPhases, continuousPhases,
  renderTimerRing, unlockAudio
} from "../ui/timer.js";
import { makeTapCounter } from "../ui/tap-counter.js";

/**
 * Routes:
 *   /session/new/:exerciseId
 *
 * Flow (standard / bilateral):
 *   work phase ends → stub set written with reps=null  → rest begins →
 *   reps prompt appears → user enters reps → stub updated → next work begins.
 * After the final work, any sets still missing reps trigger a single modal
 * to fill them in before the session is finalized.
 */
export async function SessionView(params, root) {
  const exerciseId = Number(params.exerciseId);
  const ex = await getExercise(exerciseId);
  if (!ex) {
    root.appendChild(h("p", {}, "Exercise not found."));
    return;
  }

  const sessionId = await startSession(exerciseId);

  const head = h("div", { class: "page-head" }, [
    eyebrow(ex.setType === "standard" ? `Standard · ${ex.rounds} rounds`
            : ex.setType === "bilateral" ? "Bilateral · 3 rounds"
            : "Continuous · 10 min"),
    h("h1", { class: "display-l" }, ex.name)
  ]);
  root.appendChild(head);

  if (ex.setType === "standard") return renderStandard({ ex, sessionId, root });
  if (ex.setType === "bilateral") return renderBilateral({ ex, sessionId, root });
  if (ex.setType === "continuous") return renderContinuous({ ex, sessionId, root });
}

/* ----------------------------------------------------- shared helpers */

/** A persistent reps prompt panel that swaps between "enter" and "saved" states. */
function makeRepsPanel({ defaultReps = 8, setType }) {
  const root = h("div", { class: "stack" });
  let currentRound = null;
  let currentSetId = null;
  let onSave = null;

  function clear() {
    root.innerHTML = "";
    currentRound = null;
    currentSetId = null;
    onSave = null;
  }

  function showPrompt({ round, setId, hint, onSave: cb }) {
    currentRound = round;
    currentSetId = setId;
    onSave = cb;
    root.innerHTML = "";
    let value = defaultReps;
    const stp = stepper({ value, step: 1, onChange: (n) => { value = n; } });
    const label = setType === "bilateral" ? `Round ${round} — reps per side` : `Round ${round} — reps`;
    root.appendChild(h("div", { class: "card stack-sm" }, [
      eyebrow(hint || "How many reps did you complete?"),
      field(label, stp),
      h("button", { class: "btn btn-primary btn-block", onclick: async () => {
        await cb(value);
        showSaved({ round, reps: value });
      } }, `Save round ${round}`)
    ]));
  }

  function showSaved({ round, reps }) {
    root.innerHTML = "";
    root.appendChild(h("div", { class: "card card-tight body-s row-between" }, [
      h("span", {}, `Round ${round} saved`),
      h("span", { class: "mono" }, `${reps} reps`)
    ]));
  }

  function showIdle(text) {
    root.innerHTML = "";
    root.appendChild(h("div", { class: "card card-tight body-s", style: "color: var(--ink-mute); text-align:center" }, text));
  }

  return { el: root, clear, showPrompt, showSaved, showIdle, get currentRound() { return currentRound; }, get currentSetId() { return currentSetId; } };
}

/** Modal that prompts for reps for any rounds still missing them. */
function promptMissingReps(missing, { setType }) {
  return new Promise((resolve) => {
    const refs = missing.map((s) => ({ setId: s.id, round: s.round, value: 8 }));
    const fields = refs.map((r) => {
      const stp = stepper({ value: r.value, step: 1, onChange: (n) => { r.value = n; } });
      const lbl = setType === "bilateral" ? `Round ${r.round} reps per side` : `Round ${r.round} reps`;
      return field(lbl, stp);
    });
    const m = modal([
      eyebrow("Before we save"),
      h("h2", { class: "display-m" }, missing.length === 1 ? "1 round needs reps" : `${missing.length} rounds need reps`),
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

function renderStandard({ ex, sessionId, root }) {
  const phases = standardPhases(ex.rounds);
  const ring = renderTimerRing(60);
  const engine = makeIntervalEngine(phases);

  const weight = { value: ex.workingWeight || 0 };
  const setIds = new Map(); // round → setId

  const weightInput = stepper({ value: weight.value, step: 1, onChange: (n) => weight.value = n });
  const repsPanel = makeRepsPanel({ defaultReps: 8, setType: "standard" });
  repsPanel.showIdle("Reps prompt appears between sets.");

  const startBtn = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Start");
  const skipBtn = h("button", { class: "btn btn-ghost btn-block hidden", onclick: () => engine.skip() }, "Skip phase");
  const finishBtn = h("button", { class: "btn btn-primary btn-block btn-lg hidden", onclick: async () => {
    await updateExercise(ex.id, { workingWeight: weight.value });
    await endSession(sessionId);
    location.hash = `#/exercise/${ex.id}`;
  } }, "Finish & save");

  startBtn.addEventListener("click", () => {
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
      // Just finished a work phase — write a stub for that round.
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

      // If we're now in rest, surface the reps prompt for the round we just finished.
      if (phase.kind === "rest") {
        repsPanel.showPrompt({
          round,
          setId,
          hint: `Round ${round} done — log the reps`,
          onSave: async (reps) => updateSet(setId, { reps })
        });
      }
    } else if (phase.kind === "work") {
      // Starting a new work phase. If a previous prompt is still open and the user
      // didn't save it, we leave its data as null — the missing-reps modal will catch it.
      repsPanel.showIdle(`Round ${phase.round} in progress…`);
    }
  });

  engine.onTick(({ remaining }) => ring.setRemaining(remaining));

  engine.onDone(async () => {
    // Final work phase has no following phase, so write its stub here.
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

    const all = await setsForSession(sessionId);
    const missing = all.filter((s) => s.reps == null).sort((a, b) => a.round - b.round);
    if (missing.length > 0) {
      await promptMissingReps(missing, { setType: "standard" });
    }
    repsPanel.showIdle("All sets logged. Finish to save.");
    finishBtn.classList.remove("hidden");
  });

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

function renderBilateral({ ex, sessionId, root }) {
  const phases = bilateralPhases(3);
  const ring = renderTimerRing(60);
  const engine = makeIntervalEngine(phases);

  const weight = { value: ex.workingWeight || 0 };
  const setIds = new Map();

  const weightInput = stepper({ value: weight.value, step: 0.5, onChange: (n) => weight.value = n });
  const repsPanel = makeRepsPanel({ defaultReps: 8, setType: "bilateral" });
  repsPanel.showIdle("Reps prompt appears after each round.");

  const startBtn = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Start");
  const skipBtn = h("button", { class: "btn btn-ghost btn-block hidden", onclick: () => engine.skip() }, "Skip phase");
  const finishBtn = h("button", { class: "btn btn-primary btn-block btn-lg hidden", onclick: async () => {
    await updateExercise(ex.id, { workingWeight: weight.value });
    await endSession(sessionId);
    location.hash = `#/exercise/${ex.id}`;
  } }, "Finish & save");

  startBtn.addEventListener("click", () => {
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

    // A bilateral round is "complete" when the R-side work phase ends. Write the
    // stub then — one set per round, mirroring the standard handler.
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
        repsPanel.showPrompt({
          round,
          setId,
          hint: `Round ${round} done — log reps per side`,
          onSave: async (reps) => updateSet(setId, { reps })
        });
      }
    } else if (phase.kind === "work" && phase.side === "L") {
      repsPanel.showIdle(`Round ${phase.round} in progress…`);
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

    const all = await setsForSession(sessionId);
    const missing = all.filter((s) => s.reps == null).sort((a, b) => a.round - b.round);
    if (missing.length > 0) {
      await promptMissingReps(missing, { setType: "bilateral" });
    }
    repsPanel.showIdle("All rounds logged. Finish to save.");
    finishBtn.classList.remove("hidden");
  });

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
// Continuous is a single 10-min block with live tap counting — there is no
// rest period to insert a rep prompt into, so the original flow is preserved:
// the user taps reps live, then hits Finish to save the single set.

function renderContinuous({ ex, sessionId, root }) {
  const phases = continuousPhases();
  const ring = renderTimerRing(600);
  const engine = makeIntervalEngine(phases);

  const weight = { value: ex.workingWeight || 0 };
  const tap = makeTapCounter();

  const weightInput = stepper({ value: weight.value, step: 0.5, onChange: (n) => weight.value = n });

  const startBtn = h("button", { class: "btn btn-primary btn-block btn-lg", onclick: () => {
    unlockAudio();
    engine.start();
    startBtn.classList.add("hidden");
    skipBtn.classList.remove("hidden");
  } }, "Start");
  const skipBtn = h("button", { class: "btn btn-ghost btn-block hidden", onclick: () => engine.skip() }, "End early");
  const finishBtn = h("button", { class: "btn btn-primary btn-block btn-lg hidden", onclick: async () => {
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

  engine.onPhase(({ phase }) => ring.setPhase(phase.label, phase.seconds));
  engine.onTick(({ remaining }) => ring.setRemaining(remaining));
  engine.onDone(() => {
    skipBtn.classList.add("hidden");
    finishBtn.classList.remove("hidden");
    ring.setPhase("DONE", 0);
  });

  root.appendChild(ring.el);
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(field("Weight (kg)", weightInput));
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(tap.el);
  root.appendChild(h("p", { class: "tap-hint" }, "Tap to count · long-press to undo"));
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(startBtn);
  root.appendChild(skipBtn);
  root.appendChild(finishBtn);

  return () => engine.stop();
}
