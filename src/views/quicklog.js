import {
  getExercise, getOrCreateOpenSession, recordSet, updateExercise
} from "../db/repo.js";
import { h, eyebrow, stepper, field, badge } from "../ui/components.js";
import { isCardioSetType } from "../domain/volume.js";

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

function readNumber(stepperEl) {
  const input = stepperEl?.querySelector("input");
  if (!input || input.value === "") return null;
  const n = Number(input.value);
  return Number.isFinite(n) ? n : null;
}

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

/* ============================== SWIM ============================== */

function renderSwim({ ex, root }) {
  root.appendChild(pageHead("Cardio · Swimming", ex.name));

  const distRef = { value: null };
  const minRef  = { value: null };
  const secRef  = { value: null };

  const distStepper = stepper({ value: "", step: 50, placeholder: "—", onChange: (n) => { distRef.value = n; } });
  const minStepper  = stepper({ value: "", step: 1,  placeholder: "—", onChange: (n) => { minRef.value = n; } });
  const secStepper  = stepper({ value: "", step: 5,  placeholder: "—", onChange: (n) => { secRef.value = n; } });

  const error = makeError();
  const saveBtn = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Save exercise");
  const cancelBtn = h("a", { class: "btn btn-ghost btn-block", href: "#/exercises" }, "Cancel");

  saveBtn.addEventListener("click", async () => {
    const d = readNumber(distStepper);
    const m = readNumber(minStepper);
    const s = readNumber(secStepper) ?? 0;
    if (d == null || !(d > 0)) { error.show("Enter the distance you swam."); return; }
    if (m == null && s == null) { error.show("Enter how long you swam."); return; }
    if ((m ?? 0) < 0 || s < 0 || s >= 60) { error.show("Time: minutes ≥ 0, seconds 0–59."); return; }
    error.hide();

    const durationSec = (Number(m) || 0) * 60 + Number(s);
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

  const minRef = { value: null };
  const metRef = { value: null };
  const wRef   = { value: null };
  const hrRef  = { value: null };

  const minStepper = stepper({ value: "", step: 1, placeholder: "—", onChange: (n) => { minRef.value = n; } });
  const metStepper = stepper({ value: "", step: 1, placeholder: "optional", onChange: (n) => { metRef.value = n; } });
  const wStepper   = stepper({ value: "", step: 5, placeholder: "optional", onChange: (n) => { wRef.value = n; } });
  const hrStepper  = stepper({ value: "", step: 1, placeholder: "optional", onChange: (n) => { hrRef.value = n; } });

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
