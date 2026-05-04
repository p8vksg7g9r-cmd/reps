import { getSession, getExercise, setsForSessionExercise, updateSet } from "../db/repo.js";
import { h, eyebrow, stepper, field, fmtDay, setTypeStructure } from "../ui/components.js";

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
