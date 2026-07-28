const DB_NAME = "wzed-snapshots";
const DB_VERSION = 1;
const STORE_NAME = "snapshots";

let _dbCache: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_dbCache) return Promise.resolve(_dbCache);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => {
      _dbCache = req.result;
      _dbCache.onclose = () => { _dbCache = null; };
      resolve(_dbCache);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveProjectSnapshot(projectId: string, snapshot: Snapshot): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(snapshot, projectId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadProjectSnapshot(projectId: string): Promise<Snapshot | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(projectId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProjectSnapshot(projectId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(projectId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
import type { Snapshot } from "@scelar/nodepod";
