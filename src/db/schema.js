// IndexedDB open + migrations.
//
// Stores:
//   profile     — keyPath "id" (always "me")
//   weightLog   — keyPath "id" autoIncrement, indexed by "loggedAt"
//   exercises   — keyPath "id" autoIncrement, indexed by "name"
//   sessions    — keyPath "id" autoIncrement, indexed by "startedAt"
//   sets        — keyPath "id" autoIncrement, indexed by "sessionId" and ["exerciseId","completedAt"]
//
// PERSISTENCE CONTRACT (do not break):
//   * IndexedDB is preserved across app updates and service-worker reloads.
//     Only Cache API entries are cleared on SW activate (see service-worker.js).
//   * DB_VERSION must only ever increase when the schema (stores or indexes)
//     changes. Adding new columns to existing rows does NOT require a bump
//     because IndexedDB is schemaless on the row level.
//   * Migrations live inside onupgradeneeded under guarded `if (oldV < N)`
//     blocks so they only run once per upgrade boundary and never wipe
//     existing data. Never call store.clear() from a migration.
//   * The starter exercise list is only seeded if the exercises store is
//     empty (see seedIfEmpty in repo.js). User-added or user-modified
//     exercises must never be overwritten by an update.

const DB_NAME = "reps";
const DB_VERSION = 1;

let _db = null;
let _opening = null;

export function openDb() {
  if (_db) return Promise.resolve(_db);
  if (_opening) return _opening;
  _opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const oldV = e.oldVersion;
      if (oldV < 1) {
        const profile = db.createObjectStore("profile", { keyPath: "id" });
        profile.createIndex("by_id", "id", { unique: true });

        const weight = db.createObjectStore("weightLog", { keyPath: "id", autoIncrement: true });
        weight.createIndex("by_loggedAt", "loggedAt");

        const exercises = db.createObjectStore("exercises", { keyPath: "id", autoIncrement: true });
        exercises.createIndex("by_name", "name", { unique: true });

        const sessions = db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true });
        sessions.createIndex("by_startedAt", "startedAt");
        sessions.createIndex("by_exerciseId", "exerciseId");

        const sets = db.createObjectStore("sets", { keyPath: "id", autoIncrement: true });
        sets.createIndex("by_sessionId", "sessionId");
        sets.createIndex("by_exercise_completedAt", ["exerciseId", "completedAt"]);
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
  return _opening;
}

export function tx(stores, mode = "readonly") {
  return openDb().then((db) => db.transaction(stores, mode));
}

export function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function txDone(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
