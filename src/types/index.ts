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
export interface VerdictDetail {
  verdict: CompareVerdict;
  diffPercent: number;
  specAdjustment: number;
  adjustedDiffPercent: number;
  basePremium: number;
  qualityAdjustment: number;
  allowedPremium: number;
  excessOverAllowance: number;
  factors: QualityFactor[];
  criticalReasons: string[];
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
