import type { AccidentRecord, DiagnosisTier, MarketPrice, OptionsStatus, RankCounts, VehicleOption, YearlyPrice } from '../types';

// ===== Raw types (all export) =====
export interface RawVehicle {
  vehicleId?: number | string;
  vehicleNo?: string;
  category?: {
    manufacturerName?: string; modelGroupName?: string; modelName?: string;
    gradeName?: string; gradeDetailName?: string; yearMonth?: string | number;
    formYear?: string | number; domestic?: boolean; originPrice?: number;
  };
  spec?: { mileage?: number; displacement?: number; transmissionName?: string; fuelName?: string; colorName?: string };
  advertisement?: { price?: number; preVerified?: boolean };
  options?: { choice?: (string | number)[] };
  condition?: { accident?: { recordView?: boolean }; inspection?: { formats?: unknown[] } };
  contact?: { userId?: string };
  partnership?: { dealer?: { name?: string; firm?: { name?: string } }; diag2Partnered?: boolean };
  manage?: { firstAdvertisedDateTime?: string };
}
export interface RawRecordAccident { date?: unknown; insuranceBenefit?: unknown; partCost?: unknown; laborCost?: unknown; paintingCost?: unknown; }
export interface RawRecord {
  openData?: boolean; accidentCnt?: number; myAccidentCnt?: number; myAccidentCost?: number;
  otherAccidentCnt?: number; otherAccidentCost?: number; ownerChangeCnt?: number;
  ownerChanges?: unknown[]; firstDate?: string | null; accidents?: RawRecordAccident[];
  carInfoUse1s?: unknown[];
  notJoinDate1?: string | null; notJoinDate2?: string | null; notJoinDate3?: string | null;
  notJoinDate4?: string | null; notJoinDate5?: string | null;
}
export interface RawInspectionOuter { statusTypes?: { code?: string }[]; status?: unknown; attributes?: string[]; }
export interface RawInspection { outers?: RawInspectionOuter[]; }
export interface RawDiagnosis { items?: { name?: string; resultCode?: string }[]; }
export interface RawOptionItem { optionCd?: string | number; price?: number | null; [key: string]: unknown; }
export interface RawUser { joinedDatetime?: string; salesStatus?: { totalSales?: number }; }
export interface RawSearchItem {
  Id?: unknown; Price?: unknown; Model?: unknown; Badge?: unknown; BadgeDetail?: unknown;
  Year?: unknown; FormYear?: unknown; Mileage?: unknown; SellType?: unknown; LeaseType?: unknown; ServiceCopyCar?: unknown;
}
export interface RawSearchResponse { Count?: number; count?: number; SearchResults?: RawSearchItem[]; }

// ===== Helpers =====
export const SEARCH_API = 'https://api.encar.com/search/car/list/general';
export const DUMMY_DETAIL_RE = /세부등급\s*없음|없음|^-$|^기타$/i;

export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function hasValidDetail(detail: string | null | undefined): boolean {
  return !!detail && !DUMMY_DETAIL_RE.test(detail);
}

export function getPowertrainCluster(badge: string | null | undefined, badgeDetail: string | null | undefined = ''): string | null {
  const text = `${badge || ''} ${badgeDetail || ''}`.trim();
  const match = text.match(/(?:^|\s)(?:xDrive|sDrive)?\s*M?(\d{2,3}(?:e|d|i))(?=\s|$)/i);
  return match ? match[1].toLowerCase() : null;
}

export function isSearchDslValueSafe(value: unknown): boolean {
  return value != null && !String(value).includes('.');
}

// ===== Year/Month parsing =====
export function parseYearMonth(ym: unknown): { year: number; month: number } {
  const s = ym == null ? '' : String(ym);
  const year = s.length >= 4 ? parseInt(s.slice(2, 4), 10) : 0;
  const month = s.length >= 6 ? parseInt(s.slice(4, 6), 10) : 0;
  return {
    year: Number.isNaN(year) ? 0 : year,
    month: Number.isNaN(month) ? 0 : month,
  };
}

// ===== Record parsing =====
export interface ParsedRecord {
  insuranceCount: number;
  myDamageCount: number;
  myDamageAmount: number;
  otherDamageCount: number;
  otherDamageAmount: number;
  isInsurancePrivate: boolean;
  hasUnavailablePeriod: boolean;
  unavailablePeriods: string[];
  ownerChangeCount: number;
  ownerChanges: string[];
  firstRegistrationDate: string | null;
  usageCodes: string[];
  hasRentalHistory: boolean;
  hasUsageChange: boolean;
  rawAccidents: RawRecordAccident[];
}

export function parseRecord(data: RawRecord | null, forcePrivate: boolean = false): ParsedRecord {
  if (forcePrivate || !data) {
    return {
      insuranceCount: 0,
      myDamageCount: 0,
      myDamageAmount: 0,
      otherDamageCount: 0,
      otherDamageAmount: 0,
      isInsurancePrivate: true,
      hasUnavailablePeriod: false,
      unavailablePeriods: [],
      ownerChangeCount: 0,
      ownerChanges: [],
      firstRegistrationDate: null,
      usageCodes: [],
      hasRentalHistory: false,
      hasUsageChange: false,
      rawAccidents: [],
    };
  }

  const isInsurancePrivate = data.openData === false;
  const insuranceCount = data.accidentCnt ?? 0;
  const myDamageCount = data.myAccidentCnt ?? 0;
  const myDamageAmount = data.myAccidentCost ?? 0;
  const otherDamageCount = data.otherAccidentCnt ?? 0;
  const otherDamageAmount = data.otherAccidentCost ?? 0;
  const ownerChangeCount = data.ownerChangeCnt ?? 0;

  const ownerChanges = !isInsurancePrivate && Array.isArray(data.ownerChanges)
    ? data.ownerChanges.filter((d): d is string => typeof d === 'string')
    : [];

  const firstRegistrationDate = !isInsurancePrivate ? (data.firstDate ?? null) : null;

  const rawAccidents = Array.isArray(data.accidents)
    ? data.accidents.filter(a => a !== null && typeof a === 'object')
    : [];

  const usageCodes = (Array.isArray(data.carInfoUse1s) ? data.carInfoUse1s : []).map(c => String(c));
  const hasRentalHistory = usageCodes.some(c => c === '3' || c === '4');
  const hasUsageChange = usageCodes.length > 1;

  const unavailablePeriods = [data.notJoinDate1, data.notJoinDate2, data.notJoinDate3, data.notJoinDate4, data.notJoinDate5]
    .filter(Boolean)
    .map(v => String(v));
  const hasUnavailablePeriod = unavailablePeriods.length > 0;

  return {
    insuranceCount,
    myDamageCount,
    myDamageAmount,
    otherDamageCount,
    otherDamageAmount,
    isInsurancePrivate,
    hasUnavailablePeriod,
    unavailablePeriods,
    ownerChangeCount,
    ownerChanges,
    firstRegistrationDate,
    usageCodes,
    hasRentalHistory,
    hasUsageChange,
    rawAccidents,
  };
}

// ===== Accident building =====
export function buildAccidentRecords(raw: RawRecordAccident[], originPrice: number | null): AccidentRecord[] {
  return raw.map(a => {
    const insuranceBenefit = finiteOrNull(a.insuranceBenefit);
    const partCost = finiteOrNull(a.partCost);
    const laborCost = finiteOrNull(a.laborCost);
    const paintingCost = finiteOrNull(a.paintingCost);
    const accidentDate = typeof a.date === 'string' ? a.date : '';

    const isMajor = originPrice !== null && originPrice > 0 &&
      ((insuranceBenefit ?? 0) >= originPrice * 10000 * 0.15 || (laborCost ?? 0) >= originPrice * 10000 * 0.07);

    return {
      accidentDate,
      insuranceBenefit,
      partCost,
      laborCost,
      paintingCost,
      isMajor,
    };
  });
}

// ===== Inspection parsing =====
export function parseInspection(data: RawInspection | null): {
  hasInspection: boolean;
  hasReplacement: boolean;
  hasWelding: boolean;
  hasCorrosion: boolean;
  rankCounts: RankCounts | null;
} {
  if (!data) {
    return {
      hasInspection: false,
      hasReplacement: false,
      hasWelding: false,
      hasCorrosion: false,
      rankCounts: null,
    };
  }

  const outers = data.outers ?? [];
  const is = (v: unknown, set: readonly string[]) => typeof v === 'string' && set.includes(v);

  const rankCounts: RankCounts = {
    ONE: { X: 0, W: 0, C: 0 },
    TWO: { X: 0, W: 0, C: 0 },
    A: { X: 0, W: 0, C: 0 },
    B: { X: 0, W: 0, C: 0 },
  };

  for (const item of outers) {
    const hasX = !!item.statusTypes?.some(s => s.code === 'X') || item.status === 'X';
    const hasW = !!item.statusTypes?.some(s => is(s.code, ['/', 'W'])) || is(item.status, ['/', 'W']);
    const hasC = !!item.statusTypes?.some(s => is(s.code, ['C', 'U'])) || is(item.status, ['C', 'U']);

    const attrs = item.attributes ?? [];
    const rank = attrs.includes('RANK_B') ? 'B'
      : attrs.includes('RANK_A') ? 'A'
        : attrs.includes('RANK_TWO') ? 'TWO'
          : 'ONE';

    if (hasX) rankCounts[rank].X++;
    if (hasW) rankCounts[rank].W++;
    if (hasC) rankCounts[rank].C++;
  }

  const hasReplacement = outers.some(p => p.statusTypes?.some(st => st.code === 'X') || p.status === 'X');
  const hasWelding = outers.some(p => p.statusTypes?.some(st => is(st.code, ['/', 'W'])) || is(p.status, ['/', 'W']));
  const hasCorrosion = outers.some(p => p.statusTypes?.some(st => is(st.code, ['C', 'U'])) || is(p.status, ['C', 'U']));

  return {
    hasInspection: true,
    hasReplacement,
    hasWelding,
    hasCorrosion,
    rankCounts,
  };
}

// ===== Diagnosis parsing =====
export function parseDiagnosis(data: RawDiagnosis | null, vehicle: RawVehicle): {
  hasDiagnosis: boolean;
  diagnosisTier: DiagnosisTier | null;
  diagFrameReplacement: boolean;
  diagPanelReplacement: boolean;
} {
  if (!data || !Array.isArray(data.items) || data.items.length === 0) {
    return {
      hasDiagnosis: false,
      diagnosisTier: null,
      diagFrameReplacement: false,
      diagPanelReplacement: false,
    };
  }

  const diag2Partnered = vehicle.partnership?.diag2Partnered ?? false;
  const preVerified = vehicle.advertisement?.preVerified ?? false;
  const diagnosisTier: DiagnosisTier = diag2Partnered ? 'PLUSPLUS' : preVerified ? 'PLUS' : 'BASIC';

  const OUTER_PANEL_NAMES = new Set([
    'FRONT_DOOR_LEFT', 'FRONT_DOOR_RIGHT',
    'BACK_DOOR_LEFT', 'BACK_DOOR_RIGHT',
    'HOOD', 'TRUNK_LID',
    'FRONT_FENDER_LEFT', 'FRONT_FENDER_RIGHT',
    'QUARTER_PANEL_LEFT', 'QUARTER_PANEL_RIGHT',
  ]);
  const COMMENT_NAMES = new Set(['CHECKER_COMMENT', 'OUTER_PANEL_COMMENT']);

  const replaced = data.items.filter(item => item.resultCode === 'REPLACEMENT');
  const diagPanelReplacement = replaced.some(item => OUTER_PANEL_NAMES.has(item.name ?? ''));
  const diagFrameReplacement = replaced.some(item => !OUTER_PANEL_NAMES.has(item.name ?? '') && !COMMENT_NAMES.has(item.name ?? ''));

  return {
    hasDiagnosis: true,
    diagnosisTier,
    diagFrameReplacement,
    diagPanelReplacement,
  };
}

// ===== Origin Price =====
export const ENCAR_OPTION_NAME_KEYS = ['optionName', 'name', 'optionNm', 'optionTitle'] as const;

export function optionNameOf(o: RawOptionItem): string | null {
  for (const k of ENCAR_OPTION_NAME_KEYS) {
    const s = str(o[k]);
    if (s) return s;
  }
  return null;
}

export function computeOriginPrice(vehicle: RawVehicle, optionList: RawOptionItem[] | null): {
  base: number | null;
  optionTotal: number;
  total: number | null;
  options: VehicleOption[];
  status: OptionsStatus;
} {
  const selectedCodes = new Set((Array.isArray(vehicle.options?.choice) ? vehicle.options.choice : []).map(c => String(c)));
  const selected = Array.isArray(optionList)
    ? optionList.filter(o => o != null && o.optionCd != null && selectedCodes.has(String(o.optionCd)))
    : [];

  const optionTotal = selected.reduce((s, o) => s + (finiteOrNull(o.price) ?? 0), 0);
  const base = finiteOrNull(vehicle.category?.originPrice);
  const sum = (base ?? 0) + optionTotal;
  const total = sum > 0 ? sum : null;

  const options = selected.map(o => ({
    optionCode: String(o.optionCd),
    optionPrice: finiteOrNull(o.price),
    optionName: optionNameOf(o),
    optionRaw: JSON.stringify(o),
  }));

  let status: OptionsStatus;
  if (selectedCodes.size === 0) {
    status = 'none';
  } else if (!Array.isArray(optionList)) {
    status = 'failed';
  } else if (new Set(selected.map(o => String(o.optionCd))).size < selectedCodes.size) {
    status = 'partial';
  } else {
    status = 'ok';
  }

  return { base, optionTotal, total, options, status };
}

// ===== Market Query =====
export interface MarketQuery {
  url: string;
  modelName: string | undefined;
  gradeName: string | undefined;
  gradeDetailName: string | undefined;
  hasValidDetail: boolean;
  targetPowertrain: string | null;
  currentMileage: number;
}

export function buildMarketQuery(v: RawVehicle): MarketQuery | null {
  const modelGroup = v.category?.modelGroupName;
  const modelName = v.category?.modelName;
  const formYear = v.category?.formYear;
  const gradeName = v.category?.gradeName;
  const gradeDetailName = v.category?.gradeDetailName;
  const currentMileage = v.spec?.mileage ?? 0;

  if (!modelGroup || !formYear) return null;

  const curYear = parseInt(String(formYear), 10) || 2020;
  const yearStart = `${curYear - 2}00`;
  const yearEnd = `${curYear + 2}99`;

  const validDetail = hasValidDetail(gradeDetailName);
  const targetPowertrain = getPowertrainCluster(gradeName, validDetail ? gradeDetailName : '');

  const canGrade = !targetPowertrain && !!gradeName && isSearchDslValueSafe(gradeName);
  const canDetail = !targetPowertrain && validDetail && isSearchDslValueSafe(gradeDetailName);
  const omitted = !targetPowertrain && ((!!gradeName && !canGrade) || (validDetail && !canDetail));

  let q = `(And.Hidden.N._.ModelGroup.${encodeURIComponent(modelGroup)}.`;
  if (modelName) q += `_.Model.${encodeURIComponent(modelName)}.`;
  if (canGrade && gradeName) q += `_.Badge.${encodeURIComponent(gradeName)}.`;
  if (canDetail && gradeDetailName) q += `_.BadgeDetail.${encodeURIComponent(gradeDetailName)}.`;
  q += `_.Year.range(${yearStart}..${yearEnd}).)`;

  const limit = (targetPowertrain || omitted) ? 500 : 100;
  const url = `${SEARCH_API}?q=${q}&sr=%7CModifiedDate%7C0%7C${limit}&count=true`;

  return {
    url,
    modelName,
    gradeName,
    gradeDetailName,
    hasValidDetail: validDetail,
    targetPowertrain,
    currentMileage,
  };
}

export function getCanonicalTrim(badge: unknown, detail: unknown): string {
  badge = badge || '';
  detail = detail || '';

  if (/세부등급\s*없음|없음|^-$|^기타$/i.test(String(detail).trim())) {
    detail = '';
  }

  const badgeClean = String(badge).replace(/\([^)]*\)|（[^）]*）/g, '').trim();
  const detailClean = String(detail).replace(/\([^)]*\)|（[^）]*）/g, '').trim();

  let target = detailClean || badgeClean;

  target = target.replace(/GT[\s\-_]*Line/gi, 'GT Line');

  const stripPatterns = [
    /^(더\s*뉴|디\s*올\s*뉴|올\s*뉴|더\s*넥스트|신형)\s*/i,
    /^(가솔린|디젤|LPI|LPG|HEV|EV|하이브리드|전기)\s*/i,
    /^\d+\.\d+[T-t]*\s*/i,
    /^(2WD|4WD|AWD|2륜|4륜|xDrive|4MATIC|콰트로|quattro)\s*/i,
    /^(5인승|7인승|9인승|11인승|인승)\s*/i,
    /^(롱레인지|스탠다드)\s*/i,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pat of stripPatterns) {
      const newT = target.replace(pat, '').trim();
      if (newT !== target && newT) {
        target = newT;
        changed = true;
      }
    }
  }

  target = target.replace(/\s*(2WD|4WD|AWD|2륜|4륜|xDrive|4MATIC|콰트로|quattro)\s*/gi, ' ').trim();
  target = target.replace(/\s+/g, ' ');

  return target || detailClean || badgeClean || '일반';
}

export function isTrimMatch(rBadge: unknown, rBadgeDetail: unknown, gName: string | undefined, gDetailName: string | undefined): boolean {
  const targetCluster = getPowertrainCluster(String(gName || ''), String(gDetailName || ''));
  if (targetCluster) {
    return getPowertrainCluster(String(rBadge || ''), String(rBadgeDetail || '')) === targetCluster;
  }

  const targetTrim = getCanonicalTrim(gName, gDetailName);
  const candidateTrim = getCanonicalTrim(rBadge, rBadgeDetail);
  if (!targetTrim || !candidateTrim) return true;
  return targetTrim.toLowerCase() === candidateTrim.toLowerCase();
}

export function isBaseValid(r: RawSearchItem, modelName?: string): boolean {
  return typeof r.Price === 'number' && r.Price > 0 && r.Price < 9999
    && (!modelName || String(r.Model || '').trim() === String(modelName).trim())
    && r.SellType !== '렌트' && r.SellType !== '리스' && !r.LeaseType && r.ServiceCopyCar !== 'DUPLICATION';
}

export function computeMarketPrice(results: RawSearchItem[], q: MarketQuery, collectedAt: string): MarketPrice | null {
  const allValid = results.filter(r =>
    isBaseValid(r, q.modelName) &&
    (!q.gradeName || !!q.targetPowertrain || String(r.Badge || '').trim() === String(q.gradeName).trim()) &&
    (!q.hasValidDetail || !!q.targetPowertrain || String(r.BadgeDetail || '').trim() === String(q.gradeDetailName).trim())
  );

  const trimFiltered = (q.gradeName || q.gradeDetailName)
    ? allValid.filter(r => isTrimMatch(r.Badge, r.BadgeDetail, q.gradeName, q.gradeDetailName))
    : allValid;

  function mileageFilter(arr: RawSearchItem[], factor: number): RawSearchItem[] {
    if (q.currentMileage <= 0) return arr;
    const lo = Math.max(0, q.currentMileage * (1 - factor));
    const hi = q.currentMileage * (1 + factor);
    return arr.filter(r => {
      if (typeof r.Mileage !== 'number') return true;
      return r.Mileage >= lo && r.Mileage <= hi;
    });
  }

  let c = mileageFilter(trimFiltered, 0.4);
  if (c.length < 5) c = mileageFilter(trimFiltered, 0.6);
  if (c.length < 5) c = trimFiltered;

  const prices = c.map(r => r.Price as number).filter(p => p > 0).sort((a, b) => a - b);
  if (prices.length < 3) return null;

  const n = prices.length;
  const median = n % 2 === 0
    ? (prices[n / 2 - 1] + prices[n / 2]) / 2
    : prices[Math.floor(n / 2)];

  const p25 = prices[Math.floor(n * 0.25)];
  const p75 = prices[Math.floor(n * 0.75)];

  return {
    median,
    minPrice: prices[0],
    maxPrice: prices[n - 1],
    p25,
    p75,
    sampleCount: n,
    collectedAt,
  };
}

// ===== Yearly Query =====
export interface YearlyQuery {
  url: string;
  modelName: string | undefined;
  gradeName: string | undefined;
  gradeDetailName: string | undefined;
  hasValidDetail: boolean;
  targetPowertrain: string | null;
}

export function buildYearlyQuery(v: RawVehicle): YearlyQuery | null {
  const modelGroup = v.category?.modelGroupName;
  const modelName = v.category?.modelName;
  const gradeName = v.category?.gradeName;
  const gradeDetailName = v.category?.gradeDetailName;

  if (!modelGroup) return null;

  const validDetail = hasValidDetail(gradeDetailName);
  const targetPowertrain = getPowertrainCluster(gradeName, validDetail ? gradeDetailName : '');

  const canGrade = !targetPowertrain && !!gradeName && isSearchDslValueSafe(gradeName);
  const canDetail = !targetPowertrain && validDetail && isSearchDslValueSafe(gradeDetailName);

  let q = `(And.Hidden.N._.ModelGroup.${encodeURIComponent(modelGroup)}.`;
  if (modelName) q += `_.Model.${encodeURIComponent(modelName)}.`;
  if (canGrade && gradeName) q += `_.Badge.${encodeURIComponent(gradeName)}.`;
  if (canDetail && gradeDetailName) q += `_.BadgeDetail.${encodeURIComponent(gradeDetailName)}.`;
  q += ')';

  const url = `${SEARCH_API}?q=${q}&sr=%7CModifiedDate%7C0%7C500&count=true`;

  return {
    url,
    modelName,
    gradeName,
    gradeDetailName,
    hasValidDetail: validDetail,
    targetPowertrain,
  };
}

export function computeYearlyPrices(results: RawSearchItem[], q: YearlyQuery, currentYear: number, collectedAt: string): YearlyPrice[] {
  const valid = results.filter(it =>
    isBaseValid(it, q.modelName) &&
    (!q.gradeName || (q.targetPowertrain
      ? getPowertrainCluster(String(it.Badge || ''), String(it.BadgeDetail || '')) === q.targetPowertrain
      : String(it.Badge || '').trim() === String(q.gradeName).trim())) &&
    (!q.hasValidDetail || !!q.targetPowertrain || String(it.BadgeDetail || '').trim() === String(q.gradeDetailName).trim())
  );

  const groups = new Map<number, { age: number; year: number; count: number; priceTotal: number }>();

  for (const it of valid) {
    const yearMatch = String(it.Year || '').match(/(?:19|20)\d{2}/);
    const formYearMatch = String(it.FormYear || '').match(/(?:19|20)\d{2}/);
    const year = parseInt(yearMatch?.[0] || formYearMatch?.[0] || '0', 10);

    if (year < 1980 || year > currentYear) continue;

    const age = currentYear - year;
    const group = groups.get(age) || { age, year, count: 0, priceTotal: 0 };
    group.count++;
    group.priceTotal += (it.Price as number);
    groups.set(age, group);
  }

  return [...groups.values()]
    .sort((a, b) => a.age - b.age)
    .map(group => ({
      age: group.age,
      year: group.year,
      count: group.count,
      avgPrice: Math.round(group.priceTotal / group.count),
      collectedAt,
    }));
}
