import type { CompareResponse } from '../../../../src/server/api-types';
import type { KnnConfidence, KnnNeighbor, KnnTermKey } from '../../../../src/types';
import { Link } from '../../router';
import { fmtKm, fmtManwon, fmtNum, fmtSigned, fmtYearMonth } from '../../lib/format';
import { VerdictBadge, Chip } from '../../components/Badge';
import { Notice } from '../../components/States';

// src/comparator/knn.ts KNN_TERM_LABEL 과 같은 문구 (웹은 서버 모듈을 import 하지 않음)
const TERM_LABEL: Record<KnnTermKey, string> = {
  age: '차령', mileage: '주행거리', rental: '렌트 이력', accident: '사고 보험금', replacement: '교환', welding: '판금',
  basePrice: '트림 신차가', options: '선택옵션', trim: '세부등급', powertrain: '파워트레인',
};
const CONFIDENCE: Record<KnnConfidence, { label: string; tone: 'good' | 'neutral' | 'warn' }> = {
  high: { label: '신뢰도 높음', tone: 'good' }, medium: { label: '신뢰도 보통', tone: 'neutral' }, low: { label: '신뢰도 낮음', tone: 'warn' },
};
const SHOWN = 10;

function reasons(n: KnnNeighbor): string {
  return n.contributions.length === 0 ? '조건 같음' : n.contributions.slice(0, 3).map((c) => `${TERM_LABEL[c.key]} ${c.percent.toFixed(1)}`).join(' · ');
}

/** 현재 평가 / 유사 매물 평가 병렬 카드 + 합의 안내 + 가까운 이웃 표 */
export function KnnSection({ r }: { r: CompareResponse }) {
  const k = r.result.knn;
  if (k === null) return null;
  const j = r.result.judgement;
  const a = k.agreement;
  const [, , agreeLine, hint] = r.knnLines;
  return (
    <>
      <div className="grid-2">
        <section className="card eval-card" aria-labelledby="eval-current">
          <h2 className="card-title" id="eval-current">현재 평가 <span className="muted small">동급 {r.result.sampleCount}대 평균 + 구성·사양 보정{k.primary ? '' : ' · 종합 판정 기준'}</span></h2>
          <p className="eval-big">{fmtSigned(j.adjustedDiffPercent)}%</p>
          <p><VerdictBadge verdict={j.verdict} /> <span className="muted small">허용치 {j.allowedPremium}% 기준 {fmtSigned(j.excessOverAllowance)}%p</span></p>
        </section>
        <section className="card eval-card" aria-labelledby="eval-knn">
          <h2 className="card-title" id="eval-knn">유사 매물 평가 <span className="muted small">가까운 {k.k}대 가중 평균{k.primary ? ' · 종합 판정 기준' : ' · 참고'}</span></h2>
          <p className="eval-big">{fmtSigned(k.diffPercent)}% <span className="muted small">기대 {fmtManwon(k.expectedPrice)} (95% {fmtNum(k.intervalLow)}~{fmtManwon(k.intervalHigh)})</span></p>
          <p>
            <VerdictBadge verdict={k.verdict} /> <span className="muted small">기본 프리미엄 {k.basePremium}% 기준 {fmtSigned(k.excessOverAllowance)}%p</span>{' '}
            <Chip tone={CONFIDENCE[k.confidence].tone}>{CONFIDENCE[k.confidence].label}</Chip>
          </p>
          <p className="muted small">평균 거리 {k.meanDistance.toFixed(1)}%p · 유효 {k.effectiveCount.toFixed(1)}대 · 10%p 이내 {k.closeCount}대 · 같은 모델 후보 {k.candidateCount}대</p>
        </section>
      </div>
      <Notice kind={a.level === 'major' ? 'warn' : 'info'} title={`두 평가 비교: 차이 ${fmtSigned(a.gap)}%p`} items={[agreeLine, hint].filter((x): x is string => !!x)} />
      <Notice kind="warn" title="유사 매물 평가 참고" items={k.warnings} />
      <section className="card">
        <h2 className="card-title">유사 매물 {Math.min(SHOWN, k.neighbors.length)}대 <span className="muted small">거리 가까운 순 · 거리 = 가격 영향 차이의 합(%p) · 환산가 = 이 매물 조건으로 보정한 가격 (전체 {k.k}대 사용)</span></h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th className="num">#</th><th>트림</th><th>연식</th><th className="num">주행거리</th><th className="num">가격</th><th className="num">환산가</th><th className="num">거리</th><th>주요 차이 (%p)</th><th>이력</th></tr>
            </thead>
            <tbody>
              {k.neighbors.slice(0, SHOWN).map((n, i) => (
                <tr key={n.carId}>
                  <td className="num muted">{i + 1}</td>
                  <td><Link to={`/vehicles/${encodeURIComponent(n.carId)}`}>{[n.gradeName, n.gradeDetail].filter(Boolean).join(' ') || n.modelName || n.carId}</Link></td>
                  <td className="num-plain">{fmtYearMonth(n.year, n.month)}</td>
                  <td className="num">{fmtKm(n.mileage)}</td>
                  <td className="num">{fmtManwon(n.price)}</td>
                  <td className="num"><strong>{fmtManwon(n.adjustedPrice)}</strong></td>
                  <td className="num">{n.distance.toFixed(1)}</td>
                  <td className="knn-reasons">{reasons(n)}</td>
                  <td className="chips">
                    {n.hasRentalHistory && <Chip tone="bad">렌트</Chip>}
                    {n.accidentAmount !== null && n.accidentAmount > 0 && <Chip tone="warn">{`사고 ${fmtNum(n.accidentAmount / 10000)}만`}</Chip>}
                    {(n.hasReplacement || n.hasWelding) && <Chip tone="warn">{n.hasReplacement ? '교환' : '판금'}</Chip>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
