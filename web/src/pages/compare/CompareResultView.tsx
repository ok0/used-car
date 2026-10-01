import type { CompareResponse } from '../../../../src/server/api-types';
import { LEVEL_LABEL, PLATFORM_LABEL, VERDICT_META } from '../../lib/labels';
import { fmtKm, fmtKst, fmtManwon, fmtNum, fmtSigned, fmtYY, fmtYearMonth } from '../../lib/format';
import { VerdictBadge } from '../../components/Badge';
import { Histogram } from '../../components/Histogram';
import { Notice } from '../../components/States';
import { VehicleTable } from '../../components/VehicleTable';
import { AxisCards } from './AxisCards';
import { OptionSection } from './OptionSection';

export function CompareResultView({ r }: { r: CompareResponse }) {
  const x = r.result;
  const i = r.input;
  const c = x.criteria;
  const m = x.market;
  const j = x.judgement;
  const trimLabel = c.trimApplied ? `트림 '${c.trim}'` : c.trim !== null ? `모델 전체 (트림 '${c.trim}' 일치 ${c.trimSampleCount}대로 부족)` : '모델 전체';
  return (
    <div className="stack">
      <section className={`card verdict ${VERDICT_META[j.verdict].cls}`}>
        <div className="verdict-top">
          <VerdictBadge verdict={j.verdict} large />
          <div>
            <h2 className="verdict-title">{r.title} <span className="muted">({PLATFORM_LABEL[i.platform]})</span></h2>
            <p className="muted">
              {fmtYearMonth(i.year, i.month)}{i.modelYear !== null ? ` (${i.modelYear}년형)` : ''} · {fmtKm(i.mileage)} · <strong>{fmtManwon(i.price)}</strong>
              {' · '}{i.sourceUrl ? <a href={i.sourceUrl} target="_blank" rel="noopener noreferrer">원문 보기 ↗</a> : '수동 입력'}
              {' · '}분석 {fmtKst(r.analyzedAt)}
            </p>
          </div>
        </div>
        <ul className="verdict-lines">{r.verdictLines.map((l, k) => <li key={k}>{l}</li>)}</ul>
      </section>

      {x.isLowSample && (
        <div className="notice notice-warn" role="alert"><p className="notice-title">! 동급 표본 {x.sampleCount}대 — 최소 {c.minSamples}대 미만으로 결과 신뢰도가 낮습니다</p></div>
      )}
      <Notice kind="warn" title="파싱 경고" items={r.warnings} />
      <Notice kind="info" title="참고" items={[...r.notes, ...(r.overridden.length > 0 ? [`수동 입력값으로 덮어씀: ${r.overridden.join(', ')}`] : [])]} />

      <section className="card">
        <h2 className="card-title">엔카 동급매물 시세</h2>
        <div className="grid-4 stats-row">
          <div className="stat"><div className="stat-label">평균</div><div className="stat-value">{fmtManwon(m.mean)}</div></div>
          <div className="stat"><div className="stat-label">중앙값</div><div className="stat-value">{fmtManwon(m.median)}</div></div>
          <div className="stat"><div className="stat-label">P25 ~ P75</div><div className="stat-value">{fmtNum(m.p25)} ~ {fmtManwon(m.p75)}</div></div>
          <div className="stat"><div className="stat-label">최저 ~ 최고 ({x.sampleCount}대)</div><div className="stat-value">{fmtNum(m.min)} ~ {fmtManwon(m.max)}</div></div>
        </div>
        <Histogram price={x.price} market={m} />
      </section>

      <AxisCards r={r} />

      <div className="grid-2">
        <section className="card">
          <h2 className="card-title">판정 계산</h2>
          <table className="table compact"><tbody>
            <tr><td>동급 평균 대비 가격 차이</td><td className="num">{fmtSigned(j.diffPercent)}%</td></tr>
            <tr><td>옵션·사양 보정 (기대 시세)</td><td className="num">{j.specAdjustment === 0 ? '없음' : `${fmtSigned(j.specAdjustment)}%`}</td></tr>
            <tr><td>연식·주행·렌트 구성 보정</td><td className="num">{j.compositionAdjustment === 0 ? '없음' : `${fmtSigned(-j.compositionAdjustment)}%`}</td></tr>
            <tr><td>보정 후 가격 차이</td><td className="num"><strong>{fmtSigned(j.adjustedDiffPercent)}%</strong></td></tr>
            <tr><td>기본 플랫폼 프리미엄</td><td className="num">{j.basePremium}%</td></tr>
            {j.factors.map((f) => <tr key={f.axis + f.reason}><td className="indent">품질 보정: {f.reason}</td><td className="num">{f.points > 0 ? '+' : ''}{f.points}%p</td></tr>)}
            <tr><td>허용 프리미엄 (0~10%)</td><td className="num">{j.allowedPremium}%</td></tr>
            <tr><td>허용치 초과</td><td className="num">{fmtSigned(j.excessOverAllowance)}%p</td></tr>
            <tr><td>치명 요인</td><td>{j.criticalReasons.length > 0 ? j.criticalReasons.join(', ') : '없음'}</td></tr>
            <tr><td>참고: 구성 차이 예상</td><td className="num">{fmtSigned(x.diagnostics.compositionPercent)}%</td></tr>
            <tr><td>참고: 동급 평균 표준오차</td><td className="num">{x.diagnostics.meanStdErrPercent === null ? '-' : `±${x.diagnostics.meanStdErrPercent.toFixed(1)}%`}</td></tr>
          </tbody></table>
          <p className="muted small">저렴함: 허용치보다 5% 이상 낮고 치명 요인 없음 · 적정가: 허용치 ±5% · 다소 비쌈: 허용치 +5~15% · 비쌈: 허용치 +15% 이상</p>
        </section>
        <section className="card">
          <h2 className="card-title">권장 사항</h2>
          <ul className="plain-list">{r.recommendations.map((t, k) => <li key={k}>{t}</li>)}</ul>
          <h3 className="card-subtitle">동급 매칭 조건</h3>
          <dl className="kv">
            <div className="kv-row"><dt>모델 매칭</dt><dd>{c.modelMatchLevel === null ? '-' : LEVEL_LABEL[c.modelMatchLevel]}</dd></div>
            <div className="kv-row"><dt>트림</dt><dd>{trimLabel}</dd></div>
            <div className="kv-row"><dt>연식</dt><dd>{fmtYY(c.yearFrom)}~{fmtYY(c.yearTo)}년식 (±{c.yearRange}년)</dd></div>
            <div className="kv-row"><dt>주행거리</dt><dd>{c.mileageRatio === null ? '제한 없음' : `±${Math.round(c.mileageRatio * 100)}%`}</dd></div>
            <div className="kv-row"><dt>표본</dt><dd>{x.sampleCount}대 (최소 {c.minSamples}대, 기준 풀 {c.basePoolCount}대)</dd></div>
          </dl>
        </section>
      </div>

      <OptionSection r={r} />

      <section className="card">
        <h2 className="card-title">동급 매물 {r.peers.length}대 <span className="muted small">가격 낮은순 · 행을 누르면 상세</span></h2>
        <VehicleTable items={r.peers} marker={{ price: i.price, label: `이 매물 — ${r.title}` }} />
      </section>
    </div>
  );
}
