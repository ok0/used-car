import { fetchText, InvalidUrlError } from './fetch-helper';
import type { CompareInput, InspectionInfo, InputOptionItem, InputOptionPackage, OptionChoice, OptionAvailability } from '../types';

type Obj = Record<string, unknown>;

export interface HeydealerParseResult { input: CompareInput; warnings: string[]; }

const HEYDEALER_URL_RE = /^https?:\/\/(?:www\.)?heydealer\.com\/market\/cars\/([A-Za-z0-9]+)\/?(?:[?#].*)?$/;

export function parseHeydealerId(url: string): string | null {
  const m = url.trim().match(HEYDEALER_URL_RE);
  return m ? m[1] : null;
}

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function obj(v: unknown): Obj | null { return isObj(v) ? v : null; }
function text(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function boolOrNull(v: unknown): boolean | null { return typeof v === 'boolean' ? v : null; }

export function extractJsonLdObjects(html: string): Obj[] {
  const out: Obj[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let parsed: unknown;
    try { parsed = JSON.parse(m[1]); } catch { continue; }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const it of items) {
      if (!isObj(it)) continue;
      out.push(it);
      if (Array.isArray(it['@graph'])) for (const g of it['@graph']) if (isObj(g)) out.push(g);
    }
  }
  return out;
}

export function findVehicleJsonLd(objs: Obj[]): Obj | null {
  for (const o of objs) {
    const t = o['@type'];
    const types = Array.isArray(t) ? t.map(String) : [String(t)];
    if (types.includes('Vehicle') || types.includes('Car')) return o;
  }
  return null;
}

/** Next.js App Router RSC 스트림(self.__next_f.push([1,"..."]))을 이어붙인 문자열 */
export function extractFlightData(html: string): string {
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let out = '';
  for (const m of html.matchAll(re)) {
    try { out += JSON.parse(m[1]) as string; } catch { /* skip */ }
  }
  return out;
}

/** start 위치의 '{'부터 문자열 리터럴을 고려해 균형 잡힌 JSON 객체 텍스트를 잘라냄 */
export function sliceBalancedJson(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** 플라이트 데이터에서 hash_id가 일치하고 detail_info를 가진 차량 객체를 찾음 */
export function findCarObject(flight: string, hashId: string): Obj | null {
  const needle = `{"hash_id":"${hashId}"`;
  let from = 0;
  for (;;) {
    const idx = flight.indexOf(needle, from);
    if (idx < 0) return null;
    from = idx + needle.length;
    const raw = sliceBalancedJson(flight, idx);
    if (!raw) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { continue; }
    if (isObj(parsed) && isObj(parsed['detail_info'])) return parsed;
  }
}

function titleOf(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? text(m[1]) : null;
}

/** "2019년 더 뉴 스파크 프리미어 중고차 - 헤이딜러" 또는 "더 뉴 스파크 프리미어" 에서 model 뒤 나머지를 트림으로 */
/** 헤이딜러 grade_part_name이 이미 detail_name을 포함하는 경우가 있어("가솔린 2.5T 2WD 캘리그래피" + "캘리그래피") 중복 없이 합친다 */
export function joinTrim(gradePart: string, detailName: string | null): string {
  if (!detailName) return gradePart;
  const compact = (x: string): string => x.replace(/\s+/g, '');
  return compact(gradePart).includes(compact(detailName)) ? gradePart : `${gradePart} ${detailName}`;
}

export function trimFromName(name: string | null, model: string): string | null {
  if (!name) return null;
  const cleaned = name.replace(/^\d{4}년\s*/, '').replace(/\s*중고차[\s\S]*$/, '').trim();
  if (!cleaned.startsWith(model)) return null;
  return text(cleaned.slice(model.length));
}

export function inspectionFromHeydealer(summary: string | null, display: string | null, repairs: unknown): InspectionInfo | null {
  if (summary === null && display === null) return null;
  const label = display ?? summary ?? '';
  if (summary === 'complete_no_accident' || display === '완전무사고') {
    return { label, isClean: true, hasReplacement: false, hasWelding: false, hasCorrosion: false };
  }
  if (Array.isArray(repairs) && repairs.length > 0) {
    const t = JSON.stringify(repairs);
    return {
      label,
      isClean: false,
      hasReplacement: /교환|exchange|replace/i.test(t),
      hasWelding: /판금|용접|weld|sheet/i.test(t),
      hasCorrosion: /부식|corrosion|rust/i.test(t),
    };
  }
  return { label, isClean: null, hasReplacement: null, hasWelding: null, hasCorrosion: null };
}

const OPTION_CHOICES: ReadonlySet<string> = new Set(['loaded', 'loaded_aftermarket', 'absent']);
const OPTION_AVAIL: ReadonlySet<string> = new Set(['default', 'available', 'unavailable']);

export function parseHeydealerOptionItems(raw: unknown): InputOptionItem[] | null {
  if (!Array.isArray(raw)) return null;
  const out: InputOptionItem[] = [];
  for (const o of raw) {
    if (!isObj(o)) continue;
    const name = text(o['name']);
    if (!name) continue;
    const c = text(o['choice']);
    const a = text(o['availability']);
    out.push({
      name,
      choice: c !== null && OPTION_CHOICES.has(c) ? (c as OptionChoice) : 'unknown',
      availability: a !== null && OPTION_AVAIL.has(a) ? (a as OptionAvailability) : 'unknown',
    });
  }
  return out;
}

const PKG_PRICE_RE = /\(\s*([\d,]+)\s*만\s*원\s*\)/;

export function parseHeydealerOptionPackages(carSpec: unknown): InputOptionPackage[] | null {
  const cs = obj(carSpec);
  if (!cs || !Array.isArray(cs['option_packages'])) return null;
  const out: InputOptionPackage[] = [];
  for (const p of cs['option_packages'] as unknown[]) {
    if (!isObj(p)) continue;
    const raw = text(p['name']);
    if (!raw || raw.startsWith('*')) continue;
    const m = raw.match(PKG_PRICE_RE);
    const name = raw.replace(PKG_PRICE_RE, '').replace(/^\s*\d+\)\s*/, '').trim();
    if (!name) continue;
    const items = Array.isArray(p['detail_items']) ? (p['detail_items'] as unknown[]).map(text).filter((x): x is string => !!x) : [];
    out.push({ name, price: m ? Number(m[1].replace(/,/g, '')) : null, items });
  }
  return out;
}

export function parseHeydealerHtml(html: string, url: string): HeydealerParseResult {
  const warnings: string[] = [];
  const hashId = parseHeydealerId(url);
  const ld = findVehicleJsonLd(extractJsonLdObjects(html));
  if (!ld) warnings.push('JSON-LD 차량 정보를 찾지 못했습니다');
  const car = hashId ? findCarObject(extractFlightData(html), hashId) : null;
  const di = car ? obj(car['detail_info']) : null;
  if (!di) warnings.push('임베디드 상세 데이터(detail_info)를 찾지 못했습니다 — 사고/소유주/렌트/성능점검은 정보 미제공으로 처리');
  if (!ld && !di) throw new Error('헤이딜러 페이지에서 차량 정보를 찾지 못했습니다 (페이지 구조 변경 또는 판매 종료 가능)');

  const saleStatus = car ? text(car['sale_status']) : null;
  if (saleStatus && saleStatus !== 'listed') warnings.push(`판매 상태: ${saleStatus} (판매중이 아닐 수 있음)`);

  const model = text(di?.['model_part_name']) ?? text(ld?.['model']);
  if (!model) throw new Error('헤이딜러 페이지에서 모델명을 찾지 못했습니다');

  const gradePart = text(di?.['grade_part_name']) ?? text(di?.['grade_name']);
  const detailName = text(di?.['detail_name']);
  const trim = gradePart
    ? joinTrim(gradePart, detailName)
    : (trimFromName(text(ld?.['name']), model) ?? trimFromName(titleOf(html), model));

  const reg = text(di?.['initial_registration_date'])?.match(/^(\d{4})-(\d{2})/) ?? null;
  const modelYear = numOrNull(di?.['year']) ?? numOrNull(ld?.['vehicleModelDate']);
  let year: number;
  let month: number | null;
  if (reg) {
    year = Number(reg[1]) % 100;
    month = Number(reg[2]);
  } else if (modelYear !== null) {
    year = modelYear % 100;
    month = null;
    warnings.push('최초등록일이 없어 연형(vehicleModelDate)으로 연식을 대체했습니다');
  } else {
    throw new Error('헤이딜러 페이지에서 연식을 찾지 못했습니다');
  }

  const mileage = numOrNull(di?.['mileage']) ?? numOrNull(obj(ld?.['mileageFromOdometer'])?.['value']);
  if (mileage === null) throw new Error('헤이딜러 페이지에서 주행거리를 찾지 못했습니다');

  const offerWon = numOrNull(obj(ld?.['offers'])?.['price']);
  const price = offerWon !== null ? Math.round(offerWon / 10000) : numOrNull(car?.['price']);
  if (price === null || price <= 0) throw new Error('헤이딜러 페이지에서 가격을 찾지 못했습니다');

  const ch = obj(di?.['carhistory']);
  if (di && !ch) warnings.push('보험이력(carhistory)이 없습니다 — 사고/소유주/렌트는 정보 미제공으로 처리');
  const accidentList = Array.isArray(ch?.['my_car_accident_list']) ? (ch?.['my_car_accident_list'] as unknown[]) : null;
  const rent = boolOrNull(ch?.['has_rent_use_record']);
  const business = boolOrNull(ch?.['has_business_use_record']);
  const totalInfo = obj(car?.['total_info']);

  const insp = obj(di?.['inspection_records']);
  const inspection = inspectionFromHeydealer(
    text(di?.['accident_repairs_summary']) ?? text(insp?.['accident_repairs_summary']),
    text(di?.['accident_repairs_summary_display']) ?? text(insp?.['accident_repairs_summary_display']),
    di?.['accident_repairs'] ?? insp?.['accident_repairs'],
  );

  const optionItems = parseHeydealerOptionItems(di?.['options']);
  const optionPackages = parseHeydealerOptionPackages(di?.['car_spec']);
  if (di && optionItems === null) warnings.push('옵션 목록(detail_info.options)이 없습니다 — 옵션은 정보 미제공으로 처리');

  const input: CompareInput = {
    platform: 'heydealer',
    sourceUrl: url,
    manufacturer: text(obj(ld?.['brand'])?.['name']) ?? text(di?.['brand_name']),
    model,
    trim: trim || null,
    year,
    month,
    modelYear,
    mileage: Math.round(mileage),
    price,
    originPrice: numOrNull(di?.['factory_price']), // 옵션 포함 출고가로 추정
    fuelType: text(di?.['fuel_display']) ?? text(ld?.['fuelType']),
    transmission: text(di?.['transmission_display']) ?? text(ld?.['vehicleTransmission']),
    color: text(ld?.['color']) ?? text(obj(di?.['color_and_trim'])?.['exterior_description']),
    displacement: numOrNull(di?.['displacement'])
      ?? numOrNull(obj(obj(ld?.['vehicleEngine'])?.['engineDisplacement'])?.['value']),
    accidentCount: numOrNull(ch?.['my_car_accident_count']),
    accidentAmount: numOrNull(ch?.['my_car_accident_cost']),
    hasSevereAccident: accidentList ? accidentList.some((a) => isObj(a) && a['is_severe_accident'] === true) : null,
    ownerChangeCount: numOrNull(ch?.['owner_changed_count']) ?? numOrNull(totalInfo?.['owner_changed_count']),
    hasRentalHistory: rent === null && business === null ? null : rent === true || business === true,
    inspection,
    optionItems,
    optionPackages,
  };
  return { input, warnings };
}

export async function fetchHeydealerInput(url: string, fetchHtml: (url: string) => Promise<string> = fetchText): Promise<HeydealerParseResult> {
  if (!parseHeydealerId(url)) {
    throw new InvalidUrlError(`헤이딜러 상세 URL 형식이 아닙니다 (https://www.heydealer.com/market/cars/{id}): ${url}`);
  }
  const html = await fetchHtml(url);
  return parseHeydealerHtml(html, url);
}
