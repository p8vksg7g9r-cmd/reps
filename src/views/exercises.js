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
    h("button", { class: "btn btn-ghost btn-sm", onclick: () => openAddModal() }, "+ Add")
  ]);

  const list = h("div", { class: "stack-sm" }, enriched.map(({ ex, lastAt }) => {
    const rest = restState(lastAt);
    const setTypeLabel = ex.setType === "standard" ? `Standard · ${ex.rounds} rounds`
      : ex.setType === "bilateral" ? "Bilateral · 3 rounds"
      : "Continuous · 10 min";
    const sub = `${setTypeLabel}${ex.workingWeight ? ` · ${fmtKg(ex.workingWeight)}` : ""}`;

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
        : h("span", { class: "eyebrow" }, "Go →")
    ]);

    // long-press to edit
    let pressTimer = null;
    row.addEventListener("pointerdown", () => {
      pressTimer = setTimeout(() => openEditModal(ex), 600);
    });
    row.addEventListener("pointerup", () => { if (pressTimer) clearTimeout(pressTimer); });
    row.addEventListener("pointerleave", () => { if (pressTimer) clearTimeout(pressTimer); });

    return row;
  }));

  root.appendChild(head);
  root.appendChild(list);
  root.appendChild(h("p", { class: "eyebrow", style: "text-align:center; margin-top:24px" }, "Long-press a lift to edit"));

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

  function openAddModal() {
    const nameInput = h("input", { type: "text", placeholder: "e.g. Cable Fly" });
    const typeSel = h("select", {}, [
      h("option", { value: "standard" }, "Standard"),
      h("option", { value: "bilateral" }, "Bilateral"),
      h("option", { value: "continuous" }, "Continuous")
    ]);
    const roundsInput = h("input", { type: "number", value: "3", min: "1" });
    const weightInput = h("input", { type: "number", value: "0", min: "0", step: "0.5" });

    const m = modal([
      h("div", { class: "eyebrow" }, "New exercise"),
      h("h2", { class: "display-m" }, "Add a lift"),
      field("Name", nameInput),
      field("Set type", typeSel),
      field("Rounds (standard only)", roundsInput),
      field("Starting weight (kg)", weightInput),
      h("div", { class: "row" }, [
        h("button", { class: "btn btn-ghost", onclick: () => m.close() }, "Cancel"),
        h("button", { class: "btn btn-primary", onclick: async () => {
          const name = nameInput.value.trim();
          if (!name) return;
          await addExercise({
            name,
            setType: typeSel.value,
            rounds: typeSel.value === "standard" ? Number(roundsInput.value) || 3 : (typeSel.value === "bilateral" ? 3 : null),
            workingWeight: Number(weightInput.value) || 0
          });
          m.close();
          location.hash = "#/exercises";
          // hashchange same -> force re-render
          if (location.hash === "#/exercises") {
            const ev = new HashChangeEvent("hashchange");
            window.dispatchEvent(ev);
          }
        } }, "Add")
      ])
    ]);
  }

  function openEditModal(ex) {
    const nameInput = h("input", { type: "text", value: ex.name });
    const typeSel = h("select", {}, [
      h("option", { value: "standard", selected: ex.setType === "standard" }, "Standard"),
      h("option", { value: "bilateral", selected: ex.setType === "bilateral" }, "Bilateral"),
      h("option", { value: "continuous", selected: ex.setType === "continuous" }, "Continuous")
    ]);
    const roundsInput = h("input", { type: "number", value: String(ex.rounds ?? 3), min: "1" });
    const weightInput = h("input", { type: "number", value: String(ex.workingWeight ?? 0), min: "0", step: "0.5" });

    const m = modal([
      h("div", { class: "eyebrow" }, "Edit exercise"),
      h("h2", { class: "display-m" }, ex.name),
      field("Name", nameInput),
      field("Set type", typeSel),
      field("Rounds (standard only)", roundsInput),
      field("Working weight (kg)", weightInput),
      h("div", { class: "row" }, [
        h("button", { class: "btn btn-ghost", onclick: () => {
          if (!confirm(`Delete "${ex.name}"? Sessions and sets remain in history.`)) return;
          deleteExercise(ex.id).then(() => { m.close(); window.dispatchEvent(new HashChangeEvent("hashchange")); });
        } }, "Delete"),
        h("div", { class: "spacer" }),
        h("button", { class: "btn btn-ghost", onclick: () => m.close() }, "Cancel"),
        h("button", { class: "btn btn-primary", onclick: async () => {
          await updateExercise(ex.id, {
            name: nameInput.value.trim() || ex.name,
            setType: typeSel.value,
            rounds: typeSel.value === "standard" ? Number(roundsInput.value) || 3 : (typeSel.value === "bilateral" ? 3 : null),
            workingWeight: Number(weightInput.value) || 0
          });
          m.close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        } }, "Save")
      ])
    ]);
  }
}
