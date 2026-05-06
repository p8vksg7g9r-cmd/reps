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

  function buildRow({ ex, lastAt }) {
    const isCardio = ex.category === "cardio";
    const rest = isCardio ? { resting: false, daysLeft: 0 } : restState(lastAt);
    const weightLabel = isCardio
      ? ""
      : ex.bodyweight ? " · BW" : (ex.workingWeight ? ` · ${fmtKg(ex.workingWeight)}` : "");
    const sub = `${setTypeStructure(ex)}${weightLabel}`;

    const trailing = rest.resting
      ? badge(`${rest.daysLeft}d rest`, "badge-warn")
      : isCardio ? badge("Cardio", "badge-brass")
      : ex.bodyweight ? badge("BW", "badge-brass")
      : h("span", { class: "eyebrow" }, "Go →");

    const row = h("a", {
      class: `ex-row${rest.resting ? " resting" : ""}`,
      href: "#",
      onclick: (e) => {
        e.preventDefault();
        if (isCardio) {
          // Cardio always goes through manual entry — no timer mode.
          location.hash = `#/quicklog/${ex.id}`;
        } else {
          openChooser(ex, rest);
        }
      }
    }, [
      h("div", { class: "meta" }, [
        h("div", { class: "name" }, ex.name),
        h("div", { class: "sub" }, sub)
      ]),
      trailing
    ]);
    return row;
  }

  // Group: Strength first, then Cardio. Each section sorted alphabetically.
  const strength = enriched.filter(({ ex }) => ex.category !== "cardio");
  const cardio   = enriched.filter(({ ex }) => ex.category === "cardio");

  const sections = [];
  if (strength.length) {
    sections.push(h("div", {}, [
      h("div", { class: "eyebrow", style: "margin: 8px 4px 8px" }, "Strength"),
      h("div", { class: "stack-sm" }, strength.map(buildRow))
    ]));
  }
  if (cardio.length) {
    sections.push(h("div", { style: "margin-top: 24px" }, [
      h("div", { class: "eyebrow", style: "margin: 8px 4px 8px" }, "Cardio"),
      h("div", { class: "stack-sm" }, cardio.map(buildRow))
    ]));
  }
  const list = h("div", {}, sections);

  root.appendChild(head);
  if (openBanner) root.appendChild(openBanner);
  root.appendChild(list);
  root.appendChild(h("p", { class: "eyebrow", style: "text-align:center; margin-top:24px" },
    "Tap Manage to add or edit exercises"));

  /**
   * Two-mode chooser: With Timer (the existing structured session) or
   * Without Timer (the new manual quick-log flow). If the exercise is
   * still under the 7-day rest rule, surface that as a soft warning at
   * the top of the modal but still allow either path.
   */
  function openChooser(ex, rest) {
    const restWarn = rest.resting
      ? h("div", { class: "card card-tight", style: "background: rgba(217,122,79,0.14); color:#a85a36" }, [
          h("strong", {}, `${rest.daysLeft}d rest left`),
          h("div", { class: "body-s", style: "margin-top:2px" },
            "The 7-day rule says this exercise should rest. You can train it anyway.")
        ])
      : null;

    const m = modal([
      eyebrow("Pick a mode"),
      h("h2", { class: "display-m" }, ex.name),
      restWarn,
      h("button", { class: "btn btn-primary btn-block btn-lg", onclick: () => {
        m.close();
        location.hash = `#/session/new/${ex.id}`;
      } }, "With Timer"),
      h("button", { class: "btn btn-ghost btn-block btn-lg", onclick: () => {
        m.close();
        location.hash = `#/quicklog/${ex.id}`;
      } }, "Without Timer"),
      h("button", { class: "btn btn-ghost btn-block", onclick: () => m.close() }, "Cancel")
    ].filter(Boolean));
  }
}
