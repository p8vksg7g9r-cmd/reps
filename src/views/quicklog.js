import {
  getExercise, getOrCreateOpenSession, recordSet, updateExercise
} from "../db/repo.js";
import { h, eyebrow, stepper, field, badge } from "../ui/components.js";

/**
 * /quicklog/:exerciseId — manual logging without the timer.
 * One weight stepper (omitted for bodyweight exercises), N reps stepper rows
 * starting at one (Set 1), an "Add Set" button that appends Set 2, Set 3 …,
 * and a Save button that writes everything to the current open session and
 * returns to the exercise picker. Cancel discards.
 *
 * The recorded sets carry the exercise's setType so volume math (including
 * the bilateral × 2) still works as expected from history and summary views.
 */
export async function QuickLogView(params, root) {
  const exerciseId = Number(params.exerciseId);
  const ex = await getExercise(exerciseId);
  if (!ex) {
    root.appendChild(h("p", {}, "Exercise not found."));
    return;
  }

  const isBilateral = ex.setType === "bilateral";

  const head = h("div", { class: "page-head" }, [
    h("a", { href: "#/exercises", class: "eyebrow" }, "← Cancel"),
    eyebrow("Quick log · no timer"),
    h("h1", { class: "display-l" }, ex.name)
  ]);
  root.appendChild(head);

  // Weight (skipped entirely for bodyweight exercises)
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

  // Set rows
  const setRows = [];                                  // { round, repsRef, stepperEl, fieldEl }
  const setsContainer = h("div", { class: "stack-sm" });

  function repsLabel(round) {
    return isBilateral ? `Set ${round} — reps per side` : `Set ${round} — reps`;
  }

  function addRow() {
    const round = setRows.length + 1;
    const repsRef = { value: null };
    const stp = stepper({
      value: "",
      step: 1,
      placeholder: "—",
      onChange: (n) => { repsRef.value = n; }
    });
    const fld = field(repsLabel(round), stp);
    setRows.push({ round, repsRef, stepperEl: stp, fieldEl: fld });
    setsContainer.appendChild(fld);
  }
  addRow();

  const addBtn = h("button", { class: "btn btn-ghost btn-block" }, "+ Add set");
  addBtn.addEventListener("click", addRow);

  const errorEl = h("p", {
    class: "body-s hidden",
    style: "color: var(--terracotta); margin: 0 0 8px; text-align:center; font-weight:600"
  }, "");

  const saveBtn = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Save exercise");
  const cancelBtn = h("a", { class: "btn btn-ghost btn-block", href: "#/exercises" }, "Cancel");

  saveBtn.addEventListener("click", async () => {
    // Validate weight (non-bodyweight only) — read live from input for un-blurred values.
    if (!ex.bodyweight) {
      const wInput = weightStepper?.querySelector("input");
      const w = (wInput && wInput.value !== "") ? Number(wInput.value) : weight.value;
      if (w == null || !(w > 0)) {
        errorEl.textContent = "Enter a weight before saving.";
        errorEl.classList.remove("hidden");
        return;
      }
      weight.value = w;
    }

    // Validate every reps row
    const valid = [];
    for (const row of setRows) {
      const inputEl = row.stepperEl.querySelector("input");
      const v = (inputEl && inputEl.value !== "") ? Number(inputEl.value) : row.repsRef.value;
      if (v == null || !Number.isFinite(v) || v < 1) {
        errorEl.textContent = `Set ${row.round}: enter at least 1 rep.`;
        errorEl.classList.remove("hidden");
        return;
      }
      valid.push({ round: row.round, reps: v });
    }
    errorEl.classList.add("hidden");

    const open = await getOrCreateOpenSession();
    for (const v of valid) {
      await recordSet({
        sessionId: open.id,
        exerciseId: ex.id,
        round: v.round,
        weight: weight.value,
        reps: v.reps,
        setType: ex.setType
      });
    }
    if (!ex.bodyweight) {
      await updateExercise(ex.id, { workingWeight: weight.value });
    }
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
  root.appendChild(errorEl);
  root.appendChild(h("div", { class: "stack-sm" }, [saveBtn, cancelBtn]));
}
