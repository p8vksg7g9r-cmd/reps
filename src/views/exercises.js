import { listExercises, lastSessionForExercise, addExercise, deleteExercise, updateExercise } from "../db/repo.js";
import { restState } from "../domain/rest-rule.js";
import { h, eyebrow, badge, modal, field, fmtKg } from "../ui/components.js";

export async function ExercisesView(_params, root) {
  const exercises = await listExercises();
  const enriched = await Promise.all(exercises.map(async (e) => {
    const last = await lastSessionForExercise(e.id);
    return { ex: e, lastAt: last?.startedAt ?? null };
  }));
  enriched.sort((a, b) => a.ex.name.localeCompare(b.ex.name));

  const head = h("div", { class: "page-head row-between" }, [
    h("div", {}, [
      eyebrow("Pick a lift"),
      h("h1", { class: "display-l" }, "Lifts")
    ]),
    h("a", { class: "btn btn-ghost btn-sm", href: "#/manage-exercises" }, "Manage")
  ]);

  const list = h("div", { class: "stack-sm" }, enriched.map(({ ex, lastAt }) => {
    const rest = restState(lastAt);
    const setTypeLabel = ex.setType === "standard" ? `Standard · ${ex.rounds} rounds`
      : ex.setType === "bilateral" ? "Bilateral · 3 rounds"
      : "Continuous · 10 min";
    const weightLabel = ex.bodyweight ? " · BW" : (ex.workingWeight ? ` · ${fmtKg(ex.workingWeight)}` : "");
    const sub = `${setTypeLabel}${weightLabel}`;

    const row = h("a", {
      class: `ex-row${rest.resting ? " resting" : ""}`,
      href: rest.resting ? "#" : `#/session/new/${ex.id}`,
      onclick: (e) => {
        if (!rest.resting) return;
        e.preventDefault();
        confirmOverride(ex, rest);
      }
    }, [
      h("div", { class: "meta" }, [
        h("div", { class: "name" }, ex.name),
        h("div", { class: "sub" }, sub)
      ]),
      rest.resting
        ? badge(`${rest.daysLeft}d rest`, "badge-warn")
        : (ex.bodyweight ? badge("BW", "badge-brass") : h("span", { class: "eyebrow" }, "Go →"))
    ]);

    return row;
  }));

  root.appendChild(head);
  root.appendChild(list);
  root.appendChild(h("p", { class: "eyebrow", style: "text-align:center; margin-top:24px" },
    "Tap Manage to add or edit lifts"));

  function confirmOverride(ex, rest) {
    const m = modal([
      h("div", { class: "eyebrow" }, "Soft warning"),
      h("h2", { class: "display-m" }, `${ex.name} — ${rest.daysLeft}d rest left`),
      h("p", { class: "body" }, "The 7-day rule says this exercise should rest. You can override and train it anyway."),
      h("div", { class: "row" }, [
        h("button", { class: "btn btn-ghost", onclick: () => m.close() }, "Cancel"),
        h("button", { class: "btn btn-primary", onclick: () => { m.close(); location.hash = `#/session/new/${ex.id}`; } }, "Train anyway")
      ])
    ]);
  }
}
