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
    eyebrow("Past sessions"),
    h("h1", { class: "display-l" }, "History")
  ]);

  const tabs = h("div", { class: "tabs" }, TABS.map((t) => h("button", {
    class: t.id === activeTab ? "active" : "",
    "data-tab": t.id,
    onclick: () => { activeTab = t.id; redraw(); }
  }, t.label)));

  const body = h("div", { class: "stack" });

  const [sessions, allSetsRaw, exercises] = await Promise.all([allSessions(), allSets(), listExercises()]);
  // Drop stub sets where reps were never filled in.
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

  function fmtTime(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function redraw() {
    tabs.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === activeTab);
    });
    body.innerHTML = "";
    const groups = groupSessionsByDay(filtered());
    if (!groups.length) {
      body.appendChild(h("p", { class: "body-s", style: "color: var(--ink-mute); text-align:center; padding: 32px 0;" },
        "No sessions in this range."));
      return;
    }
    for (const g of groups) {
      const dayVol = g.sessions.reduce(
        (sum, s) => sum + sets.filter((x) => x.sessionId === s.id).reduce((a, x) => a + setVolume(x), 0), 0
      );
      const block = h("section", { class: "day-group" }, [
        h("div", { class: "day-head" }, [
          h("div", { class: "date" }, fmtDay(g.dayMs)),
          h("div", { class: "vol mono" }, `${fmtVolume(dayVol)} kg`)
        ]),
        ...g.sessions.map((s) => {
          const ssets = sets.filter((x) => x.sessionId === s.id);
          // Group this session's sets by exercise (preserving first-seen order).
          const orderedIds = [];
          const seen = new Set();
          for (const x of ssets.slice().sort((a, b) => a.completedAt - b.completedAt)) {
            if (!seen.has(x.exerciseId)) { orderedIds.push(x.exerciseId); seen.add(x.exerciseId); }
          }
          const sessionVol = ssets.reduce((sum, x) => sum + setVolume(x), 0);
          const exerciseBlocks = orderedIds.map((eid) => {
            const ex = exById.get(eid);
            const exSets = ssets.filter((x) => x.exerciseId === eid).sort((a, b) => a.round - b.round);
            const lines = exSets.map((set) => h("div", { class: "ex-line" }, [
              h("span", {}, `${set.setType === "bilateral" ? "R" : "S"}${set.round}`),
              h("span", {}, `${set.weight ? `${set.weight}kg × ` : ""}${set.reps}${set.setType === "bilateral" ? " /side" : ""}`)
            ]));
            return h("div", { style: "margin-top: 8px" }, [
              h("div", { class: "row-between" }, [
                h("div", { style: "font-weight:600; font-size: 14px" }, ex?.name ?? "Exercise"),
                h("div", { class: "mono", style: "font-size:11px; color: var(--ink-mute)" },
                  `${fmtVolume(exSets.reduce((a, x) => a + setVolume(x), 0))} kg`)
              ]),
              h("div", { style: "margin-top: 4px" }, lines)
            ]);
          });
          return h("a", { class: "session-card", href: `#/summary/${s.id}` }, [
            h("div", { class: "row-between" }, [
              h("div", { style: "font-weight:600" }, `Session · ${fmtTime(s.startedAt)}`),
              h("div", { class: "mono", style: "font-size:12px; color: var(--ink-mute)" },
                `${orderedIds.length} ex · ${fmtVolume(sessionVol)} kg`)
            ]),
            ...exerciseBlocks
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
