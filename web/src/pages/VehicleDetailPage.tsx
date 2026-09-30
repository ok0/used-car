import type { ReactNode } from 'react';
import type { VehicleDetailResponse } from '../../../src/server/api-types';
import type { ScoreBreakdown } from '../../../src/types';
import { useApi } from '../api';
import { Link } from '../router';
import { USAGE_LABEL } from '../lib/labels';
import { fmtBool, fmtKm, fmtKst, fmtManwon, fmtNum, fmtPoints, fmtPrice, fmtWon, fmtYearMonth, vehicleLabel } from '../lib/format';
import { HBar } from '../components/Bar';
import { Chip, GradeBadge } from '../components/Badge';
import { ErrorBox, Loading } from '../components/States';

// detail CLI 와 같은 순서·만점
const SCORE_ITEMS: [string, keyof ScoreBreakdown][] = [
  ['가격', 'price'], ['렌트이력', 'rental'], ['사고/보험', 'accident'], ['성능점검', 'inspection'], ['소유주이력', 'ownerChanges'], ['주행거리', 'mileage'],
];
const RANK_LABELS: [ 'ONE' | 'TWO' | 'A' | 'B', string][] = [['ONE', '외판 1랭크'], ['TWO', '외판 2랭크'], ['A', '골격 A랭크'], ['B', '골격 B랭크']];

function Kv({ items }: { items: [string, ReactNode][] }) {
  return <dl className="kv">{items.map(([k, v]) => <div key={k} className="kv-row"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function VehicleDetailPage({ carId }: { carId: string }) {
  const { data, error, loading, reload } = useApi<VehicleDetailResponse>(`/api/vehicles/${encodeURIComponent(carId)}`);
  if (error) return <div className="stack"><Link to="/vehicles">← 매물 목록</Link><ErrorBox error={error} onRetry={error.status >= 500 || error.status === 0 ? reload : undefined} /></div>;
  if (!data) return loading ? <Loading /> : null;
  const v = data.vehicle;
  const b = v.scoreBreakdown;
  const pb = data.priceBaseline;
  return (
    <div className="stack">
      <div><a href="/vehicles" onClick={(e) => { if (window.history.length > 1) { e.preventDefault(); window.history.back(); } }}>← 뒤로</a></div>
      <header className="detail-head">
        <h1 className="page-title">{vehicleLabel(v)}{v.gradeDetail ? ` ${v.gradeDetail}` : ''}</h1>
        <div className="chips">
          <GradeBadge grade={v.scoreGrade} />
          <Chip>{v.isDomestic ? '국산' : '수입'}</Chip>
          {data.stale && <Chip tone="warn">미확인</Chip>}
          {v.hasRentalHistory && <Chip tone="bad">렌트 이력</Chip>}
        </div>
        <p className="muted">매물 ID {v.carId}{v.actualCarId ? ` (실제 차량 ID ${v.actualCarId})` : ''} · 차량번호 {v.vehicleNo ?? '-'} · <a href={data.encarUrl} target="_blank" rel="noopener noreferrer">엔카에서 보기 ↗</a></p>
        {data.stale && <div className="notice notice-warn"><p>{data.staleDays}일 이상 엔카 목록에서 확인되지 않았습니다 — 판매 완료 가능성. 비교·시세·가격 점수 기준에서 제외 중입니다.</p></div>}
      </header>

      <div className="grid-2">
        <section className="card">
          <h2 className="card-title">기본 정보</h2>
          <Kv items={[
            ['연식', `${fmtYearMonth(v.year, v.month)} (연형 ${v.formYear ?? '-'})`],
            ['주행거리', fmtKm(v.mileage)],
            ['가격', fmtPrice(v.price)],
            ['신차가', `기본 ${fmtManwon(v.originPriceBase)} + 옵션 ${fmtManwon(v.originPriceOptions)} = ${fmtManwon(v.originPrice)}`],
            ['연료 / 변속기', `${v.fuelType ?? '-'} / ${v.transmission ?? '-'}`],
            ['배기량 / 색상', `${v.displacement == null ? '-' : `${fmtNum(v.displacement)}cc`} / ${v.color ?? '-'}`],
            ['지역 / 판매유형', `${v.region ?? '-'} / ${v.sellType ?? '-'}${v.leaseType ? ` (리스 ${v.leaseType})` : ''}`],
            ['최초등록 / 최초광고', `${v.firstRegistrationDate ?? '-'} / ${v.firstAdvertisedAt ?? '-'}`],
            ['수집 / 목록 확인', `${fmtKst(v.collectedAt)} / ${fmtKst(v.lastSeenAt)}`],
          ]} />
        </section>
        <section className="card">
          <h2 className="card-title">품질 점수</h2>
          {b === null ? <p className="muted">채점 전 — npx ts-node src/scoring/rescore.ts 로 재채점하세요</p> : (
            <>
              <table className="table compact"><tbody>
                {SCORE_ITEMS.map(([label, key]) => (
                  <tr key={key}><td style={{ width: 88 }}>{label}</td>
                    <td><HBar value={b[key]} max={data.weights[key]} text={`${fmtPoints(b[key])} / ${data.weights[key]}`} /></td></tr>
                ))}
              </tbody></table>
              {(v.scorePenalty ?? 0) > 0 && <p className="text-warn">비공개 패널티 −{v.scorePenalty} (보험이력 또는 성능점검 비공개)</p>}
              <p className="score-total">최종 <GradeBadge grade={v.scoreGrade} /> <strong className="num">{fmtPoints(v.scoreTotal ?? 0)}점</strong> / 100</p>
            </>
          )}
        </section>
      </div>

      <section className="card">
        <h2 className="card-title">가격 기준</h2>
        <Kv items={[
          ['출처', pb.source === 'yearly' ? '엔카 연식별 시세' : pb.source === 'local' ? '로컬 DB 동일 모델·트림·연식 평균' : `기준 없음 — 로컬 동일 조건 표본 ${pb.localSampleCount}대 (최소 ${pb.minLocalSamples}대 필요) → 가격 점수 중립(50%)`],
          ['기준 평균', pb.avgPrice === null ? '-' : `${fmtManwon(pb.avgPrice)} (표본 ${pb.sampleCount ?? '-'}대)`],
          ['가격 비율', pb.avgPrice !== null && v.price > 0 ? `${((v.price / pb.avgPrice) * 100).toFixed(1)}% (이 매물 ${fmtManwon(v.price)} ÷ 기준 ${fmtManwon(pb.avgPrice)})` : '-'],
          ['동급매물 시세', data.marketPrice ? `중앙값 ${fmtManwon(data.marketPrice.median)} (P25 ${fmtNum(data.marketPrice.p25)} ~ P75 ${fmtNum(data.marketPrice.p75)}, ${data.marketPrice.sampleCount}대, ${fmtKst(data.marketPrice.collectedAt)})` : '미수집 (ENCAR_FETCH_MARKET=1 로 collect 시 수집)'],
          ['연식별 시세', data.yearlyPrices.length > 0 ? data.yearlyPrices.map((p) => `${p.year}년 ${fmtManwon(p.avgPrice)}(${p.count}대)`).join(', ') : '미수집 (ENCAR_FETCH_YEARLY=1 로 collect 시 수집)'],
        ]} />
        <p className="muted small">현재 DB 기준으로 재구성한 값입니다 (collect 이후 DB가 바뀌었으면 저장된 가격 점수와 다를 수 있음).</p>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2 className="card-title">보험 / 사고 이력</h2>
          {v.isInsurancePrivate ? <p className="text-warn">보험이력 비공개 (패널티 대상)</p> : (
            <>
              <Kv items={[
                ['보험처리', `${v.insuranceCount}건`],
                ['내차피해', `${v.myDamageCount}건 ${fmtWon(v.myDamageAmount)}`],
                ['타차가해', `${v.otherDamageCount}건 ${fmtWon(v.otherDamageAmount)}`],
                ['정보제공 불가기간', v.unavailablePeriods.length ? v.unavailablePeriods.join(', ') : '없음'],
              ]} />
              {data.accidents.length > 0 && (
                <table className="table compact"><thead><tr><th>날짜</th><th className="num">보험금</th><th className="num">부품</th><th className="num">공임</th><th className="num">도장</th><th /></tr></thead>
                  <tbody>{data.accidents.map((a, i) => (
                    <tr key={i}><td>{a.accidentDate || '날짜 미상'}</td><td className="num">{fmtWon(a.insuranceBenefit)}</td><td className="num">{fmtWon(a.partCost)}</td>
                      <td className="num">{fmtWon(a.laborCost)}</td><td className="num">{fmtWon(a.paintingCost)}</td><td>{a.isMajor && <Chip tone="bad">큰 사고</Chip>}</td></tr>
                  ))}</tbody></table>
              )}
            </>
          )}
        </section>
        <section className="card">
          <h2 className="card-title">성능점검 / 엔카진단</h2>
          {v.isInspectionPrivate ? <p className="text-warn">성능점검 비공개 (패널티 대상)</p> : (
            <>
              <Kv items={[['성능점검', fmtBool(v.hasInspection)], ['교환 / 판금 / 부식', `${fmtBool(v.hasReplacement)} / ${fmtBool(v.hasWelding)} / ${fmtBool(v.hasCorrosion)}`]]} />
              {v.rankCounts && (
                <table className="table compact"><thead><tr><th>부위</th><th className="num">교환</th><th className="num">판금</th><th className="num">부식</th></tr></thead>
                  <tbody>{RANK_LABELS.map(([k, label]) => { const r = v.rankCounts![k]; return <tr key={k}><td>{label}</td><td className="num">{r.X}</td><td className="num">{r.W}</td><td className="num">{r.C}</td></tr>; })}</tbody></table>
              )}
            </>
          )}
          <Kv items={[['엔카진단', v.hasDiagnosis ? (v.diagnosisTier ?? '있음') : '없음'], ['프레임 / 패널 교환', `${fmtBool(v.diagFrameReplacement)} / ${fmtBool(v.diagPanelReplacement)}`]]} />
        </section>
        <section className="card">
          <h2 className="card-title">소유주 변경 · 용도 이력</h2>
          <Kv items={[
            ['소유주 변경', `${v.ownerChangeCount}회${data.ownerChanges.length ? ` (${data.ownerChanges.map((o) => o.changeDate || '날짜 미상').join(', ')})` : ''}`],
            ['렌트이력 / 용도변경', `${fmtBool(v.hasRentalHistory)} / ${fmtBool(v.hasUsageChange)}`],
            ['용도 이력', data.usageHistory.length ? data.usageHistory.map((u) => USAGE_LABEL[u.usageCode] ?? `기타(${u.usageCode})`).join(' → ') : '기록 없음'],
          ]} />
        </section>
        <section className="card">
          <h2 className="card-title">선택옵션 {data.options.length}개 (합계 {fmtManwon(v.originPriceOptions)})</h2>
          {v.optionsStatus === 'failed' && <p className="text-warn">선택옵션 API 조회 실패 — 합계가 실제보다 작을 수 있음</p>}
          {data.options.length === 0 ? <p className="muted">없음</p> : (
            <table className="table compact"><tbody>{data.options.map((o, i) => (
              <tr key={i}><td>{o.optionName ?? o.optionCode}</td><td className="num">{fmtManwon(o.optionPrice)}</td></tr>
            ))}</tbody></table>
          )}
          <h3 className="card-subtitle">딜러</h3>
          <p>{v.dealerName ?? '-'} / {v.dealerFirmName ?? '-'} · 가입 {v.dealerJoinedAt?.slice(0, 10) ?? '-'} · 누적 판매 {v.dealerTotalSales == null ? '-' : `${fmtNum(v.dealerTotalSales)}대`}</p>
        </section>
      </div>
    </div>
  );
}
