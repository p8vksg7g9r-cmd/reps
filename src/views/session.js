import { getExercise, startSession, endSession, recordSet, updateExercise } from "../db/repo.js";
import { h, eyebrow, stepper, field, fmtKg } from "../ui/components.js";
import {
  makeIntervalEngine, standardPhases, bilateralPhases, continuousPhases,
  renderTimerRing, unlockAudio
} from "../ui/timer.js";
import { makeTapCounter } from "../ui/tap-counter.js";

/**
 * Routes:
 *   /session/new/:exerciseId   → starts a fresh session for an exercise
 *
 * The view manages its own state for the duration of the workout, then
 * persists each set with sessionId via recordSet, and ends the session
 * when finished.
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

/* ---------------------------------------------------------- standard */

function renderStandard({ ex, sessionId, root }) {
  const phases = standardPhases(ex.rounds);
  const ring = renderTimerRing(60);
  const engine = makeIntervalEngine(phases);
  let currentRound = 1;

  const weight = { value: ex.workingWeight || 0 };
  const reps = { value: 8 };

  const weightInput = stepper({ value: weight.value, step: 1, onChange: (n) => weight.value = n });
  const repsInput = stepper({ value: reps.value, step: 1, onChange: (n) => reps.value = n });

  const inputs = h("div", { class: "stack" }, [
    eyebrow(`Round 1 of ${ex.rounds}`),
    field("Weight (kg)", weightInput),
    field("Reps", repsInput)
  ]);
  const inputsLabel = inputs.querySelector(".eyebrow");

  const startBtn = h("button", { class: "btn btn-primary btn-block btn-lg", onclick: () => {
    unlockAudio();
    engine.start();
    startBtn.classList.add("hidden");
    skipBtn.classList.remove("hidden");
  } }, "Start");

  const skipBtn = h("button", { class: "btn btn-ghost btn-block hidden", onclick: () => engine.skip() }, "Skip phase");

  const finishBtn = h("button", { class: "btn btn-primary btn-block btn-lg hidden", onclick: async () => {
    await updateExercise(ex.id, { workingWeight: weight.value });
    await endSession(sessionId);
    location.hash = `#/exercise/${ex.id}`;
  } }, "Finish & save");

  ring.el.addEventListener("click", () => engine.skip());

  engine.onPhase(({ phase }) => {
    ring.setPhase(phase.label, phase.seconds);
    if (phase.kind === "work") {
      currentRound = phase.round;
      inputsLabel.textContent = `Round ${currentRound} of ${ex.rounds}`;
    }
  });
  engine.onTick(({ remaining }) => ring.setRemaining(remaining));
  engine.onPhase(async ({ phase }) => {
    // record the just-completed work set when entering rest, OR keep last work for end.
    // We record on phase change *out of* a work block — easier: record at chime *after* a work phase ends.
  });

  // We record at the end of every WORK phase. We hook into engine by wrapping skip/auto: use phase change
  // to detect leaving a work phase via observing the previous phase index ourselves.
  let lastPhaseIdx = -1;
  engine.onPhase(({ index }) => {
    const prev = lastPhaseIdx;
    lastPhaseIdx = index;
    if (prev >= 0 && phases[prev]?.kind === "work") {
      // previous phase was work → record the set we just finished
      recordSet({
        sessionId,
        exerciseId: ex.id,
        round: phases[prev].round,
        weight: weight.value,
        reps: reps.value,
        setType: "standard"
      });
    }
  });

  engine.onDone(() => {
    // record final work phase (no phase change fires after the last one)
    const last = phases[phases.length - 1];
    if (last?.kind === "work") {
      recordSet({
        sessionId,
        exerciseId: ex.id,
        round: last.round,
        weight: weight.value,
        reps: reps.value,
        setType: "standard"
      });
    }
    skipBtn.classList.add("hidden");
    finishBtn.classList.remove("hidden");
    ring.setPhase("DONE", 0);
  });

  root.appendChild(ring.el);
  root.appendChild(h("div", { style: "height:24px" }));
  root.appendChild(inputs);
  root.appendChild(h("div", { style: "height:24px" }));
  root.appendChild(startBtn);
  root.appendChild(skipBtn);
  root.appendChild(finishBtn);

  return () => engine.stop();
}

/* ---------------------------------------------------------- bilateral */

function renderBilateral({ ex, sessionId, root }) {
  const phases = bilateralPhases(3);
  const ring = renderTimerRing(60);
  const engine = makeIntervalEngine(phases);

  const weight = { value: ex.workingWeight || 0 };
  const reps = { value: 8 };

  const weightInput = stepper({ value: weight.value, step: 0.5, onChange: (n) => weight.value = n });
  const repsInput = stepper({ value: reps.value, step: 1, onChange: (n) => reps.value = n });

  const inputs = h("div", { class: "stack" }, [
    eyebrow("Round 1 of 3 — one rep count per round (assumed equal L/R)"),
    field("Weight per side (kg)", weightInput),
    field("Reps per side", repsInput)
  ]);
  const inputsLabel = inputs.querySelector(".eyebrow");

  const startBtn = h("button", { class: "btn btn-primary btn-block btn-lg", onclick: () => {
    unlockAudio();
    engine.start();
    startBtn.classList.add("hidden");
    skipBtn.classList.remove("hidden");
  } }, "Start");
  const skipBtn = h("button", { class: "btn btn-ghost btn-block hidden", onclick: () => engine.skip() }, "Skip phase");
  const finishBtn = h("button", { class: "btn btn-primary btn-block btn-lg hidden", onclick: async () => {
    await updateExercise(ex.id, { workingWeight: weight.value });
    await endSession(sessionId);
    location.hash = `#/exercise/${ex.id}`;
  } }, "Finish & save");

  ring.el.addEventListener("click", () => engine.skip());

  engine.onPhase(({ phase }) => {
    ring.setPhase(phase.label, phase.seconds);
    if (phase.kind === "work" && phase.side === "L") {
      inputsLabel.textContent = `Round ${phase.round} of 3 — left side`;
    } else if (phase.kind === "work" && phase.side === "R") {
      inputsLabel.textContent = `Round ${phase.round} of 3 — right side`;
    }
  });
  engine.onTick(({ remaining }) => ring.setRemaining(remaining));

  // Record one bilateral set per round, when the second-side work phase ends.
  // (Volume math doubles weight × reps for L+R together — see domain/volume.js.)
  let lastPhaseIdx = -1;
  engine.onPhase(({ index }) => {
    const prev = lastPhaseIdx;
    lastPhaseIdx = index;
    const prevPhase = phases[prev];
    if (prev >= 0 && prevPhase?.kind === "work" && prevPhase?.side === "R") {
      recordSet({
        sessionId,
        exerciseId: ex.id,
        round: prevPhase.round,
        weight: weight.value,
        reps: reps.value,
        setType: "bilateral"
      });
    }
  });

  engine.onDone(() => {
    const last = phases[phases.length - 1];
    if (last?.kind === "work" && last.side === "R") {
      recordSet({
        sessionId,
        exerciseId: ex.id,
        round: last.round,
        weight: weight.value,
        reps: reps.value,
        setType: "bilateral"
      });
    }
    skipBtn.classList.add("hidden");
    finishBtn.classList.remove("hidden");
    ring.setPhase("DONE", 0);
  });

  root.appendChild(ring.el);
  root.appendChild(h("div", { style: "height:24px" }));
  root.appendChild(inputs);
  root.appendChild(h("div", { style: "height:24px" }));
  root.appendChild(startBtn);
  root.appendChild(skipBtn);
  root.appendChild(finishBtn);

  return () => engine.stop();
}

/* ---------------------------------------------------------- continuous */

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
