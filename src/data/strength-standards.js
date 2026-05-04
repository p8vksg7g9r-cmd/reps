// Strength Level percentile reference tables.
//
// ⚠️ PLACEHOLDER VALUES — these are approximate, derived from public training
// norms for the listed movements. They give the app a working scoring system
// out of the box, but the user has flagged that they will replace this file
// with verified values from strengthlevel.com later.
//
// SCHEMA:
//   STANDARDS[key][sex] = sorted-by-bodyweight rows, each:
//     { bw, beg, nov, int, adv, eli }   // thresholds in kg for estimated 1RM
//   Lookup interpolates linearly between the two bracketing bodyweight rows.
//   For a 1RM r:
//     r < beg              → "Untrained"
//     beg ≤ r < nov        → "Beginner"
//     nov ≤ r < int        → "Novice"
//     int ≤ r < adv        → "Intermediate"
//     adv ≤ r < eli        → "Advanced"
//     r ≥ eli              → "Elite"
//
// NOTE on dumbbells: thresholds are PER DUMBBELL (one hand) for standing DB
// press, lateral raise, DB curl, triceps extension — matching strengthlevel.com.
//
// To replace with verified data: keep the schema, swap the numbers.

export const LEVELS = ["Untrained", "Beginner", "Novice", "Intermediate", "Advanced", "Elite"];

export const STANDARDS = {
  // ---------- back ----------
  lat_pulldown: {
    male: [
      { bw: 60, beg: 32, nov: 50, int: 72, adv: 98, eli: 128 },
      { bw: 70, beg: 38, nov: 58, int: 82, adv: 110, eli: 142 },
      { bw: 80, beg: 44, nov: 65, int: 91, adv: 121, eli: 155 },
      { bw: 90, beg: 49, nov: 71, int: 99, adv: 131, eli: 167 },
      { bw: 100, beg: 54, nov: 77, int: 106, adv: 140, eli: 178 },
      { bw: 110, beg: 58, nov: 82, int: 113, adv: 148, eli: 188 }
    ],
    female: [
      { bw: 50, beg: 16, nov: 26, int: 40, adv: 58, eli: 80 },
      { bw: 60, beg: 19, nov: 30, int: 46, adv: 65, eli: 88 },
      { bw: 70, beg: 22, nov: 34, int: 51, adv: 71, eli: 95 },
      { bw: 80, beg: 25, nov: 38, int: 56, adv: 77, eli: 102 },
      { bw: 90, beg: 27, nov: 41, int: 60, adv: 82, eli: 108 }
    ]
  },

  chest_supported_row: {
    male: [
      { bw: 60, beg: 28, nov: 45, int: 66, adv: 92, eli: 122 },
      { bw: 70, beg: 33, nov: 52, int: 75, adv: 103, eli: 135 },
      { bw: 80, beg: 38, nov: 58, int: 83, adv: 113, eli: 147 },
      { bw: 90, beg: 42, nov: 64, int: 90, adv: 122, eli: 158 },
      { bw: 100, beg: 46, nov: 69, int: 97, adv: 130, eli: 168 },
      { bw: 110, beg: 50, nov: 74, int: 103, adv: 138, eli: 178 }
    ],
    female: [
      { bw: 50, beg: 14, nov: 23, int: 36, adv: 53, eli: 73 },
      { bw: 60, beg: 16, nov: 27, int: 41, adv: 59, eli: 81 },
      { bw: 70, beg: 19, nov: 30, int: 46, adv: 65, eli: 88 },
      { bw: 80, beg: 21, nov: 34, int: 50, adv: 70, eli: 94 },
      { bw: 90, beg: 23, nov: 37, int: 54, adv: 75, eli: 100 }
    ]
  },

  // ---------- chest ----------
  incline_chest_press: {
    male: [
      { bw: 60, beg: 30, nov: 47, int: 68, adv: 94, eli: 125 },
      { bw: 70, beg: 36, nov: 55, int: 78, adv: 106, eli: 139 },
      { bw: 80, beg: 41, nov: 62, int: 87, adv: 117, eli: 152 },
      { bw: 90, beg: 46, nov: 68, int: 95, adv: 127, eli: 164 },
      { bw: 100, beg: 51, nov: 74, int: 103, adv: 136, eli: 174 },
      { bw: 110, beg: 55, nov: 79, int: 109, adv: 144, eli: 184 }
    ],
    female: [
      { bw: 50, beg: 13, nov: 22, int: 35, adv: 51, eli: 71 },
      { bw: 60, beg: 16, nov: 26, int: 40, adv: 57, eli: 79 },
      { bw: 70, beg: 18, nov: 29, int: 44, adv: 63, eli: 86 },
      { bw: 80, beg: 21, nov: 33, int: 49, adv: 68, eli: 92 },
      { bw: 90, beg: 23, nov: 36, int: 53, adv: 73, eli: 98 }
    ]
  },

  // ---------- shoulders ----------
  db_shoulder_press: {
    // per dumbbell
    male: [
      { bw: 60, beg: 8, nov: 14, int: 22, adv: 32, eli: 44 },
      { bw: 70, beg: 10, nov: 17, int: 26, adv: 37, eli: 50 },
      { bw: 80, beg: 12, nov: 19, int: 29, adv: 41, eli: 55 },
      { bw: 90, beg: 14, nov: 21, int: 32, adv: 45, eli: 60 },
      { bw: 100, beg: 15, nov: 23, int: 35, adv: 48, eli: 64 },
      { bw: 110, beg: 17, nov: 25, int: 37, adv: 51, eli: 68 }
    ],
    female: [
      { bw: 50, beg: 3, nov: 6, int: 11, adv: 18, eli: 27 },
      { bw: 60, beg: 4, nov: 7, int: 13, adv: 21, eli: 31 },
      { bw: 70, beg: 5, nov: 9, int: 15, adv: 23, eli: 34 },
      { bw: 80, beg: 6, nov: 10, int: 17, adv: 25, eli: 37 },
      { bw: 90, beg: 7, nov: 11, int: 18, adv: 27, eli: 40 }
    ]
  },

  db_lateral_raise: {
    // per dumbbell
    male: [
      { bw: 60, beg: 4, nov: 7, int: 11, adv: 17, eli: 25 },
      { bw: 70, beg: 5, nov: 8, int: 13, adv: 20, eli: 28 },
      { bw: 80, beg: 6, nov: 10, int: 15, adv: 22, eli: 31 },
      { bw: 90, beg: 7, nov: 11, int: 17, adv: 24, eli: 34 },
      { bw: 100, beg: 8, nov: 12, int: 18, adv: 26, eli: 36 },
      { bw: 110, beg: 8, nov: 13, int: 19, adv: 28, eli: 38 }
    ],
    female: [
      { bw: 50, beg: 1.5, nov: 3, int: 5.5, adv: 9, eli: 14 },
      { bw: 60, beg: 2, nov: 3.5, int: 6.5, adv: 10.5, eli: 16 },
      { bw: 70, beg: 2.5, nov: 4.5, int: 7.5, adv: 12, eli: 18 },
      { bw: 80, beg: 3, nov: 5, int: 8.5, adv: 13.5, eli: 20 },
      { bw: 90, beg: 3.5, nov: 6, int: 9.5, adv: 15, eli: 22 }
    ]
  },

  // ---------- arms ----------
  db_curl: {
    // per dumbbell
    male: [
      { bw: 60, beg: 6, nov: 11, int: 17, adv: 25, eli: 35 },
      { bw: 70, beg: 8, nov: 13, int: 20, adv: 29, eli: 40 },
      { bw: 80, beg: 9, nov: 15, int: 22, adv: 32, eli: 44 },
      { bw: 90, beg: 11, nov: 16, int: 25, adv: 35, eli: 48 },
      { bw: 100, beg: 12, nov: 18, int: 27, adv: 38, eli: 51 },
      { bw: 110, beg: 13, nov: 19, int: 29, adv: 40, eli: 54 }
    ],
    female: [
      { bw: 50, beg: 2, nov: 4, int: 7, adv: 11, eli: 17 },
      { bw: 60, beg: 3, nov: 5, int: 8.5, adv: 13, eli: 19 },
      { bw: 70, beg: 3.5, nov: 6, int: 9.5, adv: 14.5, eli: 21 },
      { bw: 80, beg: 4, nov: 6.5, int: 10.5, adv: 16, eli: 23 },
      { bw: 90, beg: 4.5, nov: 7, int: 11.5, adv: 17, eli: 25 }
    ]
  },

  db_triceps_extension: {
    // per dumbbell, overhead (one-arm or two-arm; per-side mass)
    male: [
      { bw: 60, beg: 5, nov: 9, int: 15, adv: 22, eli: 31 },
      { bw: 70, beg: 6, nov: 11, int: 17, adv: 25, eli: 35 },
      { bw: 80, beg: 8, nov: 13, int: 19, adv: 28, eli: 39 },
      { bw: 90, beg: 9, nov: 14, int: 22, adv: 31, eli: 42 },
      { bw: 100, beg: 10, nov: 15, int: 23, adv: 33, eli: 45 },
      { bw: 110, beg: 11, nov: 17, int: 25, adv: 35, eli: 48 }
    ],
    female: [
      { bw: 50, beg: 2, nov: 3.5, int: 6, adv: 9.5, eli: 14 },
      { bw: 60, beg: 2.5, nov: 4, int: 7, adv: 11, eli: 16 },
      { bw: 70, beg: 3, nov: 5, int: 8, adv: 12.5, eli: 18 },
      { bw: 80, beg: 3.5, nov: 5.5, int: 9, adv: 13.5, eli: 20 },
      { bw: 90, beg: 4, nov: 6, int: 10, adv: 15, eli: 22 }
    ]
  },

  // ---------- legs ----------
  leg_curl: {
    male: [
      { bw: 60, beg: 25, nov: 40, int: 60, adv: 84, eli: 112 },
      { bw: 70, beg: 30, nov: 47, int: 68, adv: 94, eli: 124 },
      { bw: 80, beg: 34, nov: 52, int: 75, adv: 102, eli: 134 },
      { bw: 90, beg: 38, nov: 57, int: 82, adv: 110, eli: 144 },
      { bw: 100, beg: 41, nov: 62, int: 87, adv: 117, eli: 152 },
      { bw: 110, beg: 44, nov: 66, int: 92, adv: 124, eli: 160 }
    ],
    female: [
      { bw: 50, beg: 12, nov: 20, int: 32, adv: 47, eli: 65 },
      { bw: 60, beg: 14, nov: 23, int: 36, adv: 52, eli: 72 },
      { bw: 70, beg: 17, nov: 27, int: 41, adv: 58, eli: 78 },
      { bw: 80, beg: 19, nov: 30, int: 45, adv: 62, eli: 84 },
      { bw: 90, beg: 21, nov: 32, int: 48, adv: 67, eli: 89 }
    ]
  },

  leg_extension: {
    male: [
      { bw: 60, beg: 28, nov: 45, int: 66, adv: 92, eli: 122 },
      { bw: 70, beg: 33, nov: 52, int: 75, adv: 103, eli: 135 },
      { bw: 80, beg: 38, nov: 58, int: 83, adv: 113, eli: 147 },
      { bw: 90, beg: 42, nov: 64, int: 90, adv: 122, eli: 158 },
      { bw: 100, beg: 46, nov: 69, int: 97, adv: 130, eli: 168 },
      { bw: 110, beg: 50, nov: 74, int: 103, adv: 138, eli: 178 }
    ],
    female: [
      { bw: 50, beg: 14, nov: 23, int: 36, adv: 53, eli: 73 },
      { bw: 60, beg: 16, nov: 27, int: 41, adv: 59, eli: 81 },
      { bw: 70, beg: 19, nov: 31, int: 46, adv: 65, eli: 88 },
      { bw: 80, beg: 21, nov: 34, int: 50, adv: 70, eli: 94 },
      { bw: 90, beg: 23, nov: 37, int: 54, adv: 75, eli: 100 }
    ]
  }
};

/** Linear interpolation of a row at the requested bodyweight. */
export function interpolateRow(rows, bw) {
  if (!rows?.length) return null;
  if (bw <= rows[0].bw) return { ...rows[0] };
  if (bw >= rows[rows.length - 1].bw) return { ...rows[rows.length - 1] };
  let lo = rows[0], hi = rows[rows.length - 1];
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i].bw <= bw && rows[i + 1].bw >= bw) { lo = rows[i]; hi = rows[i + 1]; break; }
  }
  const t = (bw - lo.bw) / (hi.bw - lo.bw);
  const lerp = (a, b) => a + (b - a) * t;
  return {
    bw,
    beg: lerp(lo.beg, hi.beg),
    nov: lerp(lo.nov, hi.nov),
    int: lerp(lo.int, hi.int),
    adv: lerp(lo.adv, hi.adv),
    eli: lerp(lo.eli, hi.eli)
  };
}
