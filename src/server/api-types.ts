// 서버·웹 공유 API 타입.
// 규칙: 이 파일은 '../types' 에서만 `import type` 한다 (웹 tsconfig가 이 파일을 함께 타입체크하므로 Node 의존 모듈 금지).
import type {
  CompareInput, ComparePlatform, CompareResult, CompareSettingsOverride, SummaryStats,
  VehicleDetail, VehicleListItem, VehicleSortField, ScoreWeights,
} from '../types';

export type { CompareSettingsOverride, VehicleDetail, VehicleListItem };

export type ApiErrorCode =
  | 'BAD_REQUEST' | 'INVALID_INPUT' | 'INVALID_URL' | 'UNSUPPORTED_URL' | 'PLATFORM_MISMATCH'
  | 'NOT_FOUND' | 'LISTING_NOT_FOUND' | 'EMPTY_DB' | 'NO_PEERS'
  | 'FETCH_FAILED' | 'BUSY' | 'INVALID_CONFIG'
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
  peers: VehicleListItem[];          // 동급 매물 (가격 오름차순)
  analyzedAt: string;                // ISO 8601
}
