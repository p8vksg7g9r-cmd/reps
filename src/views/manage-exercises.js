import { listExercises, addExercise, updateExercise, deleteExercise } from "../db/repo.js";
import { h, eyebrow, modal, field, fmtKg } from "../ui/components.js";

export async function ManageExercisesView(_params, root) {
  const exercises = await listExercises();
  exercises.sort((a, b) => a.name.localeCompare(b.name));

  const head = h("div", { class: "page-head row-between" }, [
    h("div", {}, [
      h("a", { href: "#/profile", class: "eyebrow" }, "← Profile"),
      h("h1", { class: "display-l" }, "Exercise Manager")
    ]),
    h("button", { class: "btn btn-primary btn-sm", onclick: openAddModal }, "+ New")
  ]);

  const list = h("div", { class: "stack-sm" }, exercises.map(buildRow));

  root.appendChild(head);
  root.appendChild(list);
  if (exercises.length === 0) {
    root.appendChild(h("p", { class: "body-s", style: "text-align:center; color: var(--ink-mute); padding: 24px 0" },
      "No exercises yet. Tap + New."));
  }

  function buildRow(ex) {
    const setTypeLabel = ex.setType === "standard" ? `Standard · ${ex.rounds} rounds`
      : ex.setType === "bilateral" ? "Bilateral · 3 rounds"
      : "Continuous · 10 min";
    const weightLabel = ex.bodyweight ? "Bodyweight" : (ex.workingWeight ? fmtKg(ex.workingWeight) : "no weight set");

    const bwToggle = h("button", {
      class: `toggle-bw${ex.bodyweight ? " on" : ""}`,
      type: "button"
    }, [h("span", { class: "dot" }), `BW ${ex.bodyweight ? "on" : "off"}`]);

    bwToggle.addEventListener("click", async () => {
      const newVal = !ex.bodyweight;
      await updateExercise(ex.id, { bodyweight: newVal, workingWeight: newVal ? 0 : ex.workingWeight });
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    const editBtn = h("button", { class: "btn btn-ghost btn-sm", onclick: () => openEditModal(ex) }, "Edit");
    const delBtn = h("button", { class: "btn btn-ghost btn-sm", onclick: () => confirmDelete(ex) }, "Delete");

    return h("div", { class: "mgr-row" }, [
      h("div", { class: "top" }, [
        h("div", {}, [
          h("div", { class: "name" }, ex.name),
          h("div", { class: "sub" }, `${setTypeLabel} · ${weightLabel}`)
        ])
      ]),
      h("div", { class: "actions" }, [bwToggle, h("div", { class: "spacer" }), editBtn, delBtn])
    ]);
  }

  function confirmDelete(ex) {
    if (!confirm(`Delete "${ex.name}"? Sessions and sets remain in history.`)) return;
    deleteExercise(ex.id).then(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  }

  function openAddModal() {
    openExerciseModal({
      title: "Add a lift",
      eyebrowText: "New exercise",
      values: { name: "", setType: "standard", rounds: 3, workingWeight: 0, bodyweight: false },
      submitLabel: "Add",
      onSubmit: async (vals) => {
        if (!vals.name) return;
        await addExercise(vals);
      }
    });
  }

  function openEditModal(ex) {
    openExerciseModal({
      title: ex.name,
      eyebrowText: "Edit exercise",
      values: {
        name: ex.name,
        setType: ex.setType,
        rounds: ex.rounds ?? 3,
        workingWeight: ex.workingWeight ?? 0,
        bodyweight: !!ex.bodyweight
      },
      submitLabel: "Save",
      onSubmit: async (vals) => {
        await updateExercise(ex.id, vals);
      }
    });
  }

  function openExerciseModal({ title, eyebrowText, values, submitLabel, onSubmit }) {
    const v = { ...values };
    const nameInput = h("input", { type: "text", value: v.name, placeholder: "e.g. Cable Fly" });
    nameInput.addEventListener("input", () => v.name = nameInput.value.trim());

    const typeSel = h("select", {}, [
      h("option", { value: "standard", selected: v.setType === "standard" }, "Standard"),
      h("option", { value: "bilateral", selected: v.setType === "bilateral" }, "Bilateral"),
      h("option", { value: "continuous", selected: v.setType === "continuous" }, "Continuous")
    ]);
    typeSel.addEventListener("change", () => {
      v.setType = typeSel.value;
      // Bilateral always has 3 rounds; continuous has none.
      if (v.setType === "bilateral") v.rounds = 3;
      if (v.setType === "continuous") v.rounds = null;
      roundsInput.value = String(v.rounds ?? "");
      roundsInput.disabled = v.setType !== "standard";
    });

    const roundsInput = h("input", { type: "number", value: String(v.rounds ?? 3), min: "1" });
    roundsInput.disabled = v.setType !== "standard";
    roundsInput.addEventListener("change", () => v.rounds = Number(roundsInput.value) || 3);

    const weightInput = h("input", { type: "number", value: String(v.workingWeight ?? 0), min: "0", step: "0.5" });
    weightInput.disabled = v.bodyweight;
    weightInput.addEventListener("change", () => v.workingWeight = Number(weightInput.value) || 0);

    const bwToggle = h("button", {
      class: `toggle-bw${v.bodyweight ? " on" : ""}`,
      type: "button"
    }, [h("span", { class: "dot" }), `Bodyweight ${v.bodyweight ? "on" : "off"}`]);

    bwToggle.addEventListener("click", () => {
      v.bodyweight = !v.bodyweight;
      bwToggle.classList.toggle("on", v.bodyweight);
      bwToggle.lastChild.textContent = `Bodyweight ${v.bodyweight ? "on" : "off"}`;
      weightInput.disabled = v.bodyweight;
      if (v.bodyweight) v.workingWeight = 0;
    });

    const m = modal([
      eyebrow(eyebrowText),
      h("h2", { class: "display-m" }, title),
      field("Name", nameInput),
      field("Set type", typeSel),
      field("Rounds (standard only)", roundsInput),
      field("Working weight (kg)", weightInput),
      h("div", { style: "margin-top: 4px" }, bwToggle),
      h("div", { class: "row", style: "margin-top: 16px" }, [
        h("button", { class: "btn btn-ghost", onclick: () => m.close() }, "Cancel"),
        h("div", { class: "spacer" }),
        h("button", { class: "btn btn-primary", onclick: async () => {
          if (v.setType === "bilateral") v.rounds = 3;
          if (v.setType === "continuous") v.rounds = null;
          await onSubmit(v);
          m.close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        } }, submitLabel)
      ])
    ]);
  }
}
