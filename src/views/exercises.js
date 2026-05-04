import { listExercises, lastSessionForExercise, getOpenSession, endSession } from "../db/repo.js";
import { restState } from "../domain/rest-rule.js";
import { tx, reqAsPromise } from "../db/schema.js";
import { h, eyebrow, badge, modal, fmtKg, setTypeStructure } from "../ui/components.js";

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export async function ExercisesView(_params, root) {
  const [exercises, openSession] = await Promise.all([listExercises(), getOpenSession()]);
  const enriched = await Promise.all(exercises.map(async (e) => {
    const last = await lastSessionForExercise(e.id);
    return { ex: e, lastAt: last?.startedAt ?? null };
  }));
  enriched.sort((a, b) => a.ex.name.localeCompare(b.ex.name));

  const head = h("div", { class: "page-head row-between" }, [
    h("div", {}, [
      eyebrow(openSession ? "Pick the next exercise" : "Pick an exercise to start"),
      h("h1", { class: "display-l" }, "Exercises")
    ]),
    h("a", { class: "btn btn-ghost btn-sm", href: "#/manage-exercises" }, "Manage")
  ]);

  // Open-session banner with End-session escape hatch
  let openBanner = null;
  if (openSession) {
    const t = await tx(["sets"]);
    const setsAll = await reqAsPromise(t.objectStore("sets").getAll());
    const sessionSets = setsAll.filter((s) => s.sessionId === openSession.id && s.reps != null);
    const exCount = new Set(sessionSets.map((s) => s.exerciseId)).size;
    openBanner = h("div", { class: "card stack-sm", style: "background: var(--brass); color: var(--navy-deep); margin-bottom: 16px" }, [
      h("div", {}, [
        h("div", { class: "eyebrow", style: "color: var(--navy-deep); opacity:0.75" }, "Session in progress"),
        h("div", { class: "mono", style: "font-weight:600" },
          `Started ${fmtTime(openSession.startedAt)} · ${exCount} exercise${exCount === 1 ? "" : "s"} done`)
      ]),
      h("button", { class: "btn btn-block", style: "background: var(--navy-deep); color: var(--paper)", onclick: async () => {
        if (!confirm("End this session now?")) return;
        await endSession(openSession.id);
        location.hash = `#/summary/${openSession.id}`;
      } }, "End session")
    ]);
  }

  const list = h("div", { class: "stack-sm" }, enriched.map(({ ex, lastAt }) => {
    const rest = restState(lastAt);
    const weightLabel = ex.bodyweight ? " · BW" : (ex.workingWeight ? ` · ${fmtKg(ex.workingWeight)}` : "");
    const sub = `${setTypeStructure(ex)}${weightLabel}`;

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
  if (openBanner) root.appendChild(openBanner);
  root.appendChild(list);
  root.appendChild(h("p", { class: "eyebrow", style: "text-align:center; margin-top:24px" },
    "Tap Manage to add or edit exercises"));

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
