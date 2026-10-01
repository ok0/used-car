export type Grade = 'S' | 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
export const GRADES: readonly Grade[] = ['S', 'A+', 'A', 'B', 'C', 'D', 'F'];
export type DiagnosisTier = 'BASIC' | 'PLUS' | 'PLUSPLUS';
export type OptionsStatus = 'ok' | 'partial' | 'failed' | 'none';

export interface StatusCounts { X: number; W: number; C: number; }
export interface RankCounts { ONE: StatusCounts; TWO: StatusCounts; A: StatusCounts; B: StatusCounts; }

export interface ScoreBreakdown {
  accident: number; mileage: number; price: number;
  inspection: number; rental: number; ownerChanges: number;
}
export interface ScoreResult {
  total: number;
  grade: Grade;
  breakdown: ScoreBreakdown;
  penalty: number;
}

export interface VehicleData {
  carId: string;
  actualCarId: string | null;
  vehicleNo: string | null;
  manufacturer: string | null;
  modelGroup: string | null;
  modelName: string | null;
  gradeName: string | null;
  gradeDetail: string | null;
  powertrainCluster: string | null;
  isDomestic: boolean;
  year: number;
  month: number;
  formYear: string | null;
  mileage: number;
  price: number;
  originPriceBase: number | null;
  originPriceOptions: number | null;
  originPrice: number | null;
  optionsStatus: OptionsStatus | null;
  fuelType: string | null;
  color: string | null;
  region: string | null;
  transmission: string | null;
  displacement: number | null;
  sellType: string | null;
  leaseType: string | null;
  isDuplication: boolean;
  firstAdvertisedAt: string | null;
  firstRegistrationDate: string | null;
  insuranceCount: number;
  myDamageCount: number;
  myDamageAmount: number;
  otherDamageCount: number;
  otherDamageAmount: number;
  isInsurancePrivate: boolean;
  hasUnavailablePeriod: boolean;
  unavailablePeriods: string[];
  ownerChangeCount: number;
  hasInspection: boolean;
  isInspectionPrivate: boolean;
  hasReplacement: boolean;
  hasWelding: boolean;
  hasCorrosion: boolean;
  rankCounts: RankCounts | null;
  hasDiagnosis: boolean;
  diagnosisTier: DiagnosisTier | null;
  diagFrameReplacement: boolean;
  diagPanelReplacement: boolean;
  hasRentalHistory: boolean;
  hasUsageChange: boolean;
  dealerUserId: string | null;
  dealerName: string | null;
  dealerFirmName: string | null;
  dealerJoinedAt: string | null;
  dealerTotalSales: number | null;
  scoreTotal: number | null;
  scoreGrade: Grade | null;
  scoreBreakdown: ScoreBreakdown | null;
  scorePenalty: number | null;
  collectedAt: string;
  searchQuery: string | null;
  lastSeenAt: string | null; // 엔카 목록에서 마지막으로 확인된 시각 (ISO 8601 UTC)
}

export interface AccidentRecord {
  accidentDate: string;
  insuranceBenefit: number | null;
  partCost: number | null;
  laborCost: number | null;
  paintingCost: number | null;
  isMajor: boolean;
}
export interface VehicleOption { optionCode: string; optionPrice: number | null; optionName: string | null; optionRaw: string | null; }
export type OptionChoice = 'loaded' | 'loaded_aftermarket' | 'absent' | 'unknown';
export type OptionAvailability = 'default' | 'available' | 'unavailable' | 'unknown';
export interface InputOptionItem { name: string; choice: OptionChoice; availability: OptionAvailability; }
export interface InputOptionPackage { name: string; price: number | null; items: string[]; }
export interface OwnerChange { changeDate: string; }
export interface UsageHistory { usageCode: string; seq: number; }
export interface MarketPrice {
  median: number; minPrice: number; maxPrice: number;
  p25: number; p75: number; sampleCount: number; collectedAt: string;
}
export interface YearlyPrice {
  age: number; year: number;
  avgPrice: number; count: number; collectedAt: string;
}

export type VehicleSortField = 'price' | 'score' | 'mileage' | 'year';
export interface VehicleFilters {
  model?: string;
  minScore?: number;
  sort?: VehicleSortField;
  limit?: number;
  excludeStaleAsOf?: Date; // 지정 시 이 시각 기준 STALE_DAYS 이상 미확인 매물 제외
}
export interface SimilarSearchOptions {
  gradeName?: string | null;
  yearRange?: number;
  mileageRatio?: number | null;
}
export interface SummaryStats {
  totalCount: number;
  lastCollectedAt: string | null;
  modelDistribution: { label: string; count: number }[];
  gradeDistribution: Record<Grade, number>;
  priceMin: number | null;
  priceMax: number | null;
  priceAvg: number | null;
  priceExcludedCount: number; // 가격 통계에서 제외된 대수 (가격 미정 9,999만원 이상 등)
  scoreAvg: number | null;
  activeCount: number;
  staleCount: number;
  staleDays: number;
  lastSeenAt: string | null;
}

export type ComparePlatform = 'heydealer' | 'kcar' | 'hyundai_certified';
export type AccidentSeverity = 'none' | 'minor' | 'moderate' | 'severe' | 'unknown';
/** 비교 입력 매물의 성능점검 요약. null 필드 = 알 수 없음 */
export interface InspectionInfo {
  label: string;
  isClean: boolean | null;
  hasReplacement: boolean | null;
  hasWelding: boolean | null;
  hasCorrosion: boolean | null;
}
export interface CompareInput {
  platform: ComparePlatform;
  sourceUrl: string | null;
  manufacturer: string | null;
  model: string;
  trim: string | null;
  year: number;               // 2자리 최초등록 연도 (vehicles.year와 동일 규약)
  month: number | null;       // 최초등록 월 (1~12)
  modelYear: number | null;   // 4자리 연형 (표시용)
  mileage: number;            // km
  price: number;              // 만원
  originPrice: number | null; // 신차가 (만원)
  fuelType: string | null;
  transmission: string | null;
  color: string | null;
  displacement: number | null;
  accidentCount: number | null;   // 내차피해 건수
  accidentAmount: number | null;  // 내차피해 보험금 합계 (원)
  hasSevereAccident: boolean | null;
  ownerChangeCount: number | null;
  hasRentalHistory: boolean | null;
  inspection: InspectionInfo | null;
  optionItems: InputOptionItem[] | null;
  optionPackages: InputOptionPackage[] | null;
}
export type CompareVerdict = 'cheap' | 'fair' | 'slightly_expensive' | 'expensive';
export type ModelMatchLevel = 'exact' | 'base' | 'tokens' | 'loose';
export interface MatchCriteria {
  modelMatchLevel: ModelMatchLevel | null;
  trim: string | null;
  trimApplied: boolean;
  trimSampleCount: number;
  yearFrom: number;
  yearTo: number;
  yearRange: number;
  minSamples: number;
  mileageRatio: number | null;
  basePoolCount: number;
}
export interface MarketMatch { criteria: MatchCriteria; basePool: VehicleData[]; peers: VehicleData[]; }
export interface MarketStats {
  sampleCount: number; mean: number; median: number;
  p25: number; p75: number; min: number; max: number;
}
export interface PriceBucket { from: number; to: number; count: number; }
export interface PriceComparison {
  inputPrice: number; diffAmount: number; diffPercent: number; medianDiff: number;
  percentile: number;
  withinIqr: boolean; iqrExcess: number;
  bucketWidth: number; buckets: PriceBucket[]; densestBucket: PriceBucket; inputBucket: PriceBucket | null;
  sameYear: { count: number; mean: number } | null;
}
export interface MileageComparison {
  inputMileage: number; peerAvgMileage: number | null; peerRatio: number | null;
  ageMonths: number; annualMileage: number; judgement: 'low' | 'normal' | 'high';
}
export interface AccidentComparison {
  inputAccidentCount: number | null; inputAccidentAmount: number | null;
  originPriceUsed: number | null; originPriceSource: 'input' | 'peer_avg' | null;
  amountRatio: number | null; severity: AccidentSeverity | null;
  peerKnownCount: number; peerAccidentFreeCount: number;
  peerAccidentFreeRatio: number | null; peerAvgAccidentCount: number | null;
}
export interface InspectionComparison {
  input: InspectionInfo | null;
  peerInspectableCount: number; peerCleanCount: number;
  peerCleanRatio: number | null; peerSameStateRatio: number | null; peerDiagnosisRatio: number | null;
}
export interface OwnerComparison {
  inputCount: number | null; peerAvgCount: number | null; deductionRate: number | null;
}
export interface RentalComparison {
  inputHasRental: boolean | null; peerRentalRatio: number | null; peerRentalCount: number; peerKnownCount: number;
}
export interface PackagePeerItem { name: string; withCount: number; matchedNames: string[]; }
export interface PackagePeerStats {
  poolCount: number;
  knownCount: number;
  items: PackagePeerItem[] | null;
}
export interface OptionComparison {
  items: InputOptionItem[] | null;
  packages: InputOptionPackage[] | null;
  packagesTotal: number | null;
  inputOriginPrice: number | null;
  peerOriginAvg: number | null;
  peerOriginCount: number;
  peerOriginScope: 'same_year' | 'all' | null;
  specDiffPercent: number | null;
  scope: 'options' | 'trim_and_options' | null;
  peerOptionAvg: number | null;
  peerNoOptionRatio: number | null;
  packagePeers: PackagePeerStats | null;
}
export type QualityAxis = 'accident' | 'inspection' | 'owner' | 'mileage' | 'rental';
export interface QualityFactor { axis: QualityAxis; points: number; reason: string; }
/** 사고 구성 보정의 한 항. 단위: 보험금 = 100만원(상한 적용), 교환·판금 = 0/1 (동급 평균은 비율) */
export interface AccidentCompositionTerm {
  input: number | null;      // 입력 값, null = 정보 미제공 (이 항 보정 0)
  peerMean: number | null;   // 동급 평균 (보험·점검 공개 동급만), 해당 동급이 없으면 null
  peerKnownCount: number;    // 평균에 쓴 동급 수
  percent: number;           // 계수 × (입력 − 동급 평균), 입력 또는 동급 정보가 없으면 0
}
/** 동급 대비 사고 심각도 차이로 예상되는 가격 차이 (구성 보정의 사고 항) */
export interface AccidentCompositionDiagnostics {
  amount: AccidentCompositionTerm;       // 내차피해 보험금
  replacement: AccidentCompositionTerm;  // 교환 (외판·골격)
  welding: AccidentCompositionTerm;      // 판금
  percent: number;                       // 세 항의 합 (반올림 전)
  peerAccidentCount: number;             // 보험이력 공개 동급 중 내차피해 1건 이상
  peerInsuranceKnownCount: number;       // 보험이력 공개 동급 수
  peerRepairCount: number;               // 점검 공개 동급 중 교환 또는 판금
  peerInspectableCount: number;          // 점검 공개 동급 수
}
/** 가격 비교 진단. compositionPercent = 동급 대비 차령·주행거리·렌트비율·사고(보험금·교환·판금) 차이만으로 예상되는 가격 차이(%), 판정에 반영 */
export interface PriceDiagnostics {
  inputAgeMonths: number;
  peerMeanAgeMonths: number;
  ageGapMonths: number;              // 입력 − 동급 평균 (양수 = 입력이 더 오래됨)
  peerMeanMileage: number;
  mileageGapKm: number;              // 입력 − 동급 평균
  peerRentalRatio: number | null;    // 보험이력 공개 동급 중 렌트 이력 비율
  compositionPercent: number;        // 소수 1자리 반올림
  peerLogSdPercent: number | null;   // ln(동급 가격) 표본표준편차×100, 동급 3대 미만이면 null
  meanStdErrPercent: number | null;  // peerLogSdPercent / sqrt(동급 수)
  ageTermPercent: number;            // compositionPercent 분해 (반올림 전): 차령
  mileageTermPercent: number;        // 주행거리
  rentalTermPercent: number;         // 렌트 이력
  accident: AccidentCompositionDiagnostics; // 사고 (accident.percent)
}

export interface VerdictDetail {
  verdict: CompareVerdict;
  diffPercent: number;
  specAdjustment: number;
  adjustedDiffPercent: number;
  basePremium: number;
  qualityAdjustment: number;
  allowedPremium: number;
  excessOverAllowance: number;
  compositionAdjustment: number;
  factors: QualityFactor[];
  criticalReasons: string[];
}
/** 유사 매물(가중 최근접 이웃) 거리 항목. 거리 = 항목별 "예상 가격 영향(%)"의 절대값 합 */
export type KnnTermKey = 'age' | 'mileage' | 'rental' | 'accident' | 'replacement' | 'welding' | 'basePrice' | 'options' | 'trim' | 'powertrain';
export interface KnnContribution { key: KnnTermKey; percent: number } // 이 항목의 거리 기여 (%p, 0보다 큰 항목만)
export interface KnnNeighbor {
  carId: string;
  modelName: string | null;
  gradeName: string | null;
  gradeDetail: string | null;
  year: number;
  month: number;
  mileage: number;
  price: number;                    // 엔카 호가 (만원)
  hasRentalHistory: boolean | null; // 보험이력 비공개면 null
  accidentAmount: number | null;    // 내차피해 보험금 (원), 비공개면 null
  hasReplacement: boolean | null;   // 교환(외판·골격, 엔카진단 포함). 점검 정보 없으면 null
  hasWelding: boolean | null;
  originPriceBase: number | null;   // 기본 신차가 (만원)
  originPriceOptions: number | null;// 선택옵션 신차가 합계 (만원)
  distance: number;                 // %p (작을수록 비슷함)
  weight: number;                   // 정규화 가중치 (합 1)
  adjustmentPercent: number;        // 입력 조건으로 맞춘 가격 보정 (%; 100·Δln가격)
  adjustedPrice: number;            // 보정 후 가격 (만원)
  contributions: KnnContribution[]; // 거리 기여 큰 순
}
export type KnnConfidence = 'high' | 'medium' | 'low';
export interface KnnAgreement {
  currentPercent: number;  // 현재 평가: 보정 후 가격 차이 (judgement.adjustedDiffPercent)
  knnPercent: number;      // 유사 매물 평가: 기대 가격 대비 차이 (KnnResult.diffPercent)
  gap: number;             // knnPercent − currentPercent (%p)
  sameVerdict: boolean;
  level: 'agree' | 'minor' | 'major'; // |gap| < 3 / < 6 / 그 이상
}
export interface KnnResult {
  k: number;                    // 사용한 이웃 수 (후보가 적으면 그보다 작음)
  candidateCount: number;       // 같은 모델 후보 대수 (연식 제한 없음)
  neighbors: KnnNeighbor[];     // 거리 오름차순
  expectedPrice: number;        // 기대 가격 (만원)
  intervalLow: number;          // 95% 예측구간 (만원)
  intervalHigh: number;
  diffPercent: number;          // (입력 가격 / 기대 가격 − 1) × 100
  meanDistance: number;         // 가중 평균 거리 (%p)
  effectiveCount: number;       // 유효 이웃 수 (Σw)²/Σw²
  closeCount: number;           // 거리 10%p 이하 이웃 수
  confidence: KnnConfidence;
  usedTerms: KnnTermKey[];      // 입력에 값이 있어 거리·보정에 쓴 항목
  missingTerms: KnnTermKey[];   // 입력에 값이 없어 뺀 항목 (예측구간에 불확실성으로 반영)
  inputBasePrice: number | null;
  basePriceSource: 'input' | 'trim_peers' | 'origin_estimate' | null;
  inputOptionPercent: number | null; // 선택옵션 신차가 / 기본 신차가 × 100
  basePremium: number;          // 플랫폼 기본 프리미엄 (품질 가감 없음 — 품질은 기대 가격에 이미 반영)
  excessOverAllowance: number;  // diffPercent − basePremium
  verdict: CompareVerdict;      // 현재 판정과 같은 구간 규칙 (참고용)
  agreement: KnnAgreement;
  primary: boolean;             // COMPARE_VERDICT_SOURCE=knn 이면 true (종합 판정에 이 결과 사용)
  warnings: string[];
}
export interface CompareResult {
  input: CompareInput;
  criteria: MatchCriteria;
  sampleCount: number;
  isLowSample: boolean;
  market: MarketStats;
  price: PriceComparison;
  mileage: MileageComparison;
  accident: AccidentComparison;
  inspection: InspectionComparison;
  owner: OwnerComparison;
  rental: RentalComparison;
  option: OptionComparison;
  judgement: VerdictDetail;
  diagnostics: PriceDiagnostics;
  knn: KnnResult | null;        // 유사 매물 평가 (COMPARE_KNN=0 이거나 후보 없음 = null)
}

/** 엔카 검색 API(SearchResults[]) 1건의 기본 정보 */
export interface SearchResult {
  carId: string;              // Id
  manufacturer: string | null; // Manufacturer
  model: string | null;        // Model (e.g., "5시리즈 (G30)")
  badge: string | null;        // Badge
  badgeDetail: string | null;  // BadgeDetail (기본 응답엔 대개 없음)
  yearMonth: number | null;    // Year, YYYYMM (e.g., 201805)
  formYear: string | null;     // FormYear
  mileage: number | null;      // Mileage (km)
  price: number | null;        // Price (만원)
  fuelType: string | null;     // FuelType
  color: string | null;        // Color (기본 응답엔 대개 없음)
  region: string | null;       // OfficeCityState
  sellType: string | null;     // SellType
  leaseType: string | null;    // LeaseType
  serviceCopyCar: string | null; // ServiceCopyCar ("ORIGINAL" | "DUPLICATION")
}

/** 상세 크롤러(Step 4) 산출 번들: vehicles 1행 + 1:N 자식 데이터.
 *  vehicle.score* 필드는 Step 5 스코어링에서 채우며 Step 4에서는 null. */
export interface CollectedVehicle {
  vehicle: VehicleData;
  accidents: AccidentRecord[];
  options: VehicleOption[];
  ownerChanges: OwnerChange[];
  usageHistory: UsageHistory[];
  marketPrice: MarketPrice | null;
  yearlyPrices: YearlyPrice[];
}

export interface ScoreWeights {
  accident: number; mileage: number; price: number;
  inspection: number; rental: number; ownerChanges: number;
}
/** 로컬 DB 동일 모델·트림·연식 매물 평균가 (만원, 반올림 정수) */
export interface LocalPriceBaseline { avgPrice: number; sampleCount: number; }
/** getLocalPriceBaseline 조회 키. gradeDetail은 호출 측에서 hasValidDetail 통과 시에만 값, 아니면 null */
export interface PriceBaselineKey {
  carId: string;
  modelGroup: string | null;
  modelName: string | null;
  gradeName: string | null;
  gradeDetail: string | null;
  powertrainCluster: string | null;
  year: number; // 2자리 연식 (vehicles.year와 동일 규약)
}

/** 비교 요청별 동급 조건·판정 설정 덮어쓰기 (생략 = 환경변수/기본값) */
export interface CompareSettingsOverride {
  yearRange?: number;                // 연식 ±N년 (0~10 정수)
  mileagePercents?: number[] | null; // 주행거리 ±% 단계 (1~5개, 각 0 초과 500 이하). null = 제한 없음
  minSamples?: number;               // 최소 표본 (1~100 정수)
  specMaxAdjust?: number;            // 사양 보정 상한 % (0~30 정수, 0 = 끔)
  knnN?: number;                     // 유사 매물 이웃 수 (5~200 정수)
}

/** 목록·동급 표 1행 (VehicleData 요약) */
export interface VehicleListItem {
  carId: string;
  manufacturer: string | null;
  modelName: string | null;
  gradeName: string | null;
  gradeDetail: string | null;
  year: number;
  month: number;
  mileage: number;
  price: number;
  scoreGrade: Grade | null;
  scoreTotal: number | null;
  myDamageCount: number;
  isInsurancePrivate: boolean;
  ownerChangeCount: number;
  hasRentalHistory: boolean;
  lastSeenAt: string | null;
  stale: boolean; // STALE_DAYS 이상 엔카 목록에서 미확인
}

/** 가격 점수 기준 (detail 명령과 동일하게 현재 DB로 재구성) */
export interface PriceBaselineInfo {
  source: 'yearly' | 'local' | 'none';
  avgPrice: number | null;
  sampleCount: number | null;
  localSampleCount: number; // 로컬 동일 조건 표본 수 (기준 없음 안내용)
  minLocalSamples: number;  // 로컬 기준 최소 표본 (MIN_LOCAL_PRICE_SAMPLES)
}

/** 매물 상세 (vehicles 1행 + 자식 데이터 + 파생값) */
export interface VehicleDetail {
  vehicle: VehicleData;
  stale: boolean;
  staleDays: number;
  priceBaseline: PriceBaselineInfo;
  marketPrice: MarketPrice | null;
  yearlyPrices: YearlyPrice[];
  accidents: AccidentRecord[];
  ownerChanges: OwnerChange[];
  usageHistory: UsageHistory[];
  options: VehicleOption[];
}
