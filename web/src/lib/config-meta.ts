// 설정 화면 라벨·설명 (.env 키별)
import type { ConfigKey } from '../../../src/server/api-types';

export type ConfigGroup = 'collect' | 'compare' | 'stale' | 'gui';
export const CONFIG_GROUP_LABEL: Record<ConfigGroup, string> = { collect: '수집', compare: '비교 (동급매물 조건)', stale: '미확인 매물', gui: 'GUI 서버' };
export const CONFIG_META: Record<ConfigKey, { group: ConfigGroup; label: string; help: string }> = {
  ENCAR_FETCH_MARKET: { group: 'collect', label: '동급매물 시세 수집', help: '수집할 때 엔카 동급매물 시세(중앙값, P25/P75 등)도 조회해 저장합니다. 매물마다 요청이 늘어 차단 위험이 커집니다.' },
  ENCAR_FETCH_YEARLY: { group: 'collect', label: '연식별 시세 수집', help: '연식별 평균 시세를 조회해 가격 점수 기준으로 씁니다. 끄면 DB의 동일 조건 매물 평균을 씁니다. 요청이 늘어납니다.' },
  COMPARE_MILEAGE_RANGE: { group: 'compare', label: '주행거리 범위 (±%)', help: '콤마로 여러 단계(예: 40,60)를 주면 표본이 모자랄 때 앞에서부터 넓힙니다. none 이면 제한 없음.' },
  COMPARE_YEAR_RANGE: { group: 'compare', label: '연식 범위 (±년)', help: '최초등록 연식 기준. 0 이상의 정수.' },
  COMPARE_MIN_SAMPLES: { group: 'compare', label: '최소 표본 수', help: '이보다 적으면 범위를 넓히거나 경고합니다. 1 이상의 정수.' },
  COMPARE_SPEC_MAX_ADJUST: { group: 'compare', label: '옵션·사양 보정 상한 (%)', help: '0 이상의 정수. 0이면 보정하지 않습니다.' },
  COMPARE_PREMIUM_HEYDEALER: { group: 'compare', label: '헤이딜러 기본 프리미엄 (%)', help: '엔카 동급 시세보다 이만큼 비싸도 되는 기본 허용치(상품화 프리미엄). 비교 시 품질 보정이 더해지며 결과는 0~10%. 0~10 정수.' },
  COMPARE_PREMIUM_KCAR: { group: 'compare', label: '케이카 기본 프리미엄 (%)', help: '엔카 동급 시세보다 이만큼 비싸도 되는 기본 허용치(상품화 프리미엄). 비교 시 품질 보정이 더해지며 결과는 0~10%. 0~10 정수.' },
  COMPARE_PREMIUM_HYUNDAI_CERTIFIED: { group: 'compare', label: '현대 인증중고차 기본 프리미엄 (%)', help: '엔카 동급 시세보다 이만큼 비싸도 되는 기본 허용치(상품화 프리미엄). 비교 시 품질 보정이 더해지며 결과는 0~10%. 0~10 정수.' },
  STALE_DAYS: { group: 'stale', label: '미확인 기준 (일)', help: '엔카 목록에서 이 일수 이상 확인되지 않은 매물을 비교·시세에서 빼고 정리 대상으로 삼습니다. 0이면 끔. 저장된 점수는 다음 수집·정리 때 다시 계산됩니다.' },
  GUI_PORT: { group: 'gui', label: 'GUI 포트', help: '1~65535. 서버를 다시 시작해야 적용됩니다.' },
};
export function isFlagOn(v: string | null): boolean { return v !== null && /^(1|true|on|yes)$/i.test(v.trim()); }
