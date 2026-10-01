#!/usr/bin/env node
import '../env'; // .env 로드 (다른 모듈보다 먼저)
import { spawn } from 'node:child_process';
import { Command, InvalidArgumentError } from 'commander';
import { DB_PATH, getDb, closeDb, setDbReadonly } from '../db/connection';
import { getStaleDays } from '../db/repository';
import { resolveCompareSettings } from '../services/compare';
import { buildApp, DEFAULT_WEB_ROOT } from './app';
import { createJobManager } from './jobs';

export const DEFAULT_GUI_PORT = 5174;

function toPort(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new InvalidArgumentError(`1~65535 정수가 아닙니다: ${value}`);
  return n;
}

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => { /* 브라우저를 못 열어도 서버는 계속 */ });
    child.unref();
  } catch { /* 무시 */ }
}

async function main(): Promise<void> {
  const program = new Command()
    .name('used-car-gui')
    .description('중고차 가격 비교 로컬 웹 화면 (127.0.0.1 전용)')
    .option('--port <n>', `포트 (기본 GUI_PORT 또는 ${DEFAULT_GUI_PORT})`, toPort)
    .option('--no-open', '브라우저 자동 열기 안 함')
    .option('--dev', '개발 모드: 정적 파일을 서빙하지 않음 (Vite 개발 서버가 /api 를 프록시)')
    .parse(process.argv);
  const o = program.opts<{ port?: number; open: boolean; dev?: boolean }>();
  const port = o.port ?? (process.env.GUI_PORT ? toPort(process.env.GUI_PORT) : DEFAULT_GUI_PORT);

  // 환경변수 검증 (CLI와 동일하게 시작 시 실패)
  getStaleDays();
  resolveCompareSettings();

  // 스키마 마이그레이션은 CLI와 같은 방식으로 1회 (읽기-쓰기 연결) 후 닫고, 이후 요청은 읽기 전용 연결만 사용
  getDb();
  closeDb();
  setDbReadonly(true);
  getDb();

  const jobs = createJobManager();
  const app = buildApp({ webRoot: o.dev ? null : DEFAULT_WEB_ROOT, jobs });
  try {
    await app.listen({ host: '127.0.0.1', port });
  } catch (err) {
    if ((err as { code?: string }).code === 'EADDRINUSE') {
      console.error(`❌ 포트 ${port}가 이미 사용 중입니다. 이미 실행 중이면 http://127.0.0.1:${port} 를 여세요. 다른 포트: npm run gui -- --port <n>`);
      closeDb();
      process.exit(1);
    }
    throw err;
  }
  const url = `http://127.0.0.1:${port}/`;
  console.log(`🚗 used-car GUI: ${url}${o.dev ? ' (API 전용 — 화면은 Vite http://127.0.0.1:5173/)' : ''}`);
  console.log(`   DB: ${DB_PATH} (조회는 읽기 전용, 수집·정리 작업 중에만 쓰기) | 종료: Ctrl+C`);
  if (o.open && !o.dev) openBrowser(url);

  let closing = false;
  const shutdown = (): void => {
    if (closing) {
      console.error('⛔ 강제 종료합니다. 수집 중이었다면 저장된 매물의 점수는 잠정치입니다 — 다음 수집 때 재채점됩니다.');
      jobs.forceRelease();
      process.exit(130);
    }
    closing = true;
    if (jobs.isRunning()) console.error('⏹ 실행 중인 작업에 중단을 요청했습니다 — 진행 중인 매물까지 저장·재채점 후 종료합니다. (즉시 강제 종료: Ctrl+C 한 번 더)');
    void jobs.shutdown().finally(() => app.close()).finally(() => { closeDb(); process.exit(0); });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  closeDb();
  process.exit(1);
});
