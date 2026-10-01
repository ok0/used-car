// 서버·웹 공유 API 타입.
// 규칙: 이 파일은 '../types' 에서만 `import type` 한다 (웹 tsconfig가 이 파일을 함께 타입체크하므로 Node 의존 모듈 금지).
import type {
  CompareInput, ComparePlatform, CompareResult, CompareSettingsOverride, SummaryStats,
  VehicleDetail, VehicleListItem, VehicleSortField, ScoreWeights, Grade,
} from '../types';

export type { CompareSettingsOverride, VehicleDetail, VehicleListItem };

export type ApiErrorCode =
  | 'BAD_REQUEST' | 'INVALID_INPUT' | 'INVALID_URL' | 'UNSUPPORTED_URL' | 'PLATFORM_MISMATCH'
  | 'NOT_FOUND' | 'LISTING_NOT_FOUND' | 'EMPTY_DB' | 'NO_PEERS'
  | 'FETCH_FAILED' | 'BUSY' | 'INVALID_CONFIG'
  | 'JOB_RUNNING' | 'LOCKED' | 'BLOCKED' | 'ENV_CHANGED'
  | 'PURGE_DISABLED' | 'NOTHING_TO_PURGE' | 'PURGE_OVER_CAP' | 'PURGE_CHANGED'
  | 'FORBIDDEN' | 'UNSUPPORTED_MEDIA_TYPE' | 'INTERNAL';

/** 모든 오류 응답 본문 */
export interface ApiErrorBody { error: { code: ApiErrorCode; message: string; details: string[] } }

/** 변이·비교 요청(POST)에 반드시 붙이는 헤더 (CSRF 방지) */
export const CLIENT_HEADER = 'x-used-car-client';
export const CLIENT_HEADER_VALUE = 'web';

// GET /api/health
export interface HealthResponse { ok: true }

// GET /api/settings
export interface CompareSettingsInfo {
  yearRange: number;
  mileagePercents: number[] | null; // null = 주행거리 제한 없음
  minSamples: number;
  specMaxAdjust: number;
  hyundaiPremium: number;
  knnEnabled: boolean;               // COMPARE_KNN
  knnN: number;                      // 유사 매물 이웃 수 (요청 덮어쓰기 반영)
  verdictSource: 'current' | 'knn';  // COMPARE_VERDICT_SOURCE (종합 판정에 쓰는 평가)
}
export interface SettingsResponse { compare: CompareSettingsInfo; staleDays: number }

// GET /api/summary
export interface SummaryResponse { summary: SummaryStats }

// GET /api/vehicles?model=&minScore=&sort=
export interface VehicleListResponse {
  items: VehicleListItem[];   // 조건 일치 전체 (정렬 적용, 개수 제한 없음)
  staleDays: number;
  query: { model: string | null; minScore: number | null; sort: VehicleSortField };
}

// GET /api/vehicles/:carId
export interface VehicleDetailResponse extends VehicleDetail {
  weights: ScoreWeights; // 항목별 만점
  encarUrl: string;
}

// POST /api/compare
export interface CompareRequestBody {
  url?: string;                 // 있으면 URL 모드 (헤이딜러/현대 인증중고차 상세)
  platform?: ComparePlatform;   // 수동 모드 필수
  model?: string;
  trim?: string;
  year?: number;                // 2자리 또는 4자리
  month?: number;
  mileage?: number;             // km
  price?: number;               // 만원
  accidentCount?: number;
  accidentAmount?: number;      // 원
  ownerChanges?: number;
  rental?: boolean;
  inspection?: string;
  settings?: CompareSettingsOverride;
}
export interface CompareResponse {
  title: string;                     // 표시용 제목 (reporter.inputTitle)
  site: 'heydealer' | 'hyundai_certified' | null;
  warnings: string[];                // 파싱 경고
  notes: string[];                   // 참고 (현대 인증중고차)
  overridden: string[];              // URL 모드에서 수동 값으로 덮어쓴 항목 (한글 라벨)
  settings: CompareSettingsInfo;     // 이번 비교에 실제 적용된 조건
  input: CompareInput;
  result: CompareResult;
  verdictLines: string[];            // reporter.buildVerdictLines
  recommendations: string[];         // reporter.buildRecommendations
  knnLines: string[];                // reporter.buildKnnLines (유사 매물 평가 요약, 꺼져 있으면 [])
  peers: VehicleListItem[];          // 동급 매물 (가격 오름차순)
  analyzedAt: string;                // ISO 8601
}

// ───────── 2단계: 수집 작업 · 정리 · 설정 ─────────

// POST /api/collect/preview  (엔카 목록 API 1회 호출)
export interface CollectPreviewRequest { url: string }
export interface CollectPreviewResponse {
  searchQuery: string;
  totalCount: number | null;  // 엔카 검색 결과 총 대수 (렌트·리스·중복매물 제외 전)
  pages: number | null;       // totalCount / pageSize 올림
  pageSize: number;
}

// POST /api/jobs/collect
export interface CollectJobRequest {
  url: string;
  startPage?: number;         // 1 이상 (기본 1)
  maxPages?: number | null;   // 1 이상, null/생략 = 끝까지
  limit?: number | null;      // 1 이상, null/생략 = 전부
  skipExisting?: boolean;
  prune?: boolean;            // startPage=1, maxPages·limit 없음일 때만
  fetchMarket?: boolean;      // 이번 실행에만. 생략 = 현재 ENCAR_FETCH_MARKET
  fetchYearly?: boolean;      // 이번 실행에만. 생략 = 현재 ENCAR_FETCH_YEARLY
}
export interface CollectJobParams {
  url: string; searchQuery: string;
  startPage: number; maxPages: number | null; limit: number | null;
  skipExisting: boolean; prune: boolean; fetchMarket: boolean; fetchYearly: boolean;
}
export type JobState = 'running' | 'completed' | 'interrupted' | 'blocked' | 'failed';
export type CollectPhase = 'starting' | 'list' | 'detail' | 'prune' | 'rescore' | 'done';
export interface CollectProgress {
  phase: CollectPhase;
  listPage: number | null;     // 목록 단계: 방금 처리한 페이지
  listLastPage: number | null; // 목록 단계: 마지막 예상 페이지 (검색 총건수·최대 페이지 기준)
  listed: number | null;       // 목록에서 찾은 유효 매물 (목록 단계 끝나면 채워짐)
  skippedExisting: number;
  targeted: number | null;     // 상세 수집 대상
  completed: number;           // 상세 처리 완료 (성공+실패)
  saved: number;
  failed: number;
}
export interface PruneResultInfo {
  mode: 'report' | 'prune';
  ownedCount: number; candidates: number; recheckFound: number; deleted: number;
  backupPath: string | null; skippedReason: string | null;
}
export interface CollectJobResult {
  status: 'completed' | 'interrupted' | 'blocked';
  searchQuery: string;
  listed: number; skippedExisting: number; targeted: number;
  saved: number; failed: { carId: string; error: string }[]; pending: number;
  gradeDistribution: Record<Grade, number>;   // 이번에 저장된 매물 (재채점 후)
  avgScore: number | null; avgPrice: number | null;
  rescored: { total: number; changed: number } | null;
  prune: PruneResultInfo | null;
  seenUpdated: number;
  stale: { days: number; count: number } | null;
}
export interface JobSnapshot {
  id: string;
  kind: 'collect';
  state: JobState;
  stopRequested: boolean;
  params: CollectJobParams;
  startedAt: string;
  finishedAt: string | null;
  progress: CollectProgress;
  log: string[];               // 보관 중인 로그 (최근 MAX_JOB_LOG_LINES 줄)
  logDropped: number;          // 보관 한도로 버린 앞부분 줄 수
  result: CollectJobResult | null;  // state 가 completed/interrupted/blocked(상세 단계)일 때
  error: string | null;             // failed, 또는 목록 단계 차단(blocked, result=null)의 메시지
}
export const MAX_JOB_LOG_LINES = 2000;
// POST /api/jobs/collect → 202, GET /api/jobs/:id, POST /api/jobs/:id/stop → 200
export interface JobResponse { job: JobSnapshot }
// GET /api/jobs/current — 실행 중 작업, 없으면 마지막으로 끝난 작업(서버 재시작 전 것은 없음)
export interface CurrentJobResponse { job: JobSnapshot | null }
// GET /api/jobs/:id/events (text/event-stream). 연결(재연결 포함)마다 snapshot 을 먼저 보낸 뒤 변경분을 보낸다
export type JobStreamEvent =
  | { event: 'snapshot'; data: JobSnapshot }
  | { event: 'log'; data: { from: number; lines: string[] } }  // from = 첫 줄의 전체 순번 (0부터). 클라이언트는 logDropped+log.length 이상만 붙인다
  | { event: 'progress'; data: CollectProgress }
  | { event: 'state'; data: { state: JobState; stopRequested: boolean } }
  | { event: 'end'; data: JobSnapshot };   // 작업 종료 후 서버가 스트림을 닫는다 (클라이언트는 EventSource.close())

// GET /api/purge/preview
export interface StaleBreakdownInfo { label: string; total: number; stale: number; lastSeenMax: string | null }
export interface PurgePreviewResponse {
  staleDays: number;
  cutoff: string | null;           // null = STALE_DAYS=0 (끔)
  totalCount: number;
  candidateCount: number;
  pct: number;                     // candidateCount / totalCount (정수 %)
  maxRatio: number;                // 0.5
  overCap: boolean;
  backupPath: string;
  breakdown: StaleBreakdownInfo[];
  candidates: VehicleListItem[];   // 마지막 확인 오래된 순, 전부
  jobRunning: boolean;             // 수집 작업 중이면 삭제 불가 (409 JOB_RUNNING)
}
// POST /api/purge
export interface PurgeApplyRequest { confirmCount: number }  // 화면에서 사용자가 입력한 대상 대수 (서버가 다시 센 값과 같아야 삭제)
export interface PurgeApplyResponse {
  deleted: number;
  kept: number;                    // 그사이 다시 확인되어 유지
  backupPath: string;
  rescored: { total: number; changed: number };
}

// GET /api/config, POST /api/config
export type ConfigKey =
  | 'ENCAR_FETCH_MARKET' | 'ENCAR_FETCH_YEARLY'
  | 'COMPARE_MILEAGE_RANGE' | 'COMPARE_YEAR_RANGE' | 'COMPARE_MIN_SAMPLES' | 'COMPARE_SPEC_MAX_ADJUST'
  | 'COMPARE_PREMIUM_HEYDEALER' | 'COMPARE_PREMIUM_KCAR' | 'COMPARE_PREMIUM_HYUNDAI_CERTIFIED'
  | 'COMPARE_KNN' | 'COMPARE_KNN_N' | 'COMPARE_VERDICT_SOURCE'
  | 'STALE_DAYS' | 'GUI_PORT';
export interface ConfigEntry {
  key: ConfigKey;
  kind: 'flag' | 'text';
  defaultText: string;
  restartRequired: boolean;
  fileValue: string | null;       // .env 의 값 (없으면 null = 기본값)
  effectiveValue: string | null;  // 실행 중 서버의 값
  shellOverride: boolean;         // 실행 환경변수가 우선 (.env 값 무시됨)
}
export interface ConfigResponse {
  envPath: string;
  exists: boolean;
  revision: string;               // 저장 시 그대로 돌려보냄 (다른 곳에서 바뀌었으면 409 ENV_CHANGED)
  dbPath: string;                 // 참고 (USED_CAR_DB 는 화면에서 바꾸지 않음)
  jobRunning: boolean;            // 수집 작업 중에는 저장 불가 (409 JOB_RUNNING)
  entries: ConfigEntry[];
}
export interface ConfigSaveRequest { revision: string; values: Partial<Record<ConfigKey, string | null>> } // null 또는 '' = 기본값(주석 처리)
export interface ConfigSaveResponse extends ConfigResponse {
  changed: ConfigKey[]; applied: ConfigKey[]; restartRequired: ConfigKey[]; shellOverridden: ConfigKey[];
}
