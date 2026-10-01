import { fmtNum, fmtManwon, fmtWon, fmtKm, fmtYY, fmtYearMonth } from '../cli/format';
import type { AccidentSeverity, CompareInput, CompareResult, CompareVerdict, InspectionInfo, InputOptionItem, ModelMatchLevel } from '../types';
import { SPEC_DEADBAND, specMaxAdjust } from './analyzer';

const LINE = '━'.repeat(44);
const PLATFORM_LABEL: Record<CompareInput['platform'], string> = { heydealer: '헤이딜러', kcar: '케이카', hyundai_certified: '현대 인증중고차' };
const VERDICT_LABEL: Record<CompareVerdict, string> = {
  cheap: '🟢 종합 판정: 저렴함',
  fair: '🟡 종합 판정: 적정가',
  slightly_expensive: '🟠 종합 판정: 다소 비쌈',
  expensive: '🔴 종합 판정: 비쌈',
};
const LEVEL_LABEL: Record<ModelMatchLevel, string> = {
  exact: '모델명 일치',
  base: '모델명 일치 (세대 코드 무시)',
  tokens: '키워드 일치',
  loose: '느슨한 키워드 일치 (세대 구분어 무시)',
};
const SEVERITY_LABEL: Record<AccidentSeverity, string> = {
  none: '무사고', minor: '경미', moderate: '중간', severe: '심각', unknown: '금액 미상',
};

export function fmtPct(r: number | null): string { return r === null ? '-' : `${Math.round(r * 100)}%`; }
function fmtMatchedNames(pkgName: string, names: readonly string[]): string {
  if (names.length === 0 || (names.length === 1 && names[0] === pkgName)) return '';
  const shown = names.slice(0, 3).join(', ');
  return ` — 엔카 표기: ${shown}${names.length > 3 ? ` 외 ${names.length - 3}개` : ''}`;
}
export function signed(n: number, digits = 1): string { return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`; }
export function signedInt(n: number): string { return `${n > 0 ? '+' : n < 0 ? '-' : ''}${fmtNum(Math.abs(n))}`; }
function yn(b: boolean | null): string { return b === null ? '?' : b ? '있음' : '없음'; }

export function inputTitle(i: CompareInput): string {
  const head = i.manufacturer && !i.model.startsWith(i.manufacturer) ? `${i.manufacturer} ${i.model}` : i.model;
  return i.trim ? `${head} ${i.trim}` : head;
}

export function percentileLabel(p: number): string {
  return p >= 60 ? '비싼 편' : p <= 40 ? '저렴한 편' : '중간 수준';
}

export function buildVerdictLines(r: CompareResult): string[] {
  const j = r.judgement;
  const raw = j.diffPercent;
  const d = j.adjustedDiffPercent;
  const lines: string[] = [];
  if (Math.abs(raw) < 0.05) lines.push('가격이 동급 평균과 같습니다.');
  else if (raw > 0) lines.push(`가격이 동급 평균 대비 +${raw.toFixed(1)}% 높습니다.`);
  else lines.push(`가격이 동급 평균 대비 ${raw.toFixed(1)}% 낮습니다.`);
  if (j.specAdjustment !== 0 && r.option.specDiffPercent !== null) {
    lines.push(`옵션·사양 보정: 옵션 포함 신차가가 동급 평균 대비 ${signed(r.option.specDiffPercent)}% → 기대 시세 ${signed(j.specAdjustment)}% 반영, 보정 후 가격 차이 ${signed(d)}%`);
  }
  if (j.factors.length > 0) {
    lines.push(`품질 보정: ${j.factors.map((f) => `${f.reason} ${f.points > 0 ? '+' : ''}${f.points}%p`).join(', ')}`);
  }
  lines.push(`상품화 플랫폼 프리미엄 허용치: ${j.allowedPremium}% (기본 ${j.basePremium}% ${j.qualityAdjustment >= 0 ? '+' : ''}${j.qualityAdjustment}%p, 범위 0~10%)`);
  if (j.verdict === 'cheap') {
    lines.push(`기대 가격(엔카 시세 + 허용 프리미엄 ${j.allowedPremium}%)보다 ${Math.abs(j.excessOverAllowance).toFixed(1)}% 낮으며 치명적 감점 요인이 없습니다.`);
  } else if (j.verdict === 'fair' && j.criticalReasons.length > 0 && j.excessOverAllowance <= -5) {
    lines.push(`가격은 낮지만 ${j.criticalReasons.join(', ')} 요인이 있어 저렴하다고 보기 어렵습니다.`);
  } else if (j.verdict === 'fair' && j.excessOverAllowance > 0) {
    lines.push(`상품화 플랫폼 프리미엄 허용치(${j.allowedPremium}%)를 ${j.excessOverAllowance.toFixed(1)}%p 넘지만 적정 범위(허용치 ±5%) 안입니다.`);
  } else if (j.verdict === 'fair') {
    lines.push('동급 시세 수준입니다.');
  } else {
    lines.push(`허용 범위(허용치 ±5%)를 ${(j.excessOverAllowance - 5).toFixed(1)}%p 초과합니다.`);
  }
  const g = r.diagnostics;
  if (g.peerLogSdPercent !== null && g.meanStdErrPercent !== null) {
    lines.push(`참고(측정 편차): 동급 ${r.sampleCount}대 가격 표준편차 ±${g.peerLogSdPercent.toFixed(1)}%, 동급 평균의 표준오차 ±${g.meanStdErrPercent.toFixed(1)}%`);
  }
  if (j.compositionAdjustment !== 0) {
    lines.push(`연식·주행·렌트 구성 보정 ${signed(-j.compositionAdjustment)}% → 보정 후 가격 차이 ${signed(d)}%`);
  }
  lines.push(`참고(구성 차이): 동급 대비 차령 ${signed(g.ageGapMonths, 0)}개월 · 주행 ${signedInt(Math.round(g.mileageGapKm))}km · 동급 렌트 비율 ${fmtPct(g.peerRentalRatio)} → 이 차이만으로 예상되는 가격 차이 ${signed(g.compositionPercent)}% (판정에 반영)`);
  return lines;
}

export function buildRecommendations(r: CompareResult): string[] {
  const recs: string[] = [];
  const i = r.input;
  if (Math.abs(r.diagnostics.compositionPercent) >= 3) recs.push(`동급과 연식·주행거리·렌트 구성 차이로 약 ${signed(r.diagnostics.compositionPercent)}%의 가격 차이가 예상됩니다 — 동급 평균 대비 %를 해석할 때 고려 권장`);
  if (r.option.specDiffPercent === null) recs.push('옵션 포함 신차가 비교 불가 — 옵션·트림 구성을 직접 비교 권장');
  if (r.isLowSample) recs.push(`동급 표본이 ${r.sampleCount}대로 적습니다 — 같은 모델의 엔카 검색 URL로 collect를 더 실행한 뒤 재비교 권장`);
  if (r.criteria.modelMatchLevel === 'loose' || (r.criteria.trim !== null && !r.criteria.trimApplied)) {
    recs.push(`모델/트림 매칭이 느슨합니다 — list --model 로 동급매물을 직접 확인 권장`);
  }
  if (i.inspection === null) recs.push('성능점검 결과 확인 후 최종 판단 권장');
  if (r.accident.severity === null) recs.push('보험이력(사고 건수·보험금) 확인 권장');
  else if (r.accident.severity === 'unknown') recs.push('사고 보험금 규모 확인 권장');
  if (i.ownerChangeCount === null) recs.push('소유주 변경 이력 확인 권장');
  if (i.hasRentalHistory === null) recs.push('렌트/영업용 이력 확인 권장');
  else if (i.hasRentalHistory) recs.push('렌트 이력 차량 — 동급보다 충분히 저렴한지 확인 권장');
  if (r.mileage.judgement === 'low') recs.push('연평균 5,000km 미만 과소주행 — 장기 방치·계기판 교체 여부 확인 권장');
  if (r.mileage.judgement === 'high') recs.push('연평균 25,000km 이상 과다주행 — 소모품 교환 이력 확인 권장');
  if (r.judgement.verdict === 'slightly_expensive' || r.judgement.verdict === 'expensive') {
    recs.push(`가격 협상 여지 확인 (동급 중앙값 ${fmtManwon(r.market.median)} 참고)`);
  }
  if (recs.length === 0) recs.push('특이사항 없음 — 실차 확인 후 구매 판단');
  return recs;
}

function inspectionInputText(x: InspectionInfo | null): string {
  if (x === null) return '정보 미제공';
  return `${x.label} (교환 ${yn(x.hasReplacement)} / 판금 ${yn(x.hasWelding)} / 부식 ${yn(x.hasCorrosion)})`;
}

export function printCompareReport(r: CompareResult, log: (line: string) => void = console.log): void {
  const i = r.input;
  const c = r.criteria;
  const m = r.market;
  const p = r.price;
  const title = inputTitle(i);

  log(LINE);
  log(`📊 가격 적정성 분석 — ${title} (${PLATFORM_LABEL[i.platform]})`);
  log(LINE);
  log('');
  log('📌 입력 매물');
  log(`  모델: ${title} | ${fmtYearMonth(i.year, i.month ?? 0)}${i.modelYear !== null ? ` (${i.modelYear}년형)` : ''} | ${fmtKm(i.mileage)} | ${fmtManwon(i.price)}`);
  log(`  출처: ${i.sourceUrl ?? '수동 입력'}`);
  log('');

  const trimLabel = c.trimApplied
    ? `트림 '${c.trim}'`
    : c.trim !== null ? `모델 전체 (트림 '${c.trim}' 일치 ${c.trimSampleCount}대로 부족)` : '모델 전체';
  const mileageLabel = c.mileageRatio === null ? '주행 제한 없음' : `주행 ±${Math.round(c.mileageRatio * 100)}%`;
  log(`📈 엔카 동급매물 시세 (${fmtYY(i.year)}년식 ±${c.yearRange}년, ${trimLabel}, ${mileageLabel}, ${r.sampleCount}대)`);
  log(`  모델 매칭: ${c.modelMatchLevel === null ? '-' : LEVEL_LABEL[c.modelMatchLevel]}`);
  log(`  평균: ${fmtManwon(m.mean)} | 중앙값: ${fmtManwon(m.median)}`);
  log(`  P25~P75: ${fmtNum(m.p25)} ~ ${fmtManwon(m.p75)}`);
  log(`  최저: ${fmtManwon(m.min)} | 최고: ${fmtManwon(m.max)}`);
  if (r.isLowSample) log(`  ⚠️ 동급 표본 ${r.sampleCount}대 — 최소 ${c.minSamples}대 미만으로 결과 신뢰도가 낮습니다`);
  log('');
  log(LINE);
  log('');

  log('① 가격');
  const diffWord = p.diffAmount > 0 ? '비쌈' : p.diffAmount < 0 ? '저렴' : '동일';
  log(`  동급 평균 대비: ${signed(p.diffPercent)}% (${fmtNum(Math.abs(p.diffAmount))}만원 ${diffWord})`);
  log(`  시세 중앙값 대비: ${signedInt(p.medianDiff)}만원`);
  log(`  가격 백분위: 동급 ${r.sampleCount}대 중 상위 ${100 - p.percentile}% (${percentileLabel(p.percentile)})`);
  if (p.withinIqr) log(`  시세 범위(P25~P75): ✅ 범위 내 (${fmtNum(m.p25)}~${fmtManwon(m.p75)})`);
  else if (p.iqrExcess > 0) log(`  시세 범위(P25~P75): ⚠️ 범위 초과 (+${fmtNum(p.iqrExcess)}만원)`);
  else log(`  시세 범위(P25~P75): 범위 미만 (${fmtNum(p.iqrExcess)}만원)`);
  log(`  가격 분포: ${fmtNum(p.densestBucket.from)}~${fmtManwon(p.densestBucket.to)} 구간에 ${p.densestBucket.count}대 밀집 (구간 폭 ${fmtNum(p.bucketWidth)}만원)`);
  log(`  입력 매물 구간: ${p.inputBucket ? `${fmtNum(p.inputBucket.from)}~${fmtManwon(p.inputBucket.to)} (${p.inputBucket.count}대)` : '동급 분포 범위 밖'}`);
  if (p.sameYear) {
    log(`  동일 연식(${fmtYY(i.year)}년식) 평균: ${fmtManwon(p.sameYear.mean)} (${p.sameYear.count}대) → ${signed(((i.price - p.sameYear.mean) / p.sameYear.mean) * 100)}%`);
  }
  log('');

  log('② 주행거리');
  const mc = r.mileage;
  if (mc.peerAvgMileage === null) {
    log(`  동급 평균: 정보 없음 → 입력 매물 ${fmtKm(mc.inputMileage)}`);
  } else {
    const rel = mc.peerRatio !== null && mc.peerRatio <= 0.8 ? '평균 이하, 양호' : mc.peerRatio !== null && mc.peerRatio >= 1.2 ? '평균 이상' : '평균 수준';
    log(`  동급 평균: ${fmtKm(mc.peerAvgMileage)} → 입력 매물 ${fmtKm(mc.inputMileage)} (${rel})`);
  }
  const annualLabel = mc.judgement === 'low' ? '⚠️ 과소주행 (연 5,000km 미만)' : mc.judgement === 'high' ? '⚠️ 과다주행 (연 25,000km 이상)' : '정상 범위';
  log(`  연평균 주행거리: ~${fmtKm(mc.annualMileage)} (${annualLabel}) — 차령 ${mc.ageMonths}개월 기준`);
  if (mc.inputMileage >= 150000) log('  ⚠️ 15만km 이상 — 엔카 품질점수 주행거리 감점 구간');
  log('');

  log('③ 사고/보험이력');
  const a = r.accident;
  if (a.severity === null) log('  입력: 정보 미제공');
  else if (a.severity === 'none') log('  입력: 무사고 (내차피해 0건)');
  else {
    const base = `  입력: 내차피해 ${a.inputAccidentCount ?? '?'}건, 보험금 ${fmtWon(a.inputAccidentAmount)}`;
    const ratioText = a.amountRatio !== null && a.originPriceUsed !== null
      ? ` — 신차가 ${fmtManwon(a.originPriceUsed)}${a.originPriceSource === 'peer_avg' ? '(동급 평균)' : ''} 대비 ${(a.amountRatio * 100).toFixed(1)}%`
      : '';
    log(`${base}${ratioText} (${SEVERITY_LABEL[a.severity]})`);
  }
  log(`  동급 무사고 비율: ${fmtPct(a.peerAccidentFreeRatio)} (${a.peerKnownCount}대 중 ${a.peerAccidentFreeCount}대) | 동급 평균 사고: ${a.peerAvgAccidentCount === null ? '-' : a.peerAvgAccidentCount.toFixed(1) + '건'}`);
  if (a.severity === 'none') log('  → 무사고 매물은 동급에서 프리미엄 요인');
  else if (a.severity === 'minor') log('  → 경미한 사고 (신차가 대비 8% 이하)');
  else if (a.severity === 'moderate') log('  → 중간 규모 사고 — 수리 내역 확인 권장');
  else if (a.severity === 'severe') log('  → ⚠️ 대형 사고 — 가격 할인 폭 확인 필요');
  else log('  → 보험이력 확인 권장');
  log('');

  log('④ 성능점검');
  const ins = r.inspection;
  log(`  입력: ${inspectionInputText(ins.input)}`);
  log(`  동급 무사고(교환·판금·부식 없음) 비율: ${fmtPct(ins.peerCleanRatio)} (${ins.peerInspectableCount}대 중 ${ins.peerCleanCount}대) | 엔카진단 비율: ${fmtPct(ins.peerDiagnosisRatio)}`);
  if (ins.input !== null && ins.input.isClean !== true && ins.peerSameStateRatio !== null) {
    log(`  동급 중 동일 상태 비율: ${fmtPct(ins.peerSameStateRatio)}`);
  }
  if (ins.input === null) log('  → 성능점검 확인 권장');
  else if (ins.input.isClean === true) log('  → 무사고 점검 (양호)');
  else if (ins.input.hasWelding === true) log('  → 판금 이력 — 부위 확인 권장');
  else if (ins.input.hasReplacement === true) log('  → 교환 이력 — 부위(외판/골격) 확인 권장');
  else log('  → 점검 상세 확인 권장');
  log('');

  log('⑤ 소유주 변경');
  const o = r.owner;
  log(`  입력: ${o.inputCount === null ? '정보 미제공' : `${o.inputCount}회 변경 (엔카 기준 감점률 ${Math.round((o.deductionRate ?? 0) * 100)}%)`}`);
  if (o.peerAvgCount === null) log('  동급 평균: -');
  else {
    const rel = o.inputCount === null ? '' : o.inputCount <= o.peerAvgCount - 0.5 ? ' → 평균보다 적음 (양호)' : o.inputCount >= o.peerAvgCount + 0.5 ? ' → 평균보다 많음' : ' → 평균 수준';
    log(`  동급 평균: ${o.peerAvgCount.toFixed(1)}회${rel}`);
  }
  log('');

  log('⑥ 렌트이력');
  const rt = r.rental;
  log(`  입력: ${rt.inputHasRental === null ? '정보 미제공' : rt.inputHasRental ? '있음' : '없음'}`);
  log(`  동급 렌트이력 비율: ${fmtPct(rt.peerRentalRatio)} (${rt.peerKnownCount}대 중 ${rt.peerRentalCount}대)`);
  if (rt.inputHasRental === true) log('  → ⚠️ 렌트 이력 (엔카 품질점수 렌트 항목 0점)');
  else if (rt.inputHasRental === false) log('  → 비렌트 매물 (양호)');
  else log('  → 렌트/영업용 이력 확인 권장');
  log('');

  log('⑦ 옵션·사양');
  const op = r.option;
  if (op.items === null) log('  옵션 목록: 정보 미제공');
  else {
    const tag = (x: InputOptionItem): string => (x.availability === 'default' ? `${x.name}[기본]` : x.name);
    const loaded = op.items.filter((x) => x.choice === 'loaded').map(tag);
    const after = op.items.filter((x) => x.choice === 'loaded_aftermarket').map(tag);
    const absent = op.items.filter((x) => x.choice === 'absent').map((x) => x.name);
    const unknown = op.items.filter((x) => x.choice === 'unknown').map((x) => x.name);
    log(`  장착: ${loaded.length > 0 ? loaded.join(', ') : '없음'}`);
    if (after.length > 0) log(`  사제 장착: ${after.join(', ')}`);
    if (absent.length > 0) log(`  미장착: ${absent.join(', ')}`);
    if (unknown.length > 0) log(`  상태 미상: ${unknown.join(', ')}`);
  }
  if (op.packages === null) log('  출고 선택옵션: 정보 미제공');
  else if (op.packages.length === 0) log(`  출고 선택옵션: 없음 (${PLATFORM_LABEL[i.platform]} 출고 정보 기준)`);
  else log(`  출고 선택옵션: ${op.packages.map((p) => (p.price === null ? p.name : `${p.name} ${fmtManwon(p.price)}`)).join(', ')}${op.packagesTotal !== null ? ` (합계 ${fmtManwon(op.packagesTotal)})` : ''}`);
  const pp = op.packagePeers;
  if (pp !== null) {
    if (pp.items === null) {
      log(`  동급 동일 선택옵션 장착 비율: 옵션 이름이 확인된 동급이 ${pp.knownCount}대(트림 동급 ${pp.poolCount}대 중)로 부족해 생략 — 엔카 옵션 재수집 후 표시`);
    } else {
      const base = pp.knownCount < pp.poolCount
        ? `트림 동급 ${pp.poolCount}대 중 옵션 이름이 확인된 ${pp.knownCount}대`
        : `트림 동급 ${pp.knownCount}대`;
      log(`  동급 동일 선택옵션 장착 비율 (${base} 기준, 연식 ±${c.yearRange}년·주행거리 무관, 점수 미반영):`);
      for (const it of pp.items) {
        log(it.withCount === 0
          ? `    - ${it.name}: 같은 이름의 옵션을 가진 동급 없음 (엔카 표기 차이일 수 있음)`
          : `    - ${it.name}: ${it.withCount}/${pp.knownCount}대 (${fmtPct(it.withCount / pp.knownCount)})${fmtMatchedNames(it.name, it.matchedNames)}`);
      }
    }
  }
  if (op.specDiffPercent === null) {
    log(`  옵션 포함 신차가: ${op.inputOriginPrice === null ? '입력 정보 미제공' : `입력 ${fmtManwon(op.inputOriginPrice)} / 동급 신차가 정보 부족 (${op.peerOriginCount}대)`}`);
    log('  → 사양 보정 없음 (정보 미제공)');
  } else {
    const scopeLabel = op.peerOriginScope === 'same_year' ? `${fmtYY(i.year)}년식 ` : '';
    log(`  옵션 포함 신차가: 입력 ${fmtManwon(op.inputOriginPrice)} vs 동급 ${scopeLabel}${op.peerOriginCount}대 평균 ${fmtManwon(op.peerOriginAvg)} → ${signed(op.specDiffPercent)}%`);
    if (op.peerOptionAvg !== null) log(`  동급 선택옵션 합계 평균: ${fmtManwon(op.peerOptionAvg)} (선택옵션 없는 매물 ${fmtPct(op.peerNoOptionRatio)})`);
    if (op.scope === 'trim_and_options') log('  ℹ 트림이 섞인 동급과 비교 — 신차가 차이에 트림·옵션 차이가 함께 반영됩니다');
    if (r.judgement.specAdjustment === 0) log(specMaxAdjust() === 0 ? '  → 사양 보정 꺼짐 (COMPARE_SPEC_MAX_ADJUST=0)' : `  → 신차가 차이 ±${SPEC_DEADBAND}% 미만 — 사양 보정 없음`);
    else log(`  → 사양 보정: 기대 시세 ${signed(r.judgement.specAdjustment)}% 반영 (상한 ±${specMaxAdjust()}%)`);
  }
  log('');

  log(LINE);
  log('');

  log(VERDICT_LABEL[r.judgement.verdict]);
  log('');
  for (const line of buildVerdictLines(r)) log(`  ${line}`);
  log('');
  for (const rec of buildRecommendations(r)) log(`  💡 권장: ${rec}`);
  log('');
  log(LINE);
}
