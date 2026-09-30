import type { AccidentSeverity, ComparePlatform, CompareVerdict, Grade, ModelMatchLevel, VehicleSortField } from '../../../src/types';

export const GRADES: readonly Grade[] = ['S', 'A+', 'A', 'B', 'C', 'D', 'F'];
export const PLATFORM_LABEL: Record<ComparePlatform, string> = { heydealer: '헤이딜러', kcar: '케이카', hyundai_certified: '현대 인증중고차' };
export const SORT_LABEL: Record<VehicleSortField, string> = { score: '점수 높은순', price: '가격 낮은순', mileage: '주행거리 짧은순', year: '연식 최신순' };
export const LEVEL_LABEL: Record<ModelMatchLevel, string> = {
  exact: '모델명 일치', base: '모델명 일치 (세대 코드 무시)', tokens: '키워드 일치', loose: '느슨한 키워드 일치 (세대 구분어 무시)',
};
export const SEVERITY_LABEL: Record<AccidentSeverity, string> = { none: '무사고', minor: '경미', moderate: '중간', severe: '심각', unknown: '금액 미상' };
export const USAGE_LABEL: Record<string, string> = { '1': '자가용', '2': '비영업용', '3': '영업/렌트', '4': '법인' };

/** 판정: 색만으로 구분하지 않도록 기호 + 텍스트를 함께 쓴다 (CLI 🟢🟡🟠🔴 에 대응) */
export const VERDICT_META: Record<CompareVerdict, { label: string; glyph: string; cls: string }> = {
  cheap: { label: '저렴함', glyph: '▼', cls: 'v-cheap' },
  fair: { label: '적정가', glyph: '＝', cls: 'v-fair' },
  slightly_expensive: { label: '다소 비쌈', glyph: '▲', cls: 'v-slight' },
  expensive: { label: '비쌈', glyph: '▲▲', cls: 'v-expensive' },
};

export type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'unknown';
export const TONE_META: Record<Tone, { label: string; glyph: string }> = {
  good: { label: '양호', glyph: '✓' },
  neutral: { label: '보통', glyph: '·' },
  warn: { label: '주의', glyph: '!' },
  bad: { label: '위험', glyph: '✕' },
  unknown: { label: '정보 없음', glyph: '?' },
};

/** reporter.percentileLabel 과 동일 */
export function percentileLabel(p: number): string { return p >= 60 ? '비싼 편' : p <= 40 ? '저렴한 편' : '중간 수준'; }
