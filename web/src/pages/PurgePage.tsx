import { useState } from 'react';
import type { PurgeApplyResponse, PurgePreviewResponse } from '../../../src/server/api-types';
import { ApiClientError, postJson, useApi } from '../api';
import { Link } from '../router';
import { fmtKst, fmtNum } from '../lib/format';
import { Empty, ErrorBox, Loading } from '../components/States';
import { VehicleTable } from '../components/VehicleTable';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function PurgePage() {
  const { data, error, loading, reload } = useApi<PurgePreviewResponse>('/api/purge/preview');
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<ApiClientError | null>(null);
  const [done, setDone] = useState<PurgeApplyResponse | null>(null);

  const apply = async (): Promise<void> => {
    setBusy(true);
    setApplyError(null);
    try {
      const r = await postJson<PurgeApplyResponse>('/api/purge', { confirmCount: Number(typed) });
      setDone(r);
      setOpen(false);
      reload();
    } catch (err) {
      setApplyError(err instanceof ApiClientError ? err : new ApiClientError(0, 'UNKNOWN', String(err)));
      if (err instanceof ApiClientError && err.code === 'PURGE_CHANGED') reload();
    } finally {
      setBusy(false);
    }
  };

  const header = <h1 className="page-title">정리 — 미확인 매물 삭제</h1>;
  const doneBox = done && (
    <div className="notice notice-info" role="status">
      <p className="notice-title">{fmtNum(done.deleted)}대 삭제 완료{done.kept > 0 ? ` (${fmtNum(done.kept)}대는 그사이 다시 확인되어 유지)` : ''}</p>
      <ul className="notice-list">
        <li>재채점: {fmtNum(done.rescored.total)}대 중 {fmtNum(done.rescored.changed)}대 변경</li>
        <li>삭제 전 백업: <code>{done.backupPath}</code> — 되돌리려면 이 파일을 data/used-car.db 로 복사하세요 (다음 삭제 때 덮어씀)</li>
      </ul>
    </div>
  );
  if (error) return <div className="stack">{header}{doneBox}<ErrorBox error={error} onRetry={reload} /></div>;
  if (!data) return loading ? <Loading /> : null;
  if (data.cutoff === null) {
    return <div className="stack">{header}<Empty title="미확인 기준이 꺼져 있습니다 (STALE_DAYS=0)"><p><Link to="/settings">설정</Link>에서 미확인 기준 일수를 정하면 삭제 대상을 볼 수 있습니다.</p></Empty></div>;
  }
  const n = data.candidateCount;
  return (
    <div className="stack">
      {header}
      {doneBox}
      <div className="notice notice-info">
        <p>엔카 목록에서 <b>{data.staleDays}일</b> 이상 확인되지 않은 매물(마지막 확인이 {fmtKst(data.cutoff)} 이전)입니다. 판매 완료·광고 종료 또는 렌트/리스/중복매물로 바뀐 매물, 혹은 그 검색 조건을 {data.staleDays}일 넘게 다시 수집하지 않은 매물입니다. 이 매물들은 이미 비교·시세·가격 점수 기준에서 제외되어 있습니다.</p>
      </div>
      {n === 0 ? (
        <Empty title="미확인 매물이 없습니다"><p className="muted">전체 {fmtNum(data.totalCount)}대 모두 최근 목록에서 확인되었습니다.</p></Empty>
      ) : (
        <>
          <div className="grid-4">
            <div className="card"><div className="stat-label">전체 매물</div><div className="stat-value">{fmtNum(data.totalCount)}대</div></div>
            <div className="card"><div className="stat-label">삭제 대상 (미확인)</div><div className="stat-value">{fmtNum(n)}대</div><div className="stat-sub">전체의 {data.pct}%</div></div>
            <div className="card"><div className="stat-label">안전 상한</div><div className="stat-value">{Math.round(data.maxRatio * 100)}%</div><div className="stat-sub">넘으면 삭제하지 않음</div></div>
            <div className="card"><div className="stat-label">삭제 전 백업</div><div className="stat-value small" style={{ wordBreak: 'break-all' }}>{data.backupPath.split('/').pop()}</div><div className="stat-sub">이전 백업을 덮어씀</div></div>
          </div>
          {data.overCap && (
            <div className="notice notice-warn" role="alert">
              <p className="notice-title">대상이 전체의 {data.pct}%로 안전 기준({Math.round(data.maxRatio * 100)}%)을 넘어 삭제할 수 없습니다</p>
              <p>계속 볼 검색 조건을 먼저 <Link to="/collect">수집 화면</Link>에서 다시 수집하세요.</p>
            </div>
          )}
          {data.jobRunning && <div className="notice notice-warn"><p>수집 작업이 실행 중입니다. 끝난 뒤 삭제할 수 있습니다.</p></div>}
          <section className="card">
            <h2 className="card-title">모델별 (미확인 / DB 전체)</h2>
            <div className="table-wrap"><table className="table compact">
              <thead><tr><th>모델</th><th className="num">미확인</th><th className="num">전체</th><th>마지막 확인</th><th>비고</th></tr></thead>
              <tbody>{data.breakdown.map((b) => (
                <tr key={b.label}>
                  <td>{b.label}</td><td className="num">{fmtNum(b.stale)}</td><td className="num">{fmtNum(b.total)}</td><td className="num-plain">~{fmtKst(b.lastSeenMax)}</td>
                  <td className="small">{b.stale === b.total ? '모델 전체가 미확인 — 판매보다는 최근 재수집하지 않았을 가능성이 큽니다. 계속 볼 모델이면 다시 수집하세요' : ''}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
          <section className="card">
            <h2 className="card-title">삭제 대상 {fmtNum(n)}대 (마지막 확인 오래된 순)</h2>
            <VehicleTable items={data.candidates} />
          </section>
          <div className="form-actions">
            <button type="button" className="btn btn-danger" disabled={data.overCap || data.jobRunning} onClick={() => { setTyped(''); setApplyError(null); setOpen(true); }}>{fmtNum(n)}대 삭제…</button>
            <button type="button" className="btn" onClick={reload}>다시 불러오기</button>
          </div>
        </>
      )}
      <ConfirmDialog open={open} title={`미확인 매물 ${fmtNum(n)}대를 삭제합니다`} onClose={() => setOpen(false)}>
        <form onSubmit={(e) => { e.preventDefault(); if (typed.trim() === String(n)) void apply(); }}>
          <p>되돌릴 수 없습니다. 삭제 직전 DB를 <code>{data.backupPath}</code> 로 백업합니다(이전 백업을 덮어씀). 삭제 후 DB 전체를 다시 채점합니다.</p>
          <label className="field">
            <span className="field-label">확인을 위해 삭제할 대수 <b>{n}</b> 을(를) 입력하세요</span>
            <input className="input" inputMode="numeric" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} aria-describedby="purge-confirm-hint" />
            <span id="purge-confirm-hint" className="field-hint">숫자가 일치해야 삭제 버튼이 켜집니다</span>
          </label>
          {applyError && <div style={{ marginTop: 12 }}><ErrorBox error={applyError} /></div>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>취소</button>
            <button type="submit" className="btn btn-danger" disabled={busy || typed.trim() !== String(n)}>{busy ? '삭제 중…' : '삭제'}</button>
          </div>
        </form>
      </ConfirmDialog>
    </div>
  );
}
