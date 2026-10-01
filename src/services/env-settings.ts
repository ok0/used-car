// GUI 설정 화면: .env 의 지원 키만 읽고 안전하게 고쳐 쓴다 (주석·순서 보존, 원자적 쓰기)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { DEFAULT_ENV_PATH, isShellEnvKey } from '../env';
import { getMatchConfigFromEnv } from '../comparator/market-matcher';
import { specMaxAdjust, platformBasePremium } from '../comparator/analyzer';
import { getKnnConfigFromEnv } from '../comparator/knn';
import { getStaleDays } from '../db/repository';

export type EnvKey =
  | 'ENCAR_FETCH_MARKET' | 'ENCAR_FETCH_YEARLY'
  | 'COMPARE_MILEAGE_RANGE' | 'COMPARE_YEAR_RANGE' | 'COMPARE_MIN_SAMPLES' | 'COMPARE_SPEC_MAX_ADJUST'
  | 'COMPARE_PREMIUM_HEYDEALER' | 'COMPARE_PREMIUM_KCAR' | 'COMPARE_PREMIUM_HYUNDAI_CERTIFIED'
  | 'COMPARE_KNN' | 'COMPARE_KNN_N' | 'COMPARE_VERDICT_SOURCE'
  | 'STALE_DAYS' | 'GUI_PORT';

export interface EnvKeySpec {
  key: EnvKey;
  kind: 'flag' | 'text';          // flag: 켜짐='1' / 꺼짐=미설정
  defaultText: string;            // 기본값 설명
  restartRequired: boolean;       // 실행 중인 서버에는 반영되지 않음
  validate: (value: string) => void; // 잘못되면 throw (기존 검증 함수 재사용)
}

function validatePort(v: string): void {
  const n = Number(v);
  if (!/^\d+$/.test(v) || n < 1 || n > 65535) throw new Error(`GUI_PORT는 1~65535 정수여야 합니다: ${v}`);
}
function validateFlag(key: string) {
  return (v: string): void => { if (!/^(1|true|on|yes|0|false|off|no)$/i.test(v)) throw new Error(`${key}는 1(켜짐) 또는 0(꺼짐)이어야 합니다: ${v}`); };
}

export const ENV_KEYS: readonly EnvKeySpec[] = [
  { key: 'ENCAR_FETCH_MARKET', kind: 'flag', defaultText: '꺼짐', restartRequired: false, validate: validateFlag('ENCAR_FETCH_MARKET') },
  { key: 'ENCAR_FETCH_YEARLY', kind: 'flag', defaultText: '꺼짐', restartRequired: false, validate: validateFlag('ENCAR_FETCH_YEARLY') },
  { key: 'COMPARE_MILEAGE_RANGE', kind: 'text', defaultText: '40,60', restartRequired: false, validate: (v) => { getMatchConfigFromEnv({ COMPARE_MILEAGE_RANGE: v }); } },
  { key: 'COMPARE_YEAR_RANGE', kind: 'text', defaultText: '2', restartRequired: false, validate: (v) => { getMatchConfigFromEnv({ COMPARE_YEAR_RANGE: v }); } },
  { key: 'COMPARE_MIN_SAMPLES', kind: 'text', defaultText: '5', restartRequired: false, validate: (v) => { getMatchConfigFromEnv({ COMPARE_MIN_SAMPLES: v }); } },
  { key: 'COMPARE_SPEC_MAX_ADJUST', kind: 'text', defaultText: '7', restartRequired: false, validate: (v) => { specMaxAdjust({ COMPARE_SPEC_MAX_ADJUST: v }); } },
  { key: 'COMPARE_PREMIUM_HEYDEALER', kind: 'text', defaultText: '5', restartRequired: false, validate: (v) => { platformBasePremium('heydealer', { COMPARE_PREMIUM_HEYDEALER: v }); } },
  { key: 'COMPARE_PREMIUM_KCAR', kind: 'text', defaultText: '5', restartRequired: false, validate: (v) => { platformBasePremium('kcar', { COMPARE_PREMIUM_KCAR: v }); } },
  { key: 'COMPARE_PREMIUM_HYUNDAI_CERTIFIED', kind: 'text', defaultText: '5', restartRequired: false, validate: (v) => { platformBasePremium('hyundai_certified', { COMPARE_PREMIUM_HYUNDAI_CERTIFIED: v }); } },
  { key: 'COMPARE_KNN', kind: 'text', defaultText: '1 (켜짐)', restartRequired: false, validate: (v) => { getKnnConfigFromEnv({ COMPARE_KNN: v }); } },
  { key: 'COMPARE_KNN_N', kind: 'text', defaultText: '40', restartRequired: false, validate: (v) => { getKnnConfigFromEnv({ COMPARE_KNN_N: v }); } },
  { key: 'COMPARE_VERDICT_SOURCE', kind: 'text', defaultText: 'current', restartRequired: false, validate: (v) => { getKnnConfigFromEnv({ COMPARE_VERDICT_SOURCE: v }); } },
  { key: 'STALE_DAYS', kind: 'text', defaultText: '14', restartRequired: false, validate: (v) => { getStaleDays({ STALE_DAYS: v }); } },
  { key: 'GUI_PORT', kind: 'text', defaultText: '5174', restartRequired: true, validate: validatePort },
];
const SPEC = new Map<string, EnvKeySpec>(ENV_KEYS.map((s) => [s.key, s]));
export function isEnvKey(k: string): k is EnvKey { return SPEC.has(k); }

export class EnvSettingsError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'ENV_CHANGED', message: string, public readonly details: string[] = []) {
    super(message);
    this.name = 'EnvSettingsError';
  }
}

export interface EnvEntryState {
  key: EnvKey;
  fileValue: string | null;      // .env 의 활성 값 (없으면 null)
  effectiveValue: string | null; // 지금 서버 프로세스의 값
  shellOverride: boolean;        // 실행 환경변수로 지정되어 .env 값이 무시됨
}
export interface EnvFileState {
  envPath: string;
  exists: boolean;
  revision: string;              // 내용 해시 (없으면 '')
  entries: EnvEntryState[];
}

const LINE_RE = (key: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
const COMMENTED_RE = (key: string): RegExp => new RegExp(`^\\s*#\\s*(?:export\\s+)?${key}\\s*=`);

function revisionOf(text: string | null): string {
  return text === null ? '' : crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}
function readText(p: string): string | null {
  try { return fs.readFileSync(p, 'utf8'); } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; throw err; }
}

export function readEnvFile(envPath: string = DEFAULT_ENV_PATH): EnvFileState {
  const text = readText(envPath);
  const parsed = text === null ? {} : parseEnv(text);
  return {
    envPath,
    exists: text !== null,
    revision: revisionOf(text),
    entries: ENV_KEYS.map((s) => ({
      key: s.key,
      fileValue: Object.prototype.hasOwnProperty.call(parsed, s.key) ? (parsed as Record<string, string>)[s.key] : null,
      effectiveValue: process.env[s.key] ?? null,
      shellOverride: isShellEnvKey(s.key),
    })),
  };
}

/** 값 정규화·검증. null/'' = 미설정(기본값). flag 는 켜짐 '1' / 꺼짐 null 로 통일 */
export function normalizeEnvValue(key: EnvKey, raw: string | null): string | null {
  const spec = SPEC.get(key)!;
  if (raw === null) return null;
  const v = raw.trim();
  if (v === '') return null;
  if (/[\r\n"'`#\\$]/.test(v) || v.length > 100) throw new Error(`${key}: 허용되지 않는 문자가 있거나 너무 깁니다`);
  spec.validate(v);
  if (spec.kind === 'flag') return /^(1|true|on|yes)$/i.test(v) ? '1' : null;
  return v;
}

/** .env 텍스트에 변경 적용 (순수 함수). 활성 줄은 교체(중복은 제거), 미설정은 주석 처리, 새 키는 주석 예시 줄 뒤나 끝에 추가 */
export function applyEnvChanges(text: string, changes: ReadonlyMap<EnvKey, string | null>): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text === '' ? [] : text.split(/\r?\n/);
  const hadTrailingNewline = lines.length > 0 && lines[lines.length - 1] === '';
  if (hadTrailingNewline) lines.pop();
  for (const [key, value] of changes) {
    const active = LINE_RE(key);
    let replaced = false;
    for (let i = 0; i < lines.length; i++) {
      if (!active.test(lines[i])) continue;
      if (value === null) lines[i] = `# ${lines[i].trimStart()}`;
      else if (!replaced) { lines[i] = `${key}=${value}`; replaced = true; }
      else { lines.splice(i, 1); i--; }
    }
    if (value === null || replaced) continue;
    const commented = COMMENTED_RE(key);
    let at = -1;
    for (let i = 0; i < lines.length; i++) if (commented.test(lines[i])) at = i;
    if (at >= 0) lines.splice(at + 1, 0, `${key}=${value}`);
    else lines.push(`${key}=${value}`);
  }
  return lines.join(eol) + eol;
}

/** 임시 파일 + rename 으로 원자적 쓰기 (심볼릭 링크면 실제 파일을 바꿈, 권한 유지) */
function writeAtomic(target: string, text: string): void {
  let real = target;
  try { real = fs.realpathSync(target); } catch { /* 새 파일 */ }
  let mode = 0o600;
  try { mode = fs.statSync(real).mode & 0o777; } catch { /* 새 파일 */ }
  const tmp = path.join(path.dirname(real), `.${path.basename(real)}.${process.pid}.tmp`);
  const fd = fs.openSync(tmp, 'w', mode);
  try {
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, real);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

export interface EnvSaveResult {
  state: EnvFileState;
  changed: EnvKey[];          // 파일에서 실제로 바뀐 키
  applied: EnvKey[];          // 실행 중 서버에 즉시 반영된 키
  restartRequired: EnvKey[];  // 재시작해야 반영
  shellOverridden: EnvKey[];  // 실행 환경변수가 우선이라 반영 안 됨
}

/**
 * 변경 저장. revision 이 현재 파일과 다르면 ENV_CHANGED. 값 오류는 INVALID_INPUT(details 에 키별 메시지).
 * .env 가 없으면 .env.example 을 바탕으로 만든다. 저장 후 process.env 에 반영(실행 환경변수로 지정된 키·재시작 필요 키 제외).
 */
export function saveEnvChanges(
  values: Record<string, unknown>, revision: string, envPath: string = DEFAULT_ENV_PATH,
  examplePath: string = path.join(path.dirname(envPath), '.env.example'),
): EnvSaveResult {
  const errors: string[] = [];
  const changes = new Map<EnvKey, string | null>();
  for (const [k, raw] of Object.entries(values)) {
    if (!isEnvKey(k)) { errors.push(`지원하지 않는 설정입니다: ${k}`); continue; }
    if (raw !== null && typeof raw !== 'string') { errors.push(`${k}: 문자열 또는 null 이어야 합니다`); continue; }
    try { changes.set(k, normalizeEnvValue(k, raw)); } catch (err) { errors.push(err instanceof Error ? err.message : String(err)); }
  }
  if (errors.length > 0) throw new EnvSettingsError('INVALID_INPUT', '저장하지 않았습니다 — 잘못된 값이 있습니다', errors);
  const current = readText(envPath);
  if (revisionOf(current) !== revision) throw new EnvSettingsError('ENV_CHANGED', '.env 가 다른 곳에서 바뀌었습니다. 화면을 새로 불러온 뒤 다시 저장하세요');
  const before = readEnvFile(envPath);
  const base = current ?? readText(examplePath) ?? '';
  const next = applyEnvChanges(base, changes);
  // 쓰기 전에 되읽기 검증: 의도한 값만 바뀌는지
  const parsed = parseEnv(next) as Record<string, string>;
  for (const [k, v] of changes) {
    if ((parsed[k] ?? null) !== v) throw new Error(`.env 변경 검증 실패 (${k})`);
  }
  if (current === null || next !== current) writeAtomic(envPath, next);
  const state = readEnvFile(envPath);
  const changed = state.entries.filter((e, i) => e.fileValue !== before.entries[i].fileValue).map((e) => e.key);
  const applied: EnvKey[] = []; const restartRequired: EnvKey[] = []; const shellOverridden: EnvKey[] = [];
  for (const e of state.entries) {
    if (!changed.includes(e.key)) continue;
    if (e.shellOverride) { shellOverridden.push(e.key); continue; }
    if (SPEC.get(e.key)!.restartRequired) { restartRequired.push(e.key); continue; }
    if (e.fileValue === null) delete process.env[e.key]; else process.env[e.key] = e.fileValue;
    applied.push(e.key);
  }
  return { state: readEnvFile(envPath), changed, applied, restartRequired, shellOverridden };
}
