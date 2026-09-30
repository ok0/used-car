import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initSchema } from './schema';

export const DB_PATH = path.resolve(__dirname, '../../data/used-car.db');

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (instance) return instance;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  initSchema(db);
  instance = db;
  return db;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
