import { allSessions, listExercises } from "../db/repo.js";
import { tx, reqAsPromise } from "../db/schema.js";
import { groupSessionsByDay, startOfIsoWeek, startOfMonth } from "../domain/week.js";
import { setVolume } from "../domain/volume.js";
import { h, eyebrow, fmtVolume, fmtDay } from "../ui/components.js";

async function allSets() {
  const t = await tx(["sets"]);
  return reqAsPromise(t.objectStore("sets").getAll());
}

const TABS = [
  { id: "week",  label: "Week" },
  { id: "month", label: "Month" },
  { id: "all",   label: "All" }
];

export async function HistoryView(_params, root) {
  let activeTab = "week";

  const head = h("div", { class: "page-head" }, [
    eyebrow("Sessions"),
    h("h1", { class: "display-l" }, "History")
  ]);

  const tabs = h("div", { class: "tabs" }, TABS.map((t) => h("button", {
    class: t.id === activeTab ? "active" : "",
    "data-tab": t.id,
    onclick: () => { activeTab = t.id; redraw(); }
  }, t.label)));

  const body = h("div", { class: "stack" });

  const [sessions, allSetsRaw, exercises] = await Promise.all([allSessions(), allSets(), listExercises()]);
  // Drop stub sets where reps were never filled in (abandoned mid-session).
  const sets = allSetsRaw.filter((s) => s.reps != null);
  const exById = new Map(exercises.map((e) => [e.id, e]));

  function filtered() {
    const now = Date.now();
    if (activeTab === "week") {
      const start = startOfIsoWeek(now);
      return sessions.filter((s) => s.startedAt >= start);
    }
    if (activeTab === "month") {
      const start = startOfMonth(now);
      return sessions.filter((s) => s.startedAt >= start);
    }
    return sessions;
  }

  function redraw() {
    tabs.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === activeTab);
    });
    body.innerHTML = "";
    const groups = groupSessionsByDay(filtered());
    if (!groups.length) {
      body.appendChild(h("p", { class: "body-s", style: "color: var(--ink-mute); text-align:center; padding: 32px 0;" }, "No sessions in this range."));
      return;
    }
    for (const g of groups) {
      const dayVol = g.sessions.reduce((sum, s) => sum + sets.filter((x) => x.sessionId === s.id).reduce((a, x) => a + setVolume(x), 0), 0);
      const block = h("section", { class: "day-group" }, [
        h("div", { class: "day-head" }, [
          h("div", { class: "date" }, fmtDay(g.dayMs)),
          h("div", { class: "vol mono" }, `${fmtVolume(dayVol)} kg`)
        ]),
        ...g.sessions.map((s) => {
          const ex = exById.get(s.exerciseId);
          const ssets = sets.filter((x) => x.sessionId === s.id).sort((a, b) => a.round - b.round);
          const lines = ssets.map((set) => h("div", { class: "ex-line" }, [
            h("span", {}, `R${set.round}`),
            h("span", {}, `${set.weight || 0}kg × ${set.reps}${set.setType === "bilateral" ? " /side" : ""}`)
          ]));
          return h("a", { class: "session-card", href: `#/exercise/${ex?.id ?? ""}` }, [
            h("div", { class: "row-between" }, [
              h("div", { style: "font-weight:600" }, ex?.name ?? "Exercise"),
              h("div", { class: "mono", style: "font-size:12px; color: var(--ink-mute)" },
                new Date(s.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
            ]),
            h("div", { style: "margin-top: 6px" }, lines)
          ]);
        })
      ]);
      body.appendChild(block);
    }
  }

  root.appendChild(head);
  root.appendChild(tabs);
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(body);
  redraw();
}
