import type { ReactNode } from 'react';
import type { CompareResponse } from '../../../../src/server/api-types';
import type { InspectionInfo } from '../../../../src/types';
import { accidentTone, inspectionTone, mileageTone, optionTone, ownerTone, priceTone, rentalTone } from '../../lib/compare-view';
import { SEVERITY_LABEL, percentileLabel, type Tone } from '../../lib/labels';
import { fmtKm, fmtManwon, fmtNum, fmtPct, fmtSigned, fmtSignedInt, fmtWon, fmtYY, fmtYn } from '../../lib/format';
import { HBar, PercentileBar } from '../../components/Bar';
import { ToneBadge } from '../../components/Badge';

function AxisCard({ no, title, tone, rows, conclusion }: { no: string; title: string; tone: Tone; rows: [string, ReactNode][]; conclusion?: string }) {
  return (
    <section className="card axis">
      <header className="axis-head"><h3>{no} {title}</h3><ToneBadge tone={tone} /></header>
      <dl className="kv">{rows.map(([k, v]) => <div key={k} className="kv-row"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {conclusion && <p className="axis-conclusion">{conclusion}</p>}
    </section>
  );
}

function ratioRow(ratio: number | null, known: number, count: number): ReactNode {
  return ratio === null ? '-' : <HBar value={ratio} max={1} tone="muted" text={`${fmtPct(ratio)} (${known}대 중 ${count}대)`} />;
}

function inspectionText(x: InspectionInfo | null): string {
  return x === null ? '정보 미제공' : `${x.label} (교환 ${fmtYn(x.hasReplacement)} / 판금 ${fmtYn(x.hasWelding)} / 부식 ${fmtYn(x.hasCorrosion)})`;
}

export function AxisCards({ r }: { r: CompareResponse }) {
  const x = r.result;
  const i = r.input;
  const p = x.price;
  const m = x.market;
  const mc = x.mileage;
  const a = x.accident;
  const ins = x.inspection;
  const o = x.owner;
  const rt = x.rental;
  const op = x.option;
  const diffWord = p.diffAmount > 0 ? '비쌈' : p.diffAmount < 0 ? '저렴' : '동일';
  const milRel = mc.peerRatio !== null && mc.peerRatio <= 0.8 ? '평균 이하, 양호' : mc.peerRatio !== null && mc.peerRatio >= 1.2 ? '평균 이상' : '평균 수준';
  const annual = mc.judgement === 'low' ? '과소주행 (연 5,000km 미만)' : mc.judgement === 'high' ? '과다주행 (연 25,000km 이상)' : '정상 범위';
  const milMax = Math.max(mc.inputMileage, mc.peerAvgMileage ?? 0, 1);
  const accInput = a.severity === null ? '정보 미제공' : a.severity === 'none' ? '무사고 (내차피해 0건)'
    : `내차피해 ${a.inputAccidentCount ?? '?'}건, 보험금 ${fmtWon(a.inputAccidentAmount)}${a.amountRatio !== null && a.originPriceUsed !== null ? ` — 신차가 ${fmtManwon(a.originPriceUsed)}${a.originPriceSource === 'peer_avg' ? '(동급 평균)' : ''} 대비 ${(a.amountRatio * 100).toFixed(1)}%` : ''} (${SEVERITY_LABEL[a.severity]})`;
  const accConc = a.severity === 'none' ? '무사고 매물은 동급에서 프리미엄 요인' : a.severity === 'minor' ? '경미한 사고 (신차가 대비 8% 이하)'
    : a.severity === 'moderate' ? '중간 규모 사고 — 수리 내역 확인 권장' : a.severity === 'severe' ? '대형 사고 — 가격 할인 폭 확인 필요' : '보험이력 확인 권장';
  const insConc = ins.input === null ? '성능점검 확인 권장' : ins.input.isClean === true ? '무사고 점검 (양호)'
    : ins.input.hasWelding === true ? '판금 이력 — 부위 확인 권장' : ins.input.hasReplacement === true ? '교환 이력 — 부위(외판/골격) 확인 권장' : '점검 상세 확인 권장';
  const ownRel = o.inputCount === null || o.peerAvgCount === null ? '' : o.inputCount <= o.peerAvgCount - 0.5 ? ' → 평균보다 적음 (양호)' : o.inputCount >= o.peerAvgCount + 0.5 ? ' → 평균보다 많음' : ' → 평균 수준';
  return (
    <div className="grid-2">
      <AxisCard no="①" title="가격" tone={priceTone(x.judgement.verdict)} rows={[
        ['동급 평균 대비', `${fmtSigned(p.diffPercent)}% (${fmtNum(Math.abs(p.diffAmount))}만원 ${diffWord})`],
        ['중앙값 대비', `${fmtSignedInt(p.medianDiff)}만원`],
        ['가격 백분위', <><PercentileBar percentile={p.percentile} label={`백분위 ${p.percentile}`} /><span>동급 {x.sampleCount}대 중 상위 {100 - p.percentile}% ({percentileLabel(p.percentile)})</span></>],
        ['시세 범위 (P25~P75)', p.withinIqr ? `범위 내 (${fmtNum(m.p25)}~${fmtManwon(m.p75)})` : p.iqrExcess > 0 ? `범위 초과 (+${fmtNum(p.iqrExcess)}만원)` : `범위 미만 (${fmtNum(p.iqrExcess)}만원)`],
        ...(p.sameYear ? [[`동일 연식(${fmtYY(i.year)}년식) 평균`, `${fmtManwon(p.sameYear.mean)} (${p.sameYear.count}대) → ${fmtSigned(((i.price - p.sameYear.mean) / p.sameYear.mean) * 100)}%`] as [string, ReactNode]] : []),
      ]} />
      <AxisCard no="②" title="주행거리" tone={mileageTone(mc)} rows={[
        ['이 매물', <HBar value={mc.inputMileage} max={milMax} text={fmtKm(mc.inputMileage)} />],
        ['동급 평균', mc.peerAvgMileage === null ? '정보 없음' : <HBar value={mc.peerAvgMileage} max={milMax} tone="muted" text={`${fmtKm(mc.peerAvgMileage)} (${milRel})`} />],
        ['연평균', `~${fmtKm(mc.annualMileage)} (${annual}) — 차령 ${mc.ageMonths}개월`],
      ]} conclusion={mc.inputMileage >= 150000 ? '15만km 이상 — 엔카 품질점수 주행거리 감점 구간' : undefined} />
      <AxisCard no="③" title="사고 / 보험이력" tone={accidentTone(a)} rows={[
        ['이 매물', accInput],
        ['동급 무사고 비율', ratioRow(a.peerAccidentFreeRatio, a.peerKnownCount, a.peerAccidentFreeCount)],
        ['동급 평균 사고', a.peerAvgAccidentCount === null ? '-' : `${a.peerAvgAccidentCount.toFixed(1)}건`],
      ]} conclusion={accConc} />
      <AxisCard no="④" title="성능점검" tone={inspectionTone(ins)} rows={[
        ['이 매물', inspectionText(ins.input)],
        ['동급 무사고 비율', ratioRow(ins.peerCleanRatio, ins.peerInspectableCount, ins.peerCleanCount)],
        ['엔카진단 비율', fmtPct(ins.peerDiagnosisRatio)],
        ...(ins.input !== null && ins.input.isClean !== true && ins.peerSameStateRatio !== null ? [['동급 중 동일 상태', fmtPct(ins.peerSameStateRatio)] as [string, ReactNode]] : []),
      ]} conclusion={insConc} />
      <AxisCard no="⑤" title="소유주 변경" tone={ownerTone(o)} rows={[
        ['이 매물', o.inputCount === null ? '정보 미제공' : `${o.inputCount}회 변경 (엔카 기준 감점률 ${Math.round((o.deductionRate ?? 0) * 100)}%)`],
        ['동급 평균', o.peerAvgCount === null ? '-' : `${o.peerAvgCount.toFixed(1)}회${ownRel}`],
      ]} />
      <AxisCard no="⑥" title="렌트 이력" tone={rentalTone(rt)} rows={[
        ['이 매물', rt.inputHasRental === null ? '정보 미제공' : rt.inputHasRental ? '있음' : '없음'],
        ['동급 렌트이력 비율', ratioRow(rt.peerRentalRatio, rt.peerKnownCount, rt.peerRentalCount)],
      ]} conclusion={rt.inputHasRental === true ? '렌트 이력 (엔카 품질점수 렌트 항목 0점)' : rt.inputHasRental === false ? '비렌트 매물 (양호)' : '렌트/영업용 이력 확인 권장'} />
      <AxisCard no="⑦" title="옵션 · 사양" tone={optionTone(op, x.judgement.specAdjustment)} rows={[
        ['옵션 포함 신차가', op.specDiffPercent === null
          ? (op.inputOriginPrice === null ? '입력 정보 미제공' : `입력 ${fmtManwon(op.inputOriginPrice)} / 동급 신차가 정보 부족 (${op.peerOriginCount}대)`)
          : `입력 ${fmtManwon(op.inputOriginPrice)} vs 동급 ${op.peerOriginScope === 'same_year' ? `${fmtYY(i.year)}년식 ` : ''}${op.peerOriginCount}대 평균 ${fmtManwon(op.peerOriginAvg)} → ${fmtSigned(op.specDiffPercent)}%`],
        ['사양 보정', op.specDiffPercent === null ? '없음 (정보 미제공)'
          : x.judgement.specAdjustment !== 0 ? `기대 시세 ${fmtSigned(x.judgement.specAdjustment)}% 반영 (상한 ±${r.settings.specMaxAdjust}%)`
            : r.settings.specMaxAdjust === 0 ? '꺼짐 (상한 0)' : '신차가 차이 ±2% 미만 — 보정 없음'],
        ...(op.peerOptionAvg !== null ? [['동급 선택옵션 합계 평균', `${fmtManwon(op.peerOptionAvg)} (선택옵션 없는 매물 ${fmtPct(op.peerNoOptionRatio)})`] as [string, ReactNode]] : []),
      ]} conclusion={op.scope === 'trim_and_options' ? '트림이 섞인 동급과 비교 — 신차가 차이에 트림·옵션 차이가 함께 반영됩니다' : undefined} />
    </div>
  );
}
