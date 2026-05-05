import { getSession, setsForSession, getExercise } from "../db/repo.js";
import { setVolume } from "../domain/volume.js";
import { h, eyebrow, fmtDay, fmtVolume } from "../ui/components.js";
import { shareOrDownloadBackup } from "../ui/share.js";

function fmtDuration(ms) {
  if (!ms || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export async function SessionSummaryView(params, root) {
  const sessionId = Number(params.sessionId);
  const session = await getSession(sessionId);
  if (!session) {
    root.appendChild(h("p", {}, "Session not found."));
    return;
  }

  const sets = (await setsForSession(sessionId)).filter((s) => s.reps != null);
  const exerciseIds = [...new Set(sets.map((s) => s.exerciseId))];
  const exercises = await Promise.all(exerciseIds.map((id) => getExercise(id)));
  const exById = new Map(exercises.filter(Boolean).map((e) => [e.id, e]));

  const totalVolume = sets.reduce((sum, s) => sum + setVolume(s), 0);
  const totalReps = sets.reduce((sum, s) => sum + (Number(s.reps) || 0), 0);
  const duration = session.endedAt ? session.endedAt - session.startedAt : null;

  const head = h("div", { class: "page-head" }, [
    eyebrow("Session summary"),
    h("h1", { class: "display-l" }, fmtDay(session.startedAt))
  ]);

  const meta = h("div", { class: "card stack-sm" }, [
    h("div", { class: "row-between mono", style: "font-size: 13px" }, [
      h("span", { style: "color: var(--ink-mute)" }, "Started"),
      h("span", {}, fmtTime(session.startedAt))
    ]),
    session.endedAt ? h("div", { class: "row-between mono", style: "font-size: 13px" }, [
      h("span", { style: "color: var(--ink-mute)" }, "Ended"),
      h("span", {}, fmtTime(session.endedAt))
    ]) : null,
    h("div", { class: "row-between mono", style: "font-size: 13px" }, [
      h("span", { style: "color: var(--ink-mute)" }, "Duration"),
      h("span", {}, fmtDuration(duration))
    ])
  ].filter(Boolean));

  const totals = h("div", { class: "grid-2" }, [
    h("div", { class: "stat" }, [
      h("div", { class: "label" }, "Total volume"),
      h("div", { class: "value mono" }, fmtVolume(totalVolume))
    ]),
    h("div", { class: "stat" }, [
      h("div", { class: "label" }, "Total reps"),
      h("div", { class: "value mono" }, String(totalReps))
    ])
  ]);

  // Per-exercise breakdown (in the order they were first performed in the session).
  const orderedIds = [];
  const seen = new Set();
  for (const s of sets.sort((a, b) => a.completedAt - b.completedAt)) {
    if (!seen.has(s.exerciseId)) { orderedIds.push(s.exerciseId); seen.add(s.exerciseId); }
  }

  const exerciseBlocks = orderedIds.map((eid) => {
    const ex = exById.get(eid);
    const exSets = sets
      .filter((s) => s.exerciseId === eid)
      .sort((a, b) => a.round - b.round);
    const vol = exSets.reduce((sum, s) => sum + setVolume(s), 0);
    const setLines = exSets.map((s) => h("div", { class: "ex-line" }, [
      h("span", {}, `${s.setType === "bilateral" ? "Round" : "Set"} ${s.round}`),
      h("span", {}, `${s.weight ? `${s.weight}kg × ` : ""}${s.reps}${s.setType === "bilateral" ? " /side" : ""}`)
    ]));
    return h("div", { class: "card stack-sm" }, [
      h("div", { class: "row-between" }, [
        h("div", { style: "font-family: var(--font-display); font-weight: 700; font-size: 16px" }, ex?.name ?? "Exercise"),
        h("span", { class: "badge badge-brass mono" }, fmtVolume(vol))
      ]),
      h("div", {}, setLines)
    ]);
  });

  const exerciseHeader = h("div", { style: "display:flex; justify-content:space-between; align-items:baseline" }, [
    eyebrow(`Exercises · ${orderedIds.length}`),
    h("span", { class: "mono", style: "font-size:11px; color: var(--ink-mute)" }, `${sets.length} sets logged`)
  ]);

  const cta = h("a", { href: "#/home", class: "btn btn-primary btn-block btn-lg" }, "Back to home");

  const backupBtn = h("button", { class: "btn btn-ghost btn-block btn-lg" }, "Backup");
  backupBtn.addEventListener("click", async () => {
    backupBtn.disabled = true;
    const original = backupBtn.textContent;
    backupBtn.textContent = "Preparing…";
    try {
      const result = await shareOrDownloadBackup();
      backupBtn.textContent = result === "downloaded" ? "Downloaded" : result === "shared" ? "Shared" : original;
      setTimeout(() => { backupBtn.textContent = original; backupBtn.disabled = false; }, 1600);
    } catch (err) {
      backupBtn.textContent = "Backup failed";
      console.error(err);
      setTimeout(() => { backupBtn.textContent = original; backupBtn.disabled = false; }, 2000);
    }
  });

  root.appendChild(head);
  root.appendChild(h("div", { class: "stack" }, [meta, totals]));
  if (exerciseBlocks.length === 0) {
    root.appendChild(h("div", { style: "height: 24px" }));
    root.appendChild(h("p", { class: "body-s", style: "color: var(--ink-mute); text-align: center" },
      "No sets were logged in this session."));
  } else {
    root.appendChild(h("div", { style: "height: 24px" }));
    root.appendChild(exerciseHeader);
    root.appendChild(h("div", { style: "height: 8px" }));
    root.appendChild(h("div", { class: "stack" }, exerciseBlocks));
  }
  root.appendChild(h("div", { style: "height: 32px" }));
  root.appendChild(h("div", { class: "stack-sm" }, [cta, backupBtn]));
}
