import { getExercise, setsForExercise, getProfile, latestWeight } from "../db/repo.js";
import { bestE1RM, scoreLift } from "../domain/scoring.js";
import { setVolume } from "../domain/volume.js";
import { h, eyebrow, badge, fmtKg, fmtVolume, fmtDate, fmtAge } from "../ui/components.js";

export async function ExerciseDetailView(params, root) {
  const id = Number(params.id);
  const ex = await getExercise(id);
  if (!ex) {
    root.appendChild(h("p", {}, "Exercise not found."));
    return;
  }
  const [sets, profile, lw] = await Promise.all([
    setsForExercise(id), getProfile(), latestWeight()
  ]);

  const e1rm = bestE1RM(sets);
  const score = scoreLift({
    standardKey: ex.standardKey,
    sex: profile?.sex,
    bodyweightKg: lw?.kg,
    e1rm
  });

  const head = h("div", { class: "page-head" }, [
    h("a", { href: "#/exercises", class: "eyebrow" }, "← Lifts"),
    h("h1", { class: "display-l" }, ex.name)
  ]);

  // Estimated 1RM card
  const oneRm = h("div", { class: "card card-dark stack-sm" }, [
    eyebrow("Estimated 1RM"),
    h("div", { class: "display-xl mono" }, e1rm ? fmtKg(e1rm) : "—"),
    score.unavailable
      ? badge("No benchmark available", "")
      : h("div", { class: "row" }, [
          badge(score.level, "badge-brass"),
          h("span", { class: "mono", style: "color: rgba(250,246,236,0.7); font-size: 13px;" },
            score.nextLevel
              ? `${score.percentile}th pct · ${fmtKg(score.kgToNext)} to ${score.nextLevel}`
              : `${score.percentile}th pct`)
        ])
  ]);

  // History rows (last 10 sets desc)
  const recent = [...sets].sort((a, b) => b.completedAt - a.completedAt).slice(0, 10);
  const rows = h("div", { class: "stack-sm" }, recent.map((s) => h("div", { class: "card card-tight row-between" }, [
    h("div", {}, [
      h("div", { class: "body", style: "font-weight:600" }, `${fmtKg(s.weight)} × ${s.reps}${s.setType === "bilateral" ? " /side" : ""}`),
      h("div", { class: "mono", style: "font-size:11px; color: var(--ink-mute)" }, `Round ${s.round} · ${fmtDate(s.completedAt)}`)
    ]),
    h("div", { class: "mono", style: "font-size:13px; color: var(--ink-soft)" }, `${fmtVolume(setVolume(s))} kg`)
  ])));

  const cta = h("a", { href: `#/session/new/${ex.id}`, class: "btn btn-primary btn-block btn-lg" }, "Start session");

  root.appendChild(head);
  root.appendChild(h("div", { class: "stack" }, [oneRm, cta]));
  root.appendChild(h("div", { style: "height:24px" }));
  root.appendChild(eyebrow("Recent sets"));
  root.appendChild(h("div", { style: "height:8px" }));
  root.appendChild(recent.length ? rows : h("p", { class: "body-s", style: "color: var(--ink-mute)" }, "No sets yet."));
}
