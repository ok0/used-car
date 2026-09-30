import { fetchText, InvalidUrlError } from './fetch-helper';
import type { CompareInput, InspectionInfo, InputOptionItem, InputOptionPackage } from '../types';

export interface HyundaiCertifiedParseResult { input: CompareInput; warnings: string[]; notes: string[]; }

const HC_URL_RE = /^https?:\/\/certified\.hyundai\.com\/[pm]\/goods\/goodsDetail\.do\?(?:[^#]*&)?goodsNo=([A-Za-z0-9]+)(?:[&#].*)?$/;

export function parseHyundaiCertifiedGoodsNo(url: string): string | null {
  const m = url.trim().match(HC_URL_RE);
  return m ? m[1] : null;
}

export function canonicalHyundaiCertifiedUrl(goodsNo: string): string {
  return `https://certified.hyundai.com/p/goods/goodsDetail.do?goodsNo=${goodsNo}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCharCode(Number('0x' + hex)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function numOrNull(s: string | null): number | null {
  if (s === null) return null;
  const cleaned = s.replace(/[^\d.]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function hiddenValue(html: string, id: string): string | null {
  const re = new RegExp(`\\bid=["']${escapeRe(id)}["']`, 'i');
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    if (re.test(m[0])) {
      const vm = m[0].match(/\bvalue=["']([^"']*)["']/);
      if (vm) {
        const val = decodeEntities(vm[1]).trim();
        return val === '' ? null : val;
      }
      return null;
    }
  }
  return null;
}

export function labeledText(html: string, label: string): string | null {
  const pattern = new RegExp(
    `<span class="tit">\\s*${escapeRe(label)}\\s*</span>\\s*<span class="txt">([^<]*)</span>`,
    'i'
  );
  const m = html.match(pattern);
  if (!m) return null;
  const val = decodeEntities(m[1]).trim();
  return val === '' ? null : val;
}

export function insuranceCount(html: string, label: string): number | null {
  const pattern = new RegExp(
    `<th scope="row">\\s*${escapeRe(label)}\\s*</th>\\s*<td>([\\s\\S]*?)</td>`,
    'i'
  );
  const m = html.match(pattern);
  if (!m) return null;
  const content = stripTags(m[1]);
  const cm = content.match(/(\d+)\s*건/);
  return cm ? Number(cm[1]) : null;
}

export function usageHistory(html: string, label: string): string | null {
  const pattern = new RegExp(
    `<span class="tit[^"]*">\\s*${escapeRe(label)}[^<]*</span>\\s*<span class="txt">([^<]*)</span>`,
    'i'
  );
  const m = html.match(pattern);
  if (!m) return null;
  const val = decodeEntities(m[1]).trim();
  return val === '' ? null : val;
}

export function uspItems(html: string): { label: string; value: string }[] {
  const s = html.indexOf('class="usp_item"');
  if (s < 0) return [];
  const e = html.indexOf('</ul>', s);
  const block = html.slice(s, e < 0 ? s + 5000 : e);
  const result: { label: string; value: string }[] = [];
  for (const m of block.matchAll(/<span>([^<]+)<\/span>\s*<strong class="state"[^>]*>([^<]*)<\/strong>/g)) {
    const label = decodeEntities(m[1]).trim();
    const value = decodeEntities(m[2]).trim();
    result.push({ label, value });
  }
  return result;
}

export function parseHcOptionItems(html: string): InputOptionItem[] | null {
  const s = html.indexOf('<ol class="option_01">');
  if (s < 0) return null;
  const e = html.indexOf('</ol>', s);
  const block = e < 0 ? html.slice(s) : html.slice(s, e);
  const names = new Set<string>();
  for (const m of block.matchAll(/<span>([^<]+)<\/span>/g)) {
    const name = decodeEntities(m[1]).trim();
    if (name !== '') names.add(name);
  }
  return Array.from(names).map((name) => ({ name, choice: 'loaded', availability: 'unknown' }));
}

export function parseHcOptionPackages(html: string): InputOptionPackage[] | null {
  const s = html.indexOf('class="cont_box sel_option"');
  if (s < 0) return null;
  const e = html.indexOf('</ul>', s);
  if (e < 0) return null;
  const block = html.slice(s, e);
  const result: InputOptionPackage[] = [];
  for (const m of block.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const li = m[1];
    const nameMatch = li.match(/<span class="name">([\s\S]*?)<\/span>/);
    const priceMatch = li.match(/<strong class="price">([\s\S]*?)<\/strong>/);
    if (!nameMatch) continue;
    const name = stripTags(nameMatch[1]);
    if (!name) continue;
    let price: number | null = null;
    if (priceMatch) {
      const priceText = stripTags(priceMatch[1]);
      const priceParsed = priceText.match(/([\d,]+)\s*만원/);
      if (priceParsed) {
        price = Number(priceParsed[1].replace(/,/g, ''));
      }
    }
    result.push({ name, price, items: [] });
  }
  return result;
}

export function inspectionFromHc(label: string | null): InspectionInfo | null {
  if (label === null) return null;
  if (/완전\s*무사고/.test(label)) {
    return { label, isClean: true, hasReplacement: false, hasWelding: false, hasCorrosion: false };
  }
  const rep = /교환/.test(label);
  const weld = /판금|용접/.test(label);
  const corr = /부식/.test(label);
  if (rep || weld || corr) {
    return { label, isClean: false, hasReplacement: rep, hasWelding: weld, hasCorrosion: corr };
  }
  return { label, isClean: null, hasReplacement: null, hasWelding: null, hasCorrosion: null };
}

export function saleStatusWarning(sdStatCd: string | null, dispYn: string | null, contrNo: string | null, vhclSctCd: string | null): string | null {
  if (vhclSctCd === '20') return '인증중고차 대상이 아닌 차량(NON-CPO)으로 표시됩니다 — 구매 불가 상태일 수 있음';
  if (sdStatCd === null) return '판매 상태 코드(sdStatCd)를 찾지 못했습니다 — 판매 여부 확인 필요';
  if (sdStatCd === '20' && dispYn !== 'N') return null;
  if (sdStatCd === '50') {
    return contrNo ? '판매 완료된 차량입니다 (sdStatCd=50)' : '판매 상태 코드 50 (계약번호 없음) — 판매 여부 확인 필요';
  }
  if (sdStatCd === '80') return '계약 진행중인 차량입니다 (sdStatCd=80)';
  if (['10', '30', '70'].includes(sdStatCd) || dispYn === 'N') {
    return `일시품절 상태입니다 (sdStatCd=${sdStatCd}${dispYn === 'N' ? ', dispYn=N' : ''})`;
  }
  return `알 수 없는 판매 상태 코드: ${sdStatCd}`;
}

export function parseHyundaiCertifiedHtml(html: string, url: string): HyundaiCertifiedParseResult {
  const warnings: string[] = [];
  const notes: string[] = [];
  const goodsNo = parseHyundaiCertifiedGoodsNo(url);
  const invNo = hiddenValue(html, 'e2eVhclInvNo');

  let nameFull = hiddenValue(html, 'name');
  if (!nameFull) {
    const m = html.match(/<div class="name">([^<]*)<\/div>/);
    if (m) {
      nameFull = decodeEntities(m[1]).trim() || null;
    }
  }

  if (!invNo && !nameFull) {
    throw new Error('현대 인증중고차 페이지에서 차량 정보를 찾지 못했습니다 (판매 종료·삭제 또는 페이지 구조 변경 가능)');
  }

  if (goodsNo && invNo && goodsNo !== invNo) {
    warnings.push(`요청한 매물번호(${goodsNo})와 페이지 매물번호(${invNo})가 다릅니다`);
  }

  const sw = saleStatusWarning(hiddenValue(html, 'sdStatCd'), hiddenValue(html, 'dispYn'), hiddenValue(html, 'contrNo'), hiddenValue(html, 'vhclSctCd'));
  if (sw) warnings.push(`판매 상태: ${sw}`);

  let rest = nameFull?.replace(/^\d{4}\s+/, '').trim() ?? null;
  let model = hiddenValue(html, 'vehicle_model') ?? (rest ? rest.split(/\s+/)[0] : null);
  if (!model) throw new Error('현대 인증중고차 페이지에서 모델명을 찾지 못했습니다');

  let trim = rest && rest.startsWith(model) ? (rest.slice(model.length).trim() || null) : null;
  if (!trim) {
    const g = [hiddenValue(html, 'vehicle_grade'), hiddenValue(html, 'vehicle_engine'), hiddenValue(html, 'vehicle_trim')]
      .filter((x): x is string => !!x)
      .join(' ');
    trim = g || null;
    if (!trim) warnings.push('차량명에서 트림을 분리하지 못해 vehicle_grade/engine/trim 값으로 대체했습니다');
  }

  let year: number;
  let month: number;
  const drive = html.match(/<div class="drive">\s*<span>([^<]*)<\/span>/)?.[1] ?? null;
  const reg = labeledText(html, '최초등록')?.match(/^(\d{4})[.\-\/](\d{1,2})/);

  if (reg) {
    year = Number(reg[1]) % 100;
    month = Number(reg[2]);
  } else {
    const dm = drive?.match(/(\d{2})년\s*(\d{1,2})월/);
    if (dm) {
      year = Number(dm[1]);
      month = Number(dm[2]);
    } else {
      throw new Error('현대 인증중고차 페이지에서 최초등록일을 찾지 못했습니다');
    }
  }

  let modelYear: number | null = null;
  const myMatch = drive?.match(/\((\d{2})년형\)/);
  if (myMatch) {
    modelYear = 2000 + Number(myMatch[1]);
  } else {
    const vy = numOrNull(hiddenValue(html, 'vehicle_year'));
    if (vy !== null && vy >= 1990 && vy <= 2099) modelYear = vy;
  }

  const mileage = numOrNull(hiddenValue(html, 'totOdo')) ?? numOrNull(labeledText(html, '주행거리'));
  if (mileage === null) throw new Error('현대 인증중고차 페이지에서 주행거리를 찾지 못했습니다');

  const won = numOrNull(hiddenValue(html, 'dscntPrc'));
  const shown = numOrNull(hiddenValue(html, 'price'));
  let price: number | null = null;
  if (won !== null && won > 0) {
    price = Math.round(won / 10000);
    if (shown !== null && Math.abs(Math.round(won / 10000) - shown) > 1) {
      warnings.push(`판매가 표기가 다릅니다 (차량가격 ${Math.round(won / 10000)}만원 / 표시가 ${shown}만원) — 차량가격 사용`);
    }
  } else {
    price = shown;
  }
  if (price === null || price <= 0) throw new Error('현대 인증중고차 페이지에서 가격을 찾지 못했습니다');

  const normWon = numOrNull(hiddenValue(html, 'normPrc'));
  const originPrice = normWon && normWon > 0 ? Math.round(normWon / 10000) : null;

  const corp = hiddenValue(html, 'saleCorpCd');
  const manufacturer = corp === null ? null : corp === '5' ? '현대' : '제네시스';

  let mine = insuranceCount(html, '내차피해');
  if (mine === null) {
    const usp = uspItems(html);
    const uspVal = usp.find((u) => u.label === '내차피해이력')?.value;
    if (uspVal) {
      const um = uspVal.match(/(\d+)\s*건/);
      if (um) mine = Number(um[1]);
    }
  }
  if (mine === null && labeledText(html, '내차피해') === '없음') mine = 0;

  const loss = insuranceCount(html, '전손보험사고');
  const flood = insuranceCount(html, '침수보험사고');
  let accidentAmount: number | null = mine === 0 ? 0 : null;
  if (mine !== null && mine > 0) {
    warnings.push(`내차피해 ${mine}건의 보험 처리 금액은 자동 추출하지 않습니다 — --accident-amount <원> 으로 입력하면 사고 규모 판정에 반영됩니다`);
  }
  if (mine === null) {
    warnings.push('보험이력(내차피해)을 찾지 못했습니다 — 사고는 정보 미제공으로 처리');
  }

  let hasSevereAccident: boolean | null = null;
  if ((loss ?? 0) > 0 || (flood ?? 0) > 0) {
    hasSevereAccident = true;
    warnings.push(`특수사고 이력: 전손 ${loss ?? 0}건, 침수 ${flood ?? 0}건`);
  } else if (mine === 0) {
    hasSevereAccident = false;
  }

  let owner = insuranceCount(html, '소유자변경');
  if (owner === null) warnings.push('소유자 변경 횟수를 찾지 못했습니다');
  if (owner !== null && owner > 0) {
    notes.push('소유자 변경 횟수에는 현대자동차 매입(상품용) 이전이 포함될 수 있습니다');
  }

  const flags = [usageHistory(html, '대여용도 사용이력'), usageHistory(html, '영업용도 사용이력')]
    .filter((x): x is string => x !== null);
  let hasRentalHistory: boolean | null = null;
  if (flags.length === 0) {
    warnings.push('렌트/영업용 이력을 찾지 못했습니다');
  } else {
    hasRentalHistory = flags.some((x) => x.includes('있음'));
  }

  const usp = uspItems(html);
  const inspection = inspectionFromHc(usp.find((u) => u.label === '사고진단')?.value || null);
  if (inspection === null) warnings.push('사고진단 결과를 찾지 못했습니다 — 성능점검은 정보 미제공으로 처리');

  for (const u of usp) {
    if (u.value !== '' && u.label !== '내차피해이력' && u.label !== '사고진단') {
      notes.push(`${u.label}: ${u.value}`);
    }
  }

  if (html.includes('워런티 플러스')) {
    notes.push('워런티 플러스(보증 연장 상품) 별도 구매 가능 — 잔여 보증기간은 페이지가 별도로 조회해 자동 추출하지 않습니다');
  }

  const optionItems = parseHcOptionItems(html);
  if (optionItems === null) warnings.push('옵션 목록을 찾지 못했습니다 — 옵션은 정보 미제공으로 처리');

  const optionPackages = parseHcOptionPackages(html);
  if (optionPackages === null) warnings.push('선택 옵션 영역을 찾지 못했습니다 — 선택옵션은 정보 미제공으로 처리');

  const input: CompareInput = {
    platform: 'hyundai_certified',
    sourceUrl: url,
    manufacturer,
    model,
    trim,
    year,
    month,
    modelYear,
    mileage: Math.round(mileage),
    price,
    originPrice,
    fuelType: labeledText(html, '연료') ?? hiddenValue(html, 'fuel_type'),
    transmission: labeledText(html, '변속기') ?? hiddenValue(html, 'vehicle_transmission'),
    color: labeledText(html, '외관컬러') ?? hiddenValue(html, 'exterior_color'),
    displacement: numOrNull(hiddenValue(html, 'engCd')) ?? numOrNull(labeledText(html, '배기량')),
    accidentCount: mine,
    accidentAmount,
    hasSevereAccident,
    ownerChangeCount: owner,
    hasRentalHistory,
    inspection,
    optionItems,
    optionPackages,
  };

  return { input, warnings, notes };
}

export async function fetchHyundaiCertifiedInput(url: string, fetchHtml: (url: string) => Promise<string> = fetchText): Promise<HyundaiCertifiedParseResult> {
  const goodsNo = parseHyundaiCertifiedGoodsNo(url);
  if (!goodsNo) {
    throw new InvalidUrlError(`현대 인증중고차 상세 URL 형식이 아닙니다 (https://certified.hyundai.com/p/goods/goodsDetail.do?goodsNo={매물번호}): ${url}`);
  }
  const html = await fetchHtml(canonicalHyundaiCertifiedUrl(goodsNo));
  return parseHyundaiCertifiedHtml(html, url);
}
