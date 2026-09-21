
const DB_NAME = "nano-seo-lab";
const DB_VERSION = 2;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("snapshots")) {
        db.createObjectStore("snapshots", {keyPath: "fingerprint"});
      }

      if (!db.objectStoreNames.contains("cache")) {
        db.createObjectStore("cache", {keyPath: "key"});
      }

      if (!db.objectStoreNames.contains("runs")) {
        const s = db.createObjectStore("runs", {
          keyPath: "id",
          autoIncrement: true
        });
        s.createIndex("createdAt", "createdAt");
        s.createIndex("task", "task");
        s.createIndex("provider", "provider");
        s.createIndex("analysisRunId", "analysisRunId");
      }

      if (!db.objectStoreNames.contains("analysisRuns")) {
        const s = db.createObjectStore("analysisRuns", {keyPath: "id"});
        s.createIndex("startedAt", "startedAt");
        s.createIndex("url", "url");
        s.createIndex("pageFingerprint", "pageFingerprint");
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(store, value) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

async function dbAdd(store, value) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).add(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(store, key) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll(store) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbClear(store) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
