import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { FootageRecord, JobRecord, OutputRecord } from '../types';

interface AppDBSchema extends DBSchema {
  footage: {
    key: string;
    value: FootageRecord;
  };
  jobs: {
    key: string;
    value: JobRecord;
  };
  outputs: {
    key: string;
    value: OutputRecord;
  };
}

const DB_NAME = 'video-cau-truc-anh-viet';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<AppDBSchema>> | null = null;

export function getDB(): Promise<IDBPDatabase<AppDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<AppDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('footage')) {
          db.createObjectStore('footage', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('jobs')) {
          db.createObjectStore('jobs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('outputs')) {
          db.createObjectStore('outputs', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function requestStoragePersistence(): Promise<boolean> {
  if (navigator.storage && (navigator.storage as any).persist) {
    try {
      return await (navigator.storage as any).persist();
    } catch {
      return false;
    }
  }
  return false;
}

// Footage CRUD
export async function getAllFootage(): Promise<FootageRecord[]> {
  const db = await getDB();
  return db.getAll('footage');
}

export async function saveFootage(record: FootageRecord): Promise<void> {
  const db = await getDB();
  await db.put('footage', record);
}

export async function deleteFootage(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('footage', id);
}

export async function toggleFootageActive(id: string, active: boolean): Promise<void> {
  const db = await getDB();
  const item = await db.get('footage', id);
  if (item) {
    item.active = active;
    await db.put('footage', item);
  }
}

export async function setAllFootageActive(active: boolean): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('footage', 'readwrite');
  const store = tx.objectStore('footage');
  const all = await store.getAll();
  for (const item of all) {
    item.active = active;
    await store.put(item);
  }
  await tx.done;
}

// Jobs CRUD
export async function getAllJobs(): Promise<JobRecord[]> {
  const db = await getDB();
  const jobs = await db.getAll('jobs');
  // Sort descending by creation date
  return jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function saveJob(job: JobRecord): Promise<void> {
  const db = await getDB();
  await db.put('jobs', job);
}

export async function deleteJob(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('jobs', id);
  await db.delete('outputs', id);
}

// Outputs CRUD with quota management (keep up to 5 latest outputs)
export async function saveOutput(output: OutputRecord): Promise<boolean> {
  try {
    const db = await getDB();
    // Check estimate quota if supported
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota && estimate.usage) {
        const remaining = estimate.quota - estimate.usage;
        if (remaining < output.size + 10 * 1024 * 1024) {
          // Clean up old outputs
          await pruneOldOutputs(3);
        }
      }
    }
    await db.put('outputs', output);
    return true;
  } catch (err) {
    console.warn('Could not save MP4 output to IndexedDB quota:', err);
    return false;
  }
}

export async function getOutput(id: string): Promise<OutputRecord | undefined> {
  const db = await getDB();
  return db.get('outputs', id);
}

export async function deleteOutput(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('outputs', id);
}

export async function pruneOldOutputs(maxKeep = 5): Promise<void> {
  try {
    const db = await getDB();
    const outputs = await db.getAll('outputs');
    if (outputs.length <= maxKeep) return;

    // Sort ascending by creation date to delete oldest first
    outputs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const toDelete = outputs.slice(0, outputs.length - maxKeep);
    for (const item of toDelete) {
      await db.delete('outputs', item.id);
      // Mark job as no longer having local output
      const job = await db.get('jobs', item.jobId);
      if (job) {
        job.hasSavedOutput = false;
        await db.put('jobs', job);
      }
    }
  } catch (e) {
    console.warn('Prune error:', e);
  }
}
