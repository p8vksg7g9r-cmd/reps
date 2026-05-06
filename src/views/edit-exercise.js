import { getSession, getExercise, setsForSessionExercise, updateSet } from "../db/repo.js";
import { h, eyebrow, stepper, field, fmtDay, setTypeStructure } from "../ui/components.js";
import { isCardioSetType } from "../domain/volume.js";

/**
 * /edit-exercise/:sessionId/:exerciseId
 * Each set is a card with weight + reps steppers. Save validates that every
 * row has a positive rep count, then persists per-set patches via updateSet.
 * Cancel discards everything (no in-place state mutation happens until Save).
 */
export async function EditExerciseView(params, root) {
  const sessionId = Number(params.sessionId);
  const exerciseId = Number(params.exerciseId);

  const [session, exercise, sets] = await Promise.all([
    getSession(sessionId),
    getExercise(exerciseId),
    setsForSessionExercise(sessionId, exerciseId)
  ]);

  const head = h("div", { class: "page-head" }, [
    h("a", { href: "#/history", class: "eyebrow" }, "← History"),
    h("h1", { class: "display-l" }, exercise?.name ?? "Exercise (deleted)")
  ]);
  root.appendChild(head);

  if (!session) {
    root.appendChild(h("p", { class: "body-s", style: "color: var(--ink-mute)" }, "Session not found."));
    return;
  }
  if (sets.length === 0) {
    root.appendChild(h("p", { class: "body-s", style: "color: var(--ink-mute)" },
      "No sets to edit — this exercise has no recorded sets in this session."));
    root.appendChild(h("div", { style: "height:16px" }));
    root.appendChild(h("a", { href: "#/history", class: "btn btn-ghost btn-block" }, "Back"));
    return;
  }

  const meta = h("div", { class: "card stack-sm" }, [
    h("div", { class: "row-between mono", style: "font-size:13px" }, [
      h("span", { style: "color: var(--ink-mute)" }, "Session"),
      h("span", {}, fmtDay(session.startedAt))
    ]),
    exercise ? h("div", { class: "row-between mono", style: "font-size:13px" }, [
      h("span", { style: "color: var(--ink-mute)" }, "Type"),
      h("span", {}, setTypeStructure(exercise))
    ]) : null
  ].filter(Boolean));
  root.appendChild(meta);
  root.appendChild(h("div", { style: "height:16px" }));

  // Build a row per set, sorted by round then completedAt (rare ties).
  const sortedSets = sets.slice().sort((a, b) =>
    a.round - b.round || a.completedAt - b.completedAt
  );

  // Cardio rows have a totally different schema — render and persist them
  // through a dedicated path below.
  if (sortedSets[0] && isCardioSetType(sortedSets[0].setType)) {
    return renderCardioEdit({ root, sortedSets, exercise });
  }

  const isBilateral = exercise?.setType === "bilateral";
  const isBodyweight = !!exercise?.bodyweight;
  const rowLabelFor = (s) => isBilateral ? `Round ${s.round}` : `Set ${s.round}`;
  const weightLabel = isBilateral ? "Weight per side (kg)" : "Weight (kg)";
  const repsLabel = isBilateral ? "Reps per side" : "Reps";

  const refs = sortedSets.map((s) => {
    const ref = { id: s.id, weight: s.weight ?? 0, reps: s.reps ?? null };
    return ref;
  });

  const list = h("div", { class: "stack" }, sortedSets.map((s, i) => {
    const ref = refs[i];

    const weightStepper = isBodyweight
      ? null
      : stepper({
          value: ref.weight === 0 ? "" : String(ref.weight),
          step: 0.5,
          placeholder: "—",
          onChange: (n) => { ref.weight = (n == null ? 0 : n); }
        });

    const repsStepper = stepper({
      value: ref.reps == null ? "" : String(ref.reps),
      step: 1,
      placeholder: "—",
      onChange: (n) => { ref.reps = n; }
    });

    return h("div", { class: "edit-set" }, [
      h("div", { class: "row-label" }, rowLabelFor(s)),
      ...(weightStepper ? [field(weightLabel, weightStepper)] : [
        h("div", { class: "field" }, [
          h("span", { class: "label" }, "Weight"),
          h("div", { class: "card card-tight body-s", style: "color: var(--ink-mute); text-align:center" },
            "Bodyweight exercise · no weight stored")
        ])
      ]),
      field(repsLabel, repsStepper)
    ]);
  }));

  const error = h("p", {
    class: "body-s hidden",
    style: "color: var(--terracotta); margin: 0; text-align:center; font-weight:600"
  }, "");

  const cancelBtn = h("a", { href: "#/history", class: "btn btn-ghost btn-block" }, "Cancel");
  const saveBtn = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Save changes");

  saveBtn.addEventListener("click", async () => {
    // Read live input values, then validate.
    for (let i = 0; i < refs.length; i++) {
      const r = refs[i];
      const card = list.children[i];
      const inputs = card.querySelectorAll(".stepper input");
      // Inputs are in render order: [weight (if present), reps]
      let inputIdx = 0;
      if (!isBodyweight) {
        const wv = inputs[inputIdx++].value;
        const wn = wv === "" ? 0 : Number(wv);
        if (Number.isNaN(wn) || wn < 0) {
          error.textContent = `${rowLabelFor(sortedSets[i])}: weight must be a number >= 0.`;
          error.classList.remove("hidden");
          return;
        }
        r.weight = wn;
      }
      const rv = inputs[inputIdx++].value;
      const rn = rv === "" ? null : Number(rv);
      if (rn == null || Number.isNaN(rn) || rn < 1) {
        error.textContent = `${rowLabelFor(sortedSets[i])}: reps must be at least 1.`;
        error.classList.remove("hidden");
        return;
      }
      r.reps = rn;
    }
    error.classList.add("hidden");

    // Persist any rows that changed.
    for (let i = 0; i < refs.length; i++) {
      const r = refs[i];
      const orig = sortedSets[i];
      if (r.weight === (orig.weight ?? 0) && r.reps === orig.reps) continue;
      await updateSet(r.id, { weight: r.weight, reps: r.reps });
    }
    location.hash = "#/history";
  });

  root.appendChild(list);
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(error);
  root.appendChild(h("div", { class: "stack-sm" }, [saveBtn, cancelBtn]));
}

/* ----------------------- cardio editing ----------------------- */

function renderCardioEdit({ root, sortedSets, exercise }) {
  // Cardio sessions have one set per exercise per session; edit that one row.
  const set = sortedSets[0];
  const setType = set.setType;
  const m = { ...(set.metrics || {}) };

  const error = h("p", {
    class: "body-s hidden",
    style: "color: var(--terracotta); margin: 0; text-align:center; font-weight:600"
  }, "");
  function showError(msg) { error.textContent = msg; error.classList.remove("hidden"); }
  function hideError() { error.classList.add("hidden"); }

  const cancelBtn = h("a", { href: "#/history", class: "btn btn-ghost btn-block" }, "Cancel");
  const saveBtn = h("button", { class: "btn btn-primary btn-block btn-lg" }, "Save changes");

  if (setType === "cardio_swim") {
    const distStp = stepper({ value: m.distanceM != null ? String(m.distanceM) : "", step: 50, placeholder: "—",
      onChange: (n) => { m.distanceM = n; } });
    const initialMin = m.durationSec != null ? Math.floor(m.durationSec / 60) : null;
    const initialSec = m.durationSec != null ? (m.durationSec % 60) : null;
    let mins = initialMin, secs = initialSec;
    const minStp = stepper({ value: initialMin != null ? String(initialMin) : "", step: 1, placeholder: "—",
      onChange: (n) => { mins = n; } });
    const secStp = stepper({ value: initialSec != null ? String(initialSec) : "", step: 5, placeholder: "—",
      onChange: (n) => { secs = n; } });

    saveBtn.addEventListener("click", async () => {
      const dInput = distStp.querySelector("input");
      const d = (dInput && dInput.value !== "") ? Number(dInput.value) : null;
      const minInput = minStp.querySelector("input");
      const secInput = secStp.querySelector("input");
      const mn = (minInput && minInput.value !== "") ? Number(minInput.value) : null;
      const sc = (secInput && secInput.value !== "") ? Number(secInput.value) : 0;
      if (d == null || !(d > 0)) { showError("Distance: must be > 0."); return; }
      if (mn == null && sc == null) { showError("Time: enter minutes and/or seconds."); return; }
      if ((mn ?? 0) < 0 || sc < 0 || sc >= 60) { showError("Time: minutes ≥ 0, seconds 0–59."); return; }
      hideError();
      const durationSec = (Number(mn) || 0) * 60 + Number(sc);
      await updateSet(set.id, { metrics: { distanceM: Math.round(d), durationSec: Math.round(durationSec) } });
      location.hash = "#/history";
    });

    root.appendChild(h("div", { class: "edit-set" }, [
      h("div", { class: "row-label" }, "Swimming"),
      field("Distance (m)", distStp),
      h("div", { style: "height:8px" }),
      h("div", { class: "grid-2" }, [field("Minutes", minStp), field("Seconds", secStp)])
    ]));
  } else {
    // cardio_bike
    const initialMin = m.durationSec != null ? Math.round(m.durationSec / 60) : null;
    const minStp = stepper({ value: initialMin != null ? String(initialMin) : "", step: 1, placeholder: "—",
      onChange: () => {} });
    const metStp = stepper({ value: m.metMin    != null ? String(m.metMin)    : "", step: 1, placeholder: "optional",
      onChange: () => {} });
    const wStp   = stepper({ value: m.avgPowerW != null ? String(m.avgPowerW) : "", step: 5, placeholder: "optional",
      onChange: () => {} });
    const hrStp  = stepper({ value: m.avgHrBpm  != null ? String(m.avgHrBpm)  : "", step: 1, placeholder: "optional",
      onChange: () => {} });

    saveBtn.addEventListener("click", async () => {
      const read = (s) => { const i = s.querySelector("input"); return (i && i.value !== "") ? Number(i.value) : null; };
      const mn  = read(minStp);
      const met = read(metStp);
      const w   = read(wStp);
      const hr  = read(hrStp);
      if (mn == null || !(mn > 0)) { showError("Time: must be > 0 minutes."); return; }
      hideError();
      const newMetrics = { durationSec: Math.round(mn * 60) };
      if (met != null && met > 0) newMetrics.metMin = Math.round(met);
      if (w   != null && w   > 0) newMetrics.avgPowerW = Math.round(w);
      if (hr  != null && hr  > 0) newMetrics.avgHrBpm  = Math.round(hr);
      await updateSet(set.id, { metrics: newMetrics });
      location.hash = "#/history";
    });

    root.appendChild(h("div", { class: "edit-set" }, [
      h("div", { class: "row-label" }, "Stationary Bike"),
      field("Time (minutes)", minStp),
      h("div", { style: "height:8px" }),
      field("MET·minutes", metStp),
      h("div", { style: "height:8px" }),
      field("Average power (W)", wStp),
      h("div", { style: "height:8px" }),
      field("Average heart rate (bpm)", hrStp)
    ]));
  }

  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(error);
  root.appendChild(h("div", { class: "stack-sm" }, [saveBtn, cancelBtn]));
}

