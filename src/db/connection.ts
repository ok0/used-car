import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initSchema } from './schema';

/** 기본 DB 경로: 프로젝트 루트의 data/used-car.db (실행 위치와 무관) */
export const DEFAULT_DB_PATH = path.resolve(__dirname, '../../data/used-car.db');

/** USED_CAR_DB(비어 있지 않으면, 상대경로는 현재 작업 디렉터리 기준)로 DB 경로를 바꿀 수 있다. 테스트·검증용 */
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.USED_CAR_DB ?? '').trim();
  return raw === '' ? DEFAULT_DB_PATH : path.resolve(raw);
}

export const DB_PATH = resolveDbPath();

let instance: Database.Database | null = null;
let readonlyMode = false;

/** true면 이후 getDb()가 읽기 전용 연결을 연다 (파일 필수, 마이그레이션 없음). 연결이 열려 있으면 오류 */
export function setDbReadonly(value: boolean): void {
  if (instance) throw new Error('DB 연결이 이미 열려 있습니다 — setDbReadonly는 getDb() 전에(또는 closeDb() 후에) 호출하세요');
  readonlyMode = value;
}

export function getDb(): Database.Database {
  if (instance) return instance;
  if (readonlyMode) {
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 5000');
    instance = db;
    return db;
  }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 5000');
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

/** 읽기 전용 모드(GUI 서버)에서도 fn 실행 동안만 읽기-쓰기 연결을 쓴다. 끝나면 연결을 닫고 원래 모드로 돌린다(다음 getDb()가 다시 연다).
 *  같은 프로세스의 다른 코드도 이 동안 getDb()로 같은 쓰기 연결을 쓴다. 한 번에 하나만 호출할 것 (서버 작업 큐가 보장) */
export async function withWritableDb<T>(fn: () => Promise<T>): Promise<T> {
  const prev = readonlyMode;
  closeDb();
  readonlyMode = false;
  try {
    getDb();
    return await fn();
  } finally {
    closeDb();
    readonlyMode = prev;
  }
}
