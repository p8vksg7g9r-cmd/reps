import { allSessions, allSets, listExercises, deleteExerciseFromSession, deleteSession } from "../db/repo.js";
import { groupSessionsByDay, startOfIsoWeek, startOfMonth } from "../domain/week.js";
import { setVolume, isCardioSetType } from "../domain/volume.js";
import { h, eyebrow, fmtVolume, fmtDay, fmtTime, iconPencil, iconTrash, cardioMetricsLine } from "../ui/components.js";

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

  // We re-fetch on every redraw so deletions are reflected immediately.
  async function loadAndRender() {
    const [sessions, allSetsRaw, exercises] = await Promise.all([allSessions(), allSets(), listExercises()]);
    const sets = allSetsRaw.filter((s) => s.reps != null);
    const exById = new Map(exercises.map((e) => [e.id, e]));

    function filtered() {
      const now = Date.now();
      if (activeTab === "week")  return sessions.filter((s) => s.startedAt >= startOfIsoWeek(now));
      if (activeTab === "month") return sessions.filter((s) => s.startedAt >= startOfMonth(now));
      return sessions;
    }

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
          h("div", { class: "vol mono" }, fmtVolume(dayVol))
        ]),
        ...g.sessions.map((s) => buildSessionCard(s, sets, exById))
      ]);
      body.appendChild(block);
    }
  }

  function buildSessionCard(session, sets, exById) {
    const ssets = sets.filter((x) => x.sessionId === session.id);
    // First-seen order of exercises within the session.
    const orderedIds = [];
    const seen = new Set();
    for (const x of ssets.slice().sort((a, b) => a.completedAt - b.completedAt)) {
      if (!seen.has(x.exerciseId)) { orderedIds.push(x.exerciseId); seen.add(x.exerciseId); }
    }
    const sessionVol = ssets.reduce((sum, x) => sum + setVolume(x), 0);

    const card = h("div", { class: "session-card" });
    const delSession = h("button", { class: "icon-btn danger", "aria-label": "Delete this session",
      onclick: async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const summary = orderedIds.length === 0
          ? "Delete this empty session?"
          : `Delete this entire session and all ${orderedIds.length} exercise${orderedIds.length === 1 ? "" : "s"}? This cannot be undone.`;
        if (!confirm(summary)) return;
        await deleteSession(session.id);
        await loadAndRender();
      }
    }, [iconTrash()]);
    // The link covers the title + meta; the trash button sits beside it so a
    // tap on the button doesn't also navigate to the summary screen.
    const header = h("div", { style: "display:flex; align-items:center; gap:8px" }, [
      h("a", { href: `#/summary/${session.id}`, style: "flex:1; display:flex; justify-content:space-between; align-items:center; min-width:0" }, [
        h("div", { style: "font-weight:600" }, `Session · ${fmtTime(session.startedAt)}`),
        h("div", { class: "mono", style: "font-size:12px; color: var(--ink-mute)" },
          `${orderedIds.length} ex${sessionVol > 0 ? ` · ${fmtVolume(sessionVol)}` : ""}`)
      ]),
      delSession
    ]);
    card.appendChild(header);

    if (orderedIds.length === 0) {
      card.appendChild(h("div", { class: "ex-block" }, [
        h("div", { class: "body-s", style: "color: var(--ink-mute)" }, "No sets logged in this session.")
      ]));
      return card;
    }

    for (const eid of orderedIds) {
      const ex = exById.get(eid);
      const exSets = ssets.filter((x) => x.exerciseId === eid).sort((a, b) => a.round - b.round);
      const exVol = exSets.reduce((a, x) => a + setVolume(x), 0);

      const editBtn = h("button", { class: "icon-btn", "aria-label": `Edit ${ex?.name ?? "exercise"}`,
        onclick: () => { location.hash = `#/edit-exercise/${session.id}/${eid}`; }
      }, [iconPencil()]);

      const delBtn = h("button", { class: "icon-btn danger", "aria-label": `Delete ${ex?.name ?? "exercise"} from this session`,
        onclick: async () => {
          if (!confirm("Delete this exercise from the session? This cannot be undone.")) return;
          await deleteExerciseFromSession(session.id, eid);
          await loadAndRender();
        }
      }, [iconTrash()]);

      const isCardio = exSets[0] && isCardioSetType(exSets[0].setType);
      const lines = isCardio
        ? exSets.map((set) => h("div", { class: "ex-line" }, [
            h("span", {}, "—"),
            h("span", {}, cardioMetricsLine(set))
          ]))
        : exSets.map((set) => h("div", { class: "ex-line" }, [
            h("span", {}, `${set.setType === "bilateral" ? "R" : "S"}${set.round}`),
            h("span", {}, `${set.weight ? `${set.weight}kg × ` : ""}${set.reps}${set.setType === "bilateral" ? " /side" : ""}`)
          ]));

      card.appendChild(h("div", { class: "ex-block" }, [
        h("div", { class: "ex-head" }, [
          h("div", { class: "name" }, ex?.name ?? "Exercise (deleted)"),
          h("div", { class: "actions" }, [
            isCardio ? null : h("span", { class: "vol" }, fmtVolume(exVol)),
            editBtn,
            delBtn
          ].filter(Boolean))
        ]),
        h("div", { style: "margin-top: 6px" }, lines)
      ]));
    }
    return card;
  }

  function redraw() { loadAndRender(); }

  root.appendChild(head);
  root.appendChild(tabs);
  root.appendChild(h("div", { style: "height:16px" }));
  root.appendChild(body);
  redraw();
}
