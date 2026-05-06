import {
  getExercise, getOrCreateOpenSession, recordSet, updateExercise
} from "../db/repo.js";
import { h, eyebrow, stepper, field, badge, readStepperNumber } from "../ui/components.js";

/**
 * /quicklog/:exerciseId — manual entry without the timer.
 *
 * Three modes:
 *   strength        weight + N rows of reps. Add Set appends rows.
 *   cardio_swim     distance (m) + time (mm:ss).  One row per session.
 *   cardio_bike     time (min) + MET-min + watts + bpm. One row, all but
 *                   time are optional.
 *
 * Cardio sets carry a `metrics` object on the set row. They store reps=1
 * (so they pass the reps != null "completed" filter used in history) and
 * weight=0; volume math returns 0 for cardio set types so they don't
 * affect training-load calculations.
 */
export async function QuickLogView(params, root) {
  const exerciseId = Number(params.exerciseId);
  const ex = await getExercise(exerciseId);
  if (!ex) {
    root.appendChild(h("p", {}, "Exercise not found."));
    return;
  }

  if (ex.setType === "cardio_swim") return renderSwim({ ex, root });
  if (ex.setType === "cardio_bike") return renderBike({ ex, root });
  if (ex.setType === "no_timer")    return renderNoTimer({ ex, root });
  return renderStrength({ ex, root });
}

/* --------------------------- shared helpers --------------------------- */

function pageHead(eyebrowText, title) {
  return h("div", { class: "page-head" }, [
    h("a", { href: "#/exercises", class: "eyebrow" }, "← Cancel"),
    eyebrow(eyebrowText),
    h("h1", { class: "display-l" }, title)
  ]);
}

function makeError() {
  const el = h("p", {
    class: "body-s hidden",
    style: "color: var(--terracotta); margin: 0 0 8px; text-align:center; font-weight:600"
  }, "");
  return {
    el,
    show(text) { el.textContent = text; el.classList.remove("hidden"); },
    hide()     { el.classList.add("hidden"); }
  };
}

const readNumber = readStepperNumber;

/* ============================== STRENGTH ============================== */

function renderStrength({ ex, root }) {
  const isBilateral = ex.setType === "bilateral";
  root.appendChild(pageHead("Quick log · no timer", ex.name));

  const initialWeight = ex.bodyweight ? 0 : (ex.workingWeight > 0 ? ex.workingWeight : null);
  const weight = { value: initialWeight };
  const weightStepper = ex.bodyweight ? null : stepper({
    value: initialWeight != null ? String(initialWeight) : "",
    step: 0.5,
    placeholder: "—",
    onChange: (n) => { weight.value = n; }
  });
  const weightFieldEl = ex.bodyweight
    ? h("div", { class: "card card-tight body-s row", style: "justify-content:center; gap:8px" }, [
        badge("Bodyweight", "badge-brass"),
        h("span", { style: "color: var(--ink-mute)" }, "no external load")
      ])
    : field(isBilateral ? "Weight per side (kg)" : "Weight (kg)", weightStepper);

  const setRows = [];
  const setsContainer = h("div", { class: "stack-sm" });

  function repsLabel(round) {
    return isBilateral ? `Set ${round} — reps per side` : `Set ${round} — reps`;
  }
  function addRow() {
    const round = setRows.length + 1;
    const repsRef = { value: null };
    const stp = stepper({ value: "", step: 1, placeholder: "—", onChange: (n) => { repsRef.value = n; } });
    setRows.push({ round, repsRef, stepperEl: stp });
    setsContainer.appendChild(field(repsLabel(round), stp));
  }
  addRow();

  const addBtn = h("button", { class: "btn btn-ghost btn-block", onclick: addRow }, "+ Add set");
  const error = makeError();
  const saveBtn = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Save exercise");
  const cancelBtn = h("a", { class: "btn btn-ghost btn-block", href: "#/exercises" }, "Cancel");

  saveBtn.addEventListener("click", async () => {
    if (!ex.bodyweight) {
      const w = readNumber(weightStepper);
      if (w == null || !(w > 0)) { error.show("Enter a weight before saving."); return; }
      weight.value = w;
    }
    const valid = [];
    for (const row of setRows) {
      const v = readNumber(row.stepperEl);
      if (v == null || v < 1) { error.show(`Set ${row.round}: enter at least 1 rep.`); return; }
      valid.push({ round: row.round, reps: v });
    }
    error.hide();

    const open = await getOrCreateOpenSession();
    for (const v of valid) {
      await recordSet({
        sessionId: open.id, exerciseId: ex.id, round: v.round,
        weight: weight.value, reps: v.reps, setType: ex.setType
      });
    }
    if (!ex.bodyweight) await updateExercise(ex.id, { workingWeight: weight.value });
    location.hash = "#/exercises";
  });

  root.appendChild(weightFieldEl);
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(eyebrow("Sets"));
  root.appendChild(h("div", { style: "height:8px" }));
  root.appendChild(setsContainer);
  root.appendChild(h("div", { style: "height:8px" }));
  root.appendChild(addBtn);
  root.appendChild(h("div", { style: "height:24px" }));
  root.appendChild(error.el);
  root.appendChild(h("div", { class: "stack-sm" }, [saveBtn, cancelBtn]));
}

/* ============================== NO TIMER ==========================
 * Per-set weight + reps. Each Add Set appends a fresh row. The first row's
 * weight is pre-populated from the exercise's stored workingWeight (if any),
 * but every row is independently editable, so the user can stagger weights
 * across sets. Bodyweight exercises hide the per-set weight stepper. */

function renderNoTimer({ ex, root }) {
  root.appendChild(pageHead("No Timer · per-set entry", ex.name));

  if (ex.bodyweight) {
    root.appendChild(h("div", { class: "card card-tight body-s row", style: "justify-content:center; gap:8px" }, [
      badge("Bodyweight", "badge-brass"),
      h("span", { style: "color: var(--ink-mute)" }, "no external load")
    ]));
    root.appendChild(h("div", { style: "height:16px" }));
  }

  const setsContainer = h("div", { class: "stack" });
  const rows = [];

  function addRow() {
    const round = rows.length + 1;
    // Pre-populate the first row's weight from the exercise's last working
    // weight; subsequent rows start blank so the user can taper or push.
    const initialWeight = ex.bodyweight
      ? 0
      : (round === 1 && ex.workingWeight > 0 ? ex.workingWeight : null);

    const weightStp = ex.bodyweight ? null : stepper({
      value: initialWeight != null ? String(initialWeight) : "",
      step: 0.5,
      placeholder: "—",
      onChange: () => {}
    });
    const repsStp = stepper({
      value: "",
      step: 1,
      placeholder: "—",
      onChange: () => {}
    });

    const card = h("div", { class: "edit-set" }, [
      h("div", { class: "row-label" }, `Set ${round}`),
      ...(weightStp ? [field("Weight (kg)", weightStp)] : []),
      field("Reps", repsStp)
    ]);
    rows.push({ round, weightStp, repsStp });
    setsContainer.appendChild(card);
  }
  addRow();

  const addBtn = h("button", { class: "btn btn-ghost btn-block", onclick: addRow }, "+ Add set");
  const error = makeError();
  const saveBtn = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Save exercise");
  const cancelBtn = h("a", { class: "btn btn-ghost btn-block", href: "#/exercises" }, "Cancel");

  saveBtn.addEventListener("click", async () => {
    const valid = [];
    for (const row of rows) {
      let weight = 0;
      if (!ex.bodyweight) {
        const w = readNumber(row.weightStp);
        if (w == null || !(w > 0)) { error.show(`Set ${row.round}: enter a weight > 0.`); return; }
        weight = w;
      }
      const reps = readNumber(row.repsStp);
      if (reps == null || reps < 1) { error.show(`Set ${row.round}: enter at least 1 rep.`); return; }
      valid.push({ round: row.round, weight, reps });
    }
    error.hide();

    const open = await getOrCreateOpenSession();
    let lastWeight = null;
    for (const v of valid) {
      await recordSet({
        sessionId: open.id, exerciseId: ex.id, round: v.round,
        weight: v.weight, reps: v.reps, setType: "no_timer"
      });
      if (v.weight > 0) lastWeight = v.weight;
    }
    if (!ex.bodyweight && lastWeight != null) {
      await updateExercise(ex.id, { workingWeight: lastWeight });
    }
    location.hash = "#/exercises";
  });

  root.appendChild(eyebrow("Sets"));
  root.appendChild(h("div", { style: "height:8px" }));
  root.appendChild(setsContainer);
  root.appendChild(h("div", { style: "height:8px" }));
  root.appendChild(addBtn);
  root.appendChild(h("div", { style: "height:24px" }));
  root.appendChild(error.el);
  root.appendChild(h("div", { class: "stack-sm" }, [saveBtn, cancelBtn]));
}

/* ============================== SWIM ============================== */

function renderSwim({ ex, root }) {
  root.appendChild(pageHead("Cardio · Swimming", ex.name));

  const distStepper = stepper({ value: "", step: 50, placeholder: "—", onChange: () => {} });
  const minStepper  = stepper({ value: "", step: 1,  placeholder: "—", onChange: () => {} });
  const secStepper  = stepper({ value: "", step: 5,  placeholder: "—", onChange: () => {} });

  const error = makeError();
  const saveBtn = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Save exercise");
  const cancelBtn = h("a", { class: "btn btn-ghost btn-block", href: "#/exercises" }, "Cancel");

  saveBtn.addEventListener("click", async () => {
    const d  = readNumber(distStepper);
    const mn = readNumber(minStepper);
    const sc = readNumber(secStepper);
    if (d == null || !(d > 0)) { error.show("Enter the distance you swam."); return; }
    if (sc != null && (sc < 0 || sc >= 60)) { error.show("Seconds must be 0–59."); return; }
    if (mn != null && mn < 0) { error.show("Minutes must be 0 or more."); return; }
    const durationSec = (mn || 0) * 60 + (sc || 0);
    if (!(durationSec > 0)) { error.show("Enter how long you swam."); return; }
    error.hide();

    const open = await getOrCreateOpenSession();
    await recordSet({
      sessionId: open.id, exerciseId: ex.id, round: 1,
      weight: 0, reps: 1, setType: "cardio_swim",
      metrics: { distanceM: Math.round(d), durationSec: Math.round(durationSec) }
    });
    location.hash = "#/exercises";
  });

  root.appendChild(field("Distance (m)", distStepper));
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(eyebrow("Time"));
  root.appendChild(h("div", { style: "height:8px" }));
  root.appendChild(h("div", { class: "grid-2" }, [
    field("Minutes", minStepper),
    field("Seconds", secStepper)
  ]));
  root.appendChild(h("div", { style: "height:24px" }));
  root.appendChild(error.el);
  root.appendChild(h("div", { class: "stack-sm" }, [saveBtn, cancelBtn]));
}

/* ============================== BIKE ============================== */

function renderBike({ ex, root }) {
  root.appendChild(pageHead("Cardio · Stationary Bike", ex.name));

  const minStepper = stepper({ value: "", step: 1, placeholder: "—",        onChange: () => {} });
  const metStepper = stepper({ value: "", step: 1, placeholder: "optional", onChange: () => {} });
  const wStepper   = stepper({ value: "", step: 5, placeholder: "optional", onChange: () => {} });
  const hrStepper  = stepper({ value: "", step: 1, placeholder: "optional", onChange: () => {} });

  const error = makeError();
  const saveBtn = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Save exercise");
  const cancelBtn = h("a", { class: "btn btn-ghost btn-block", href: "#/exercises" }, "Cancel");

  saveBtn.addEventListener("click", async () => {
    const m = readNumber(minStepper);
    if (m == null || !(m > 0)) { error.show("Enter the time on the bike (minutes)."); return; }
    error.hide();

    const metrics = { durationSec: Math.round(m * 60) };
    const met = readNumber(metStepper); if (met != null && met > 0) metrics.metMin = Math.round(met);
    const w   = readNumber(wStepper);   if (w   != null && w   > 0) metrics.avgPowerW = Math.round(w);
    const hr  = readNumber(hrStepper);  if (hr  != null && hr  > 0) metrics.avgHrBpm  = Math.round(hr);

    const open = await getOrCreateOpenSession();
    await recordSet({
      sessionId: open.id, exerciseId: ex.id, round: 1,
      weight: 0, reps: 1, setType: "cardio_bike",
      metrics
    });
    location.hash = "#/exercises";
  });

  root.appendChild(field("Time (minutes)", minStepper));
  root.appendChild(h("div", { style: "height:12px" }));
  root.appendChild(field("MET·minutes", metStepper));
  root.appendChild(h("div", { style: "height:12px" }));
  root.appendChild(field("Average power (W)", wStepper));
  root.appendChild(h("div", { style: "height:12px" }));
  root.appendChild(field("Average heart rate (bpm)", hrStepper));
  root.appendChild(h("div", { style: "height:24px" }));
  root.appendChild(error.el);
  root.appendChild(h("div", { class: "stack-sm" }, [saveBtn, cancelBtn]));
}
