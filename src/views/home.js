import { allSessions, allSets, listExercises, latestWeight, getOpenSession, endSession } from "../db/repo.js";
import { weeklySummary, startOfIsoWeek, aggregate } from "../domain/week.js";
import { setVolume } from "../domain/volume.js";
import {
  h, eyebrow, stat, fmtVolume, fmtDelta, fmtMeters, fmtHoursMinutes,
  isStandalonePWA, openSessionBanner
} from "../ui/components.js";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const WEEK_MS  = 7 * 24 * 60 * 60 * 1000;

export async function HomeView(_params, root) {
  const [sessions, sets, exercises, lastWeight, openSession] = await Promise.all([
    allSessions(), allSets(), listExercises(), latestWeight(), getOpenSession()
  ]);

  const summary = weeklySummary({ sessions, sets });
  const { current, delta } = summary;

  const head = h("div", { class: "page-head" }, [
    eyebrow("Week so far"),
    h("h1", { class: "display-l" }, "REPS")
  ]);

  // Open-session banner takes precedence over the weight reminder.
  let topBanner = null;
  if (openSession) {
    const sessionSets = sets.filter((s) => s.sessionId === openSession.id && s.reps != null);
    topBanner = openSessionBanner({ openSession, sessionSets, variant: "home", endSession });
  } else if (!lastWeight) {
    topBanner = h("div", { class: "banner" }, [
      h("span", {}, "Log your first weight"),
      h("button", { onclick: () => location.hash = "#/profile" }, "Add")
    ]);
  } else if (Date.now() - lastWeight.loggedAt > MONTH_MS) {
    topBanner = h("div", { class: "banner" }, [
      h("span", {}, "Time to log a fresh weight"),
      h("button", { onclick: () => location.hash = "#/profile" }, "Log")
    ]);
  }

  /* ---------------- Lifts card ---------------- */

  const grid = h("div", { class: "grid-2" }, [
    stat({
      label: "Sessions",
      value: String(current.sessions),
      delta: delta.sessions === 0 ? "no change" : fmtDelta(delta.sessions)
    }),
    stat({
      label: "Exercises",
      value: String(current.exercises),
      delta: delta.exercises === 0 ? "no change" : fmtDelta(delta.exercises)
    })
  ]);

  const volStat = stat({
    label: "Total volume",
    value: fmtVolume(current.volume),
    delta: delta.volume === 0 ? "no change" : fmtDelta(Math.round(delta.volume), " kg")
  });

  // Training load = weekly volume / latest bodyweight (bodyweight multiples).
  // A constant latest-bw is applied to every week — the user's actual weight
  // shifts week to week, but using one anchor keeps the curve a pure rescale
  // of the volume series rather than mixing two signals.
  const bw = lastWeight?.kg && lastWeight.kg > 0 ? lastWeight.kg : null;
  const loadSeries = weeklyLoadSeries({ sessions, sets, bw, weeks: 8 });
  const loadStat = buildLoadCard({ series: loadSeries, bw });

  const liftsSection = h("section", { class: "stack" }, [
    h("div", { class: "section-eyebrow" }, "Lifts · this week"),
    grid, volStat, loadStat
  ]);

  /* ---------------- Cardio card (conditional) ---------------- */

  // Same 8-week window as the lifts load card. The card renders iff there's
  // at least one cardio set somewhere in that window — a week off still keeps
  // the trend visible so the user can see they've been off.
  const cardioSeries = weeklyCardioSeries({ sessions, sets, weeks: 8 });
  const cardioCard = buildCardioCard({ series: cardioSeries });

  /* ---------------- Bike efficiency card (conditional) ---------------- */

  // EF = avgPower / avgHR. One bar per qualifying bike session over the last
  // 16 weeks. Sessions count only if the bike set(s) total at least 45 min —
  // shorter sessions are usually warm-ups or test rides, not training, and
  // their EF reads noisy.
  const bikeEFCardSeries = bikeEFSeries({
    sessions, sets,
    minDurationSec: 45 * 60,
    windowMs: 16 * WEEK_MS
  });
  const bikeEFCard = buildBikeEFCard({ series: bikeEFCardSeries });

  /* ---------------- CTA + recent ---------------- */

  const ctaLabel = openSession ? "Add an exercise to this session" : "Start a session";
  const cta = h("a", { href: "#/exercises", class: "btn btn-primary btn-block btn-lg" }, ctaLabel);

  // Recent: last 3 closed sessions.
  const closed = sessions.filter((s) => s.endedAt != null).sort((a, b) => b.startedAt - a.startedAt).slice(0, 3);
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const recentSection = closed.length ? h("section", { class: "stack" }, [
    eyebrow("Recent sessions"),
    ...closed.map((s) => {
      const ssets = sets.filter((x) => x.sessionId === s.id && x.reps != null);
      const vol = ssets.reduce((sum, x) => sum + setVolume(x), 0);
      const names = [...new Set(ssets.map((x) => exById.get(x.exerciseId)?.name).filter(Boolean))];
      const subtitle = names.length === 0 ? "no sets logged" :
                       names.length <= 2 ? names.join(" · ") :
                       `${names.slice(0, 2).join(" · ")} +${names.length - 2}`;
      return h("a", { class: "ex-row", href: `#/summary/${s.id}` }, [
        h("div", { class: "meta" }, [
          h("div", { class: "name" }, new Date(s.startedAt).toLocaleDateString()),
          h("div", { class: "sub" }, vol > 0 ? `${subtitle} · ${fmtVolume(vol)}` : subtitle)
        ])
      ]);
    })
  ]) : null;

  /* ---------------- Layout ---------------- */

  root.appendChild(head);

  if (!isStandalonePWA()) {
    root.appendChild(h("div", { class: "card card-amber" }, [
      h("div", { class: "eyebrow" }, "Add to Home Screen"),
      h("p", { class: "body", style: "margin: 6px 0 0; font-weight: 600" },
        "For best experience and to preserve your data, add this app to your home screen."),
      h("p", { class: "body-s", style: "margin: 4px 0 0" },
        "Data stored in Safari browser is separate from the home-screen app.")
    ]));
  }

  if (topBanner) root.appendChild(topBanner);

  const summaryStack = [liftsSection];
  if (cardioCard) summaryStack.push(cardioCard);
  if (bikeEFCard) summaryStack.push(bikeEFCard);
  summaryStack.push(cta);
  root.appendChild(h("div", { class: "stack-lg" }, summaryStack));

  if (recentSection) {
    root.appendChild(h("div", { style: "height: 24px" }));
    root.appendChild(recentSection);
  }
}

/* ----------------------------------------------------------------- */

/**
 * Eight weekly buckets ending with the current ISO week. Each entry is
 *   { weekStart, volume, load }
 * where load = volume / bw, or null when bw is missing. Oldest → newest so
 * the sparkline reads left-to-right.
 */
function weeklyLoadSeries({ sessions, sets, bw, weeks }) {
  const thisStart = startOfIsoWeek(Date.now());
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = thisStart - i * WEEK_MS;
    const agg = aggregate({ sessions, sets, start, end: start + WEEK_MS });
    out.push({
      weekStart: start,
      volume: agg.volume,
      load: bw ? agg.volume / bw : null
    });
  }
  return out;
}

/** Stat-shaped card carrying the current week's load + an 8-week trend
 *  sparkline. Falls back to text if there's no bodyweight on file or fewer
 *  than two populated weeks to draw a meaningful curve. */
function buildLoadCard({ series, bw }) {
  const current = series[series.length - 1];
  const prev = series[series.length - 2];
  const headline = bw && current?.load != null ? `${Math.round(current.load)}× BW` : "—";

  // Week-over-week arrow as a tiny anchor for the headline.
  let arrow = "";
  if (bw && current?.load != null && prev?.load != null) {
    const diff = current.load - prev.load;
    arrow = diff > 0.5 ? " ↑" : diff < -0.5 ? " ↓" : " →";
  }

  const children = [
    h("div", { class: "label" }, "Training load · weekly"),
    h("div", { class: "value mono" }, `${headline}${arrow}`)
  ];

  if (bw == null) {
    children.push(h("div", { class: "delta" }, "Log a bodyweight to track this"));
  } else {
    const populated = series.filter((w) => w.volume > 0).length;
    if (populated < 2) {
      children.push(h("div", { class: "delta" }, "Trend appears after multiple training weeks"));
    } else {
      children.push(renderLoadSparkline(series));
      children.push(h("div", { class: "delta" }, `${series.length}-week trend · this week on the right`));
    }
  }

  return h("div", { class: "stat load-card" }, children);
}

/** Minimal SVG sparkline: filled area + line + emphasized last point.
 *  preserveAspectRatio="xMidYMid meet" keeps the dot circular as the SVG
 *  scales to the card width. */
function renderLoadSparkline(series) {
  const W = 320, H = 70, P_X = 6, P_TOP = 8, P_BOTTOM = 6;
  const n = series.length;
  const loads = series.map((w) => w.load || 0);
  const lmax = Math.max(...loads, 1);
  const xFor = (i) => P_X + (i * (W - 2 * P_X)) / Math.max(1, n - 1);
  const yFor = (v) => P_TOP + (H - P_TOP - P_BOTTOM) * (1 - v / lmax);

  const linePoints = series
    .map((_, i) => `${xFor(i).toFixed(1)},${yFor(loads[i]).toFixed(1)}`)
    .join(" ");
  const areaPath = [
    `M ${xFor(0).toFixed(1)} ${(H - P_BOTTOM).toFixed(1)}`,
    ...series.map((_, i) => `L ${xFor(i).toFixed(1)} ${yFor(loads[i]).toFixed(1)}`),
    `L ${xFor(n - 1).toFixed(1)} ${(H - P_BOTTOM).toFixed(1)}`,
    "Z"
  ].join(" ");

  const lastX = xFor(n - 1);
  const lastY = yFor(loads[n - 1]);

  const svg = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" class="load-spark" role="img" aria-label="Weekly training-load trend, last ${n} weeks">
      <line x1="${P_X}" y1="${(H - P_BOTTOM).toFixed(1)}" x2="${(W - P_X).toFixed(1)}" y2="${(H - P_BOTTOM).toFixed(1)}" stroke="rgba(15,35,64,0.10)"/>
      <path d="${areaPath}" fill="rgba(217,122,79,0.18)"/>
      <polyline points="${linePoints}" fill="none" stroke="var(--terracotta)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3.5" fill="var(--terracotta)"/>
    </svg>`;
  const wrap = document.createElement("div");
  wrap.innerHTML = svg.trim();
  return wrap.firstElementChild;
}

/**
 * Per-week cardio totals over the last `weeks` ISO weeks. Each entry:
 *   { weekStart, swimMeters, bikeSeconds }
 * Returned oldest → newest so the resulting chart reads left to right.
 */
function weeklyCardioSeries({ sessions, sets, weeks }) {
  const thisStart = startOfIsoWeek(Date.now());
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = thisStart - i * WEEK_MS;
    const end = start + WEEK_MS;
    const sessionIds = new Set(
      sessions.filter((s) => s.startedAt >= start && s.startedAt < end).map((s) => s.id)
    );
    const ws = sets.filter((s) => sessionIds.has(s.sessionId) && s.reps != null);
    const swimMeters = ws
      .filter((s) => s.setType === "cardio_swim")
      .reduce((sum, s) => sum + (Number(s.metrics?.distanceM) || 0), 0);
    const bikeSeconds = ws
      .filter((s) => s.setType === "cardio_bike")
      .reduce((sum, s) => sum + (Number(s.metrics?.durationSec) || 0), 0);
    out.push({ weekStart: start, swimMeters, bikeSeconds });
  }
  return out;
}

/**
 * Per-session Efficiency Factor for stationary bike workouts that lasted at
 * least `minDurationSec` (sum of bike set durations within the session).
 * Returns oldest → newest within the given trailing window. Sets missing
 * either avgPowerW or avgHrBpm are skipped — a session keeps qualifying as
 * long as some set has both, plus enough total duration.
 *
 * Aggregation uses duration-weighted means so a hypothetical multi-set
 * session aggregates honestly; the typical single-set case collapses to
 * just that set's values.
 */
function bikeEFSeries({ sessions, sets, minDurationSec, windowMs }) {
  const cutoff = Date.now() - windowMs;
  const recentSessions = sessions
    .filter((s) => s.startedAt >= cutoff)
    .sort((a, b) => a.startedAt - b.startedAt);

  const out = [];
  for (const s of recentSessions) {
    const bikeSets = sets.filter(
      (x) => x.sessionId === s.id &&
             x.setType === "cardio_bike" &&
             x.reps != null &&
             Number(x.metrics?.avgPowerW)   > 0 &&
             Number(x.metrics?.avgHrBpm)    > 0 &&
             Number(x.metrics?.durationSec) > 0
    );
    if (!bikeSets.length) continue;
    const totalDur = bikeSets.reduce((sum, x) => sum + Number(x.metrics.durationSec), 0);
    if (totalDur < minDurationSec) continue;
    const wPower = bikeSets.reduce((sum, x) => sum + Number(x.metrics.avgPowerW) * Number(x.metrics.durationSec), 0) / totalDur;
    const wHr    = bikeSets.reduce((sum, x) => sum + Number(x.metrics.avgHrBpm)  * Number(x.metrics.durationSec), 0) / totalDur;
    if (!(wHr > 0)) continue;
    out.push({
      sessionId: s.id,
      startedAt: s.startedAt,
      ef: wPower / wHr,
      durationSec: totalDur
    });
  }
  return out;
}

/** Card wrapper for the EF bar chart. Hidden entirely if no qualifying
 *  session exists in the window — keeps a brand-new user's Home tidy. */
function buildBikeEFCard({ series }) {
  if (!series.length) return null;
  const latest = series[series.length - 1];
  const prev = series.length >= 2 ? series[series.length - 2] : null;

  let arrow = "";
  if (prev) {
    const diff = latest.ef - prev.ef;
    arrow = diff > 0.02 ? " ↑" : diff < -0.02 ? " ↓" : " →";
  }

  const legend = h("div", { class: "trend-legend" }, [
    h("span", { class: "row" }, [
      h("span", { class: "dot dot-ef" }),
      h("span", { class: "mono" }, `Latest EF · ${latest.ef.toFixed(2)} W/bpm${arrow}`)
    ])
  ]);

  const children = [
    h("div", { class: "section-eyebrow" }, "Bike efficiency · 45 min+ sessions")
  ];
  if (series.length >= 2) {
    children.push(renderBikeEFChart(series));
  } else {
    children.push(h("p", {
      class: "body-s",
      style: "color: var(--ink-mute); text-align:center; margin: 8px 0"
    }, "First qualifying session logged — trend appears next time."));
  }
  children.push(legend);

  return h("div", { class: "card stack-sm ef-card" }, children);
}

/** Bar chart, one rect per session. The most recent bar is filled with the
 *  brand accent so the eye lands on it. Earlier bars are brass (matching the
 *  bike line in the cardio sparkline above) so the two charts read as the
 *  same activity. */
function renderBikeEFChart(series) {
  const W = 320, H = 90, P_X = 8, P_TOP = 14, P_BOTTOM = 10;
  const n = series.length;
  const efs = series.map((s) => s.ef);
  const eMax = Math.max(...efs, 0.1);

  const availW = W - 2 * P_X;
  const gap = n > 1 ? Math.min(3, availW * 0.04) : 0;
  const barW = (availW - gap * Math.max(0, n - 1)) / Math.max(1, n);
  const baseY = H - P_BOTTOM;

  const yFor = (v) => P_TOP + (baseY - P_TOP) * (1 - v / eMax);
  const xFor = (i) => P_X + i * (barW + gap);

  const bars = series.map((s, i) => {
    const y = yFor(s.ef);
    const fill = i === n - 1 ? "var(--terracotta)" : "var(--brass)";
    return `<rect x="${xFor(i).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${(baseY - y).toFixed(1)}" fill="${fill}" rx="1.5"/>`;
  }).join("");

  // Faint reference line at the latest EF so the trend reads "above / below
  // current" at a glance.
  const latestY = yFor(efs[n - 1]);
  const refLine = `<line x1="${P_X}" y1="${latestY.toFixed(1)}" x2="${(W - P_X).toFixed(1)}" y2="${latestY.toFixed(1)}" stroke="rgba(217,122,79,0.30)" stroke-dasharray="3 3"/>`;

  const svg = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" class="ef-chart" role="img" aria-label="Bike efficiency factor for the last ${n} qualifying sessions">
      <line x1="${P_X}" y1="${baseY.toFixed(1)}" x2="${(W - P_X).toFixed(1)}" y2="${baseY.toFixed(1)}" stroke="rgba(15,35,64,0.10)"/>
      ${refLine}
      ${bars}
    </svg>`;
  const wrap = document.createElement("div");
  wrap.innerHTML = svg.trim();
  return wrap.firstElementChild;
}

/** Two-line sparkline of swim distance + bike time. Returns null when the
 *  user has done no cardio in the 8-week window so the home layout drops
 *  the card entirely instead of showing an empty placeholder. */
function buildCardioCard({ series }) {
  const haveSwim = series.some((w) => w.swimMeters > 0);
  const haveBike = series.some((w) => w.bikeSeconds > 0);
  if (!haveSwim && !haveBike) return null;

  const populatedWeeks = series.filter((w) => w.swimMeters > 0 || w.bikeSeconds > 0).length;
  const current = series[series.length - 1];

  const legend = h("div", { class: "trend-legend" }, [
    haveSwim ? h("span", { class: "row" }, [
      h("span", { class: "dot dot-swim" }),
      h("span", { class: "mono" }, `Swim · ${fmtMeters(current.swimMeters)}`)
    ]) : null,
    haveBike ? h("span", { class: "row" }, [
      h("span", { class: "dot dot-bike" }),
      h("span", { class: "mono" }, `Bike · ${fmtHoursMinutes(current.bikeSeconds)}`)
    ]) : null
  ].filter(Boolean));

  const children = [h("div", { class: "section-eyebrow" }, "Cardio · 8-week trend")];

  if (populatedWeeks >= 2) {
    children.push(renderCardioSparkline(series, { haveSwim, haveBike }));
  } else {
    children.push(h("p", {
      class: "body-s",
      style: "color: var(--ink-mute); text-align:center; margin: 8px 0"
    }, "Trend appears after multiple weeks of cardio."));
  }
  children.push(legend);

  return h("div", { class: "card stack-sm cardio-trend" }, children);
}

/** Each series gets its own y-scale so distance (meters) and duration
 *  (seconds) both fill the height — the chart compares trend shape, not
 *  absolute magnitude. */
function renderCardioSparkline(series, { haveSwim, haveBike }) {
  const W = 320, H = 90, P_X = 8, P_TOP = 10, P_BOTTOM = 8;
  const n = series.length;
  const swim = series.map((w) => w.swimMeters);
  const bike = series.map((w) => w.bikeSeconds);
  const sMax = Math.max(...swim, 1);
  const bMax = Math.max(...bike, 1);

  const xFor = (i) => P_X + (i * (W - 2 * P_X)) / Math.max(1, n - 1);
  const yFor = (v, max) => P_TOP + (H - P_TOP - P_BOTTOM) * (1 - v / max);

  const pathFor = (vals, max) => vals
    .map((v, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(v, max).toFixed(1)}`)
    .join(" ");

  const swimPath = haveSwim ? `<path d="${pathFor(swim, sMax)}" fill="none" stroke="var(--sage)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : "";
  const bikePath = haveBike ? `<path d="${pathFor(bike, bMax)}" fill="none" stroke="var(--brass)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : "";
  const swimDot = haveSwim ? `<circle cx="${xFor(n - 1).toFixed(1)}" cy="${yFor(swim[n - 1], sMax).toFixed(1)}" r="3.5" fill="var(--sage)"/>` : "";
  const bikeDot = haveBike ? `<circle cx="${xFor(n - 1).toFixed(1)}" cy="${yFor(bike[n - 1], bMax).toFixed(1)}" r="3.5" fill="var(--brass)"/>` : "";

  const svg = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" class="cardio-spark" role="img" aria-label="Weekly cardio trend, last ${n} weeks">
      <line x1="${P_X}" y1="${(H - P_BOTTOM).toFixed(1)}" x2="${(W - P_X).toFixed(1)}" y2="${(H - P_BOTTOM).toFixed(1)}" stroke="rgba(15,35,64,0.10)"/>
      ${swimPath}
      ${bikePath}
      ${swimDot}
      ${bikeDot}
    </svg>`;
  const wrap = document.createElement("div");
  wrap.innerHTML = svg.trim();
  return wrap.firstElementChild;
}
