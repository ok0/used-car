import fs from 'node:fs';
import { DB_PATH } from './connection';

/** DB를 쓰는 작업(collect, purge --apply, GUI 수집·정리)이 동시에 두 개 돌지 않게 하는 파일 잠금. DB 파일 옆 <db>.lock */
export const JOB_LOCK_PATH = `${DB_PATH}.lock`;

export interface JobLockInfo { pid: number; kind: string; startedAt: string; }
export type JobLockResult = { ok: true; release: () => void } | { ok: false; holder: JobLockInfo | null };

function readLock(lockPath: string): JobLockInfo | null {
  try {
    const j = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Partial<JobLockInfo>;
    return typeof j.pid === 'number' ? { pid: j.pid, kind: String(j.kind ?? '?'), startedAt: String(j.startedAt ?? '') } : null;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 잠금 취득. 다른 살아 있는 프로세스가 잡고 있으면 ok:false. 죽은 프로세스의 잠금(비정상 종료)은 지우고 다시 취득 */
export function tryAcquireJobLock(kind: string, lockPath: string = JOB_LOCK_PATH): JobLockResult {
  const info: JobLockInfo = { pid: process.pid, kind, startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lockPath, JSON.stringify(info), { flag: 'wx' });
      let released = false;
      return {
        ok: true,
        release: (): void => {
          if (released) return;
          released = true;
          if (readLock(lockPath)?.pid === process.pid) fs.rmSync(lockPath, { force: true });
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const holder = readLock(lockPath);
      if (holder !== null && holder.pid !== process.pid && isAlive(holder.pid)) return { ok: false, holder };
      if (holder !== null && holder.pid === process.pid) return { ok: false, holder };
      fs.rmSync(lockPath, { force: true }); // 죽은 프로세스의 잠금 또는 읽을 수 없는 파일
    }
  }
  return { ok: false, holder: readLock(lockPath) };
}

export function lockHeldMessage(holder: JobLockInfo | null, lockPath: string = JOB_LOCK_PATH): string {
  const who = holder === null ? '다른 작업' : `다른 작업(${holder.kind}, pid ${holder.pid}, 시작 ${holder.startedAt})`;
  return `${who}이 이 DB에서 실행 중입니다. 끝난 뒤 다시 실행하세요. 실행 중인 작업이 없는데도 이 메시지가 나오면 잠금 파일을 지우세요: ${lockPath}`;
}
