import type { SummaryResponse } from '../../../src/server/api-types';
import { useApi } from '../api';
import { Link, buildQuery } from '../router';
import { GRADES } from '../lib/labels';
import { fmtKst, fmtManwon, fmtNum } from '../lib/format';
import { HBar } from '../components/Bar';
import { Empty, ErrorBox, Loading } from '../components/States';
import { GradeBadge } from '../components/Badge';

export function DashboardPage() {
  const { data, error, loading, reload } = useApi<SummaryResponse>('/api/summary');
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return loading ? <Loading /> : null;
  const s = data.summary;
  if (s.totalCount === 0) {
    return (
      <Empty title="수집된 매물이 없습니다">
        <p><Link to="/collect">수집 화면</Link>에서 엔카 검색 URL로 먼저 수집하세요. 터미널에서는:</p>
        <pre className="code">npx ts-node src/index.ts collect "&lt;엔카 검색 URL&gt;"</pre>
      </Empty>
    );
  }
  const graded = GRADES.reduce((a, g) => a + s.gradeDistribution[g], 0);
  const ungraded = Math.max(0, s.activeCount - graded);
  const gradeMax = Math.max(1, ungraded, ...GRADES.map((g) => s.gradeDistribution[g]));
  const modelMax = Math.max(1, ...s.modelDistribution.map((m) => m.count));
  return (
    <div className="stack">
      <h1 className="page-title">대시보드</h1>
      {s.staleCount > 0 && (
        <div className="notice notice-info">
          <p>아래 통계는 활성 매물 기준입니다. 엔카 목록에서 {s.staleDays}일 이상 확인되지 않은 매물 {fmtNum(s.staleCount)}대는 비교·시세·가격 점수 기준에서 제외됩니다. 확인·삭제: <Link to="/purge">정리 화면</Link></p>
        </div>
      )}
      {s.activeCount === 0 && <div className="notice notice-warn"><p>모든 매물이 미확인 상태입니다 — 계속 볼 검색 URL로 <Link to="/collect">다시 수집</Link>하세요.</p></div>}
      <div className="grid-4">
        <div className="card stat"><div className="stat-label">총 매물</div><div className="stat-value">{fmtNum(s.totalCount)}대</div>
          {s.staleDays > 0 && <div className="stat-sub">활성 {fmtNum(s.activeCount)} · 미확인 {fmtNum(s.staleCount)}</div>}</div>
        <div className="card stat"><div className="stat-label">평균 점수</div><div className="stat-value">{s.scoreAvg === null ? '-' : `${s.scoreAvg.toFixed(1)}점`}</div></div>
        <div className="card stat"><div className="stat-label">가격 범위</div>
          <div className="stat-value">{s.priceMin === null ? '-' : `${fmtNum(s.priceMin)} ~ ${fmtManwon(s.priceMax)}`}</div>
          <div className="stat-sub">평균 {fmtManwon(s.priceAvg)}{s.priceExcludedCount > 0 ? ` · 가격 미정 ${fmtNum(s.priceExcludedCount)}대 제외` : ''}</div></div>
        <div className="card stat"><div className="stat-label">마지막 수집</div><div className="stat-value small">{fmtKst(s.lastCollectedAt)}</div>
          <div className="stat-sub">목록 확인 {fmtKst(s.lastSeenAt)}</div></div>
      </div>
      <div className="grid-2">
        <section className="card">
          <h2 className="card-title">등급 분포</h2>
          <table className="table compact">
            <tbody>
              {GRADES.map((g) => (
                <tr key={g}><td style={{ width: 48 }}><GradeBadge grade={g} /></td><td><HBar value={s.gradeDistribution[g]} max={gradeMax} text={`${fmtNum(s.gradeDistribution[g])}대`} /></td></tr>
              ))}
              {ungraded > 0 && <tr><td className="muted">미채점</td><td><HBar value={ungraded} max={gradeMax} tone="muted" text={`${fmtNum(ungraded)}대`} /></td></tr>}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2 className="card-title">모델 분포 (상위 {s.modelDistribution.length})</h2>
          <table className="table compact">
            <tbody>
              {s.modelDistribution.map((m) => (
                <tr key={m.label}>
                  <td><Link to={`/vehicles${buildQuery({ model: m.label })}`}>{m.label || '(모델 미상)'}</Link></td>
                  <td style={{ width: '45%' }}><HBar value={m.count} max={modelMax} text={`${fmtNum(m.count)}대`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
