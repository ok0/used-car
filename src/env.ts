import fs from 'node:fs';
import path from 'node:path';

/** 프로젝트 루트의 .env (실행 위치와 무관하게 이 파일 기준 ../.env) */
export const DEFAULT_ENV_PATH = path.resolve(__dirname, '../.env');

/** .env를 읽기 전에 이미 있던(실행 환경에서 직접 지정한) 환경변수 이름. GUI 설정 화면이 ".env 값이 무시되는 키"를 알려 주는 데 사용 */
const SHELL_ENV_KEYS: ReadonlySet<string> = new Set(Object.keys(process.env));
export function isShellEnvKey(key: string): boolean { return SHELL_ENV_KEYS.has(key); }

/**
 * .env 파일을 읽어 process.env에 채운다 (Node 내장 process.loadEnvFile).
 * - 파일이 없으면 조용히 넘어간다.
 * - 이미 설정된 실제 환경변수는 덮어쓰지 않는다 → `VAR=값 npx ts-node ...` 가 .env보다 우선.
 * - 파일을 읽을 수 없으면 경고만 출력하고 계속한다.
 */
export function loadEnv(envPath: string = DEFAULT_ENV_PATH): boolean {
  if (!fs.existsSync(envPath)) return false;
  try {
    process.loadEnvFile(envPath);
    return true;
  } catch (err) {
    console.warn(`⚠ .env를 읽지 못했습니다 (${envPath}): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

loadEnv();
