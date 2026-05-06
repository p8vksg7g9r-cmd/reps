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
    req.onupgradeneeded = () => {
      // Defensive migration policy:
      //   * NEVER call store.clear() or db.deleteObjectStore() from here.
      //   * Only create stores / indexes that don't already exist.
      //   * Adding a new column to an existing row's payload is invisible
      //     to IndexedDB — no migration step needed.
      // This is safe to re-run if the database somehow ends up at a
      // version-correct state but missing a store (recovery path).
      const db = req.result;
      const tx = req.transaction;

      function ensureStore(name, opts, indexes = []) {
        const store = db.objectStoreNames.contains(name)
          ? tx.objectStore(name)
          : db.createObjectStore(name, opts);
        for (const [iname, keyPath, ixOpts] of indexes) {
          if (!store.indexNames.contains(iname)) {
            store.createIndex(iname, keyPath, ixOpts || {});
          }
        }
      }

      ensureStore("profile",   { keyPath: "id" }, [
        ["by_id", "id", { unique: true }]
      ]);
      ensureStore("weightLog", { keyPath: "id", autoIncrement: true }, [
        ["by_loggedAt", "loggedAt"]
      ]);
      ensureStore("exercises", { keyPath: "id", autoIncrement: true }, [
        ["by_name", "name", { unique: true }]
      ]);
      ensureStore("sessions",  { keyPath: "id", autoIncrement: true }, [
        ["by_startedAt", "startedAt"],
        ["by_exerciseId", "exerciseId"]   // legacy on pre-v0.10 sessions
      ]);
      ensureStore("sets",      { keyPath: "id", autoIncrement: true }, [
        ["by_sessionId", "sessionId"],
        ["by_exercise_completedAt", ["exerciseId", "completedAt"]]
      ]);
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
