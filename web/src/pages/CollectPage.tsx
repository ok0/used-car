import { useEffect, useState } from 'react';
import type {
  CollectJobRequest, CollectPreviewResponse, ConfigResponse, CurrentJobResponse, JobResponse, JobSnapshot,
} from '../../../src/server/api-types';
import { ApiClientError, postJson, useApi } from '../api';
import { Link } from '../router';
import { GRADES } from '../lib/labels';
import { fmtKst, fmtManwon, fmtNum } from '../lib/format';
import { isFlagOn } from '../lib/config-meta';
import {
  checkSearchUrl, collectFormToRequest, fmtElapsed, isFullList, loadCollectForm, progressValue, resumeRequest, saveCollectForm,
  PHASE_LABEL, STATE_LABEL, type CollectFormState,
} from '../lib/collect-form';
import { useJobStream } from '../lib/job-stream';
import { ErrorBox, Loading } from '../components/States';
import { GradeBadge } from '../components/Badge';
import { HBar } from '../components/Bar';
import { LogPanel } from '../components/LogPanel';

const toClientError = (err: unknown): ApiClientError => (err instanceof ApiClientError ? err : new ApiClientError(0, 'UNKNOWN', String(err)));

export function CollectPage() {
  const current = useApi<CurrentJobResponse>('/api/jobs/current');
  const config = useApi<ConfigResponse>('/api/config');
  if (current.error) return <ErrorBox error={current.error} onRetry={current.reload} />;
  if (config.error) return <ErrorBox error={config.error} onRetry={config.reload} />;
  if (!current.data || !config.data) return <Loading />;
  const flag = (k: 'ENCAR_FETCH_MARKET' | 'ENCAR_FETCH_YEARLY'): boolean => isFlagOn(config.data!.entries.find((e) => e.key === k)?.effectiveValue ?? null);
  return <CollectView initialJob={current.data.job} flags={{ fetchMarket: flag('ENCAR_FETCH_MARKET'), fetchYearly: flag('ENCAR_FETCH_YEARLY') }} />;
}

function CollectView({ initialJob, flags }: { initialJob: JobSnapshot | null; flags: { fetchMarket: boolean; fetchYearly: boolean } }) {
  const [form, setForm] = useState<CollectFormState>(() => loadCollectForm(flags));
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; data: CollectPreviewResponse } | null>(null);
  const [seed, setSeed] = useState<JobSnapshot | null>(initialJob); // 시작 응답 또는 화면을 열 때의 현재 작업
  const stream = useJobStream(seed?.state === 'running' ? seed.id : null, seed);
  const job = stream.job !== null && stream.job.id === seed?.id ? stream.job : seed;
  const running = job?.state === 'running';
  useEffect(() => saveCollectForm(form), [form]);

  const set = <K extends keyof CollectFormState>(k: K, v: CollectFormState[K]): void => setForm((f) => ({ ...f, [k]: v }));
  const urlCheck = checkSearchUrl(form.url);

  const start = async (body: CollectJobRequest): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<JobResponse>('/api/jobs/collect', body);
      setSeed(r.job);
    } catch (err) {
      setError(toClientError(err));
    } finally {
      setBusy(false);
    }
  };
  const submit = (): void => {
    const { body, errors } = collectFormToRequest(form);
    setFormErrors(errors);
    if (body !== null) void start(body);
  };
  const stop = async (): Promise<void> => {
    if (!job) return;
    try { await postJson<JobResponse>(`/api/jobs/${job.id}/stop`, {}); } catch (err) { setError(toClientError(err)); }
  };
  const checkCount = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<CollectPreviewResponse>('/api/collect/preview', { url: form.url.trim() });
      setPreview({ url: form.url.trim(), data });
    } catch (err) {
      setError(toClientError(err));
    } finally {
      setBusy(false);
    }
  };

  const lastBlocked = job !== null && !running && job.state === 'blocked';
  return (
    <div className="stack">
      <h1 className="page-title">수집</h1>
      {lastBlocked && (
        <div className="notice notice-warn"><p>마지막 수집이 엔카 차단으로 끝났습니다 ({fmtKst(job.finishedAt)}). 곧바로 다시 시도하면 차단이 길어질 수 있습니다 — 네트워크(IP)를 바꾸거나 잠시 뒤에 시작하세요.</p></div>
      )}
      <form className="card" onSubmit={(e) => { e.preventDefault(); submit(); }} aria-busy={busy}>
        <h2 className="card-title">엔카 검색 조건</h2>
        <fieldset className="stack" disabled={running} style={{ border: 0, margin: 0, padding: 0 }}>
          <label className="field">
            <span className="field-label">엔카 검색 결과 페이지 URL <span className="req">*</span></span>
            <input className="input" type="url" value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://car.encar.com/list/car?search=..." aria-invalid={urlCheck.error !== null} aria-describedby="url-hint" />
            <span id="url-hint" className={`field-hint${urlCheck.error ? ' is-error' : ''}`}>
              {urlCheck.error ?? (urlCheck.searchQuery ? `검색 조건: ${urlCheck.searchQuery}` : '엔카에서 모델을 검색한 뒤 주소창의 URL을 붙여 넣으세요')}
            </span>
          </label>
          <div className="form-actions">
            <button type="button" className="btn" disabled={busy || urlCheck.searchQuery === null} onClick={() => void checkCount()}>검색 결과 수 확인</button>
            <span className="muted small">엔카에 1회 요청합니다</span>
            {preview && preview.url === form.url.trim() && (
              <span>검색 결과 {preview.data.totalCount === null ? '?' : `${fmtNum(preview.data.totalCount)}대`} ({preview.data.pages ?? '?'}페이지, 렌트·리스·중복매물 제외 전)</span>
            )}
          </div>
          <div className="form-grid">
            <label className="field"><span className="field-label">시작 페이지</span><input className="input" inputMode="numeric" value={form.startPage} onChange={(e) => set('startPage', e.target.value)} /><span className="field-hint">페이지당 20대</span></label>
            <label className="field"><span className="field-label">최대 페이지 수</span><input className="input" inputMode="numeric" value={form.maxPages} onChange={(e) => set('maxPages', e.target.value)} placeholder="끝까지" /></label>
            <label className="field"><span className="field-label">최대 대수 (상세 수집)</span><input className="input" inputMode="numeric" value={form.limit} onChange={(e) => set('limit', e.target.value)} placeholder="전부" /><span className="field-hint">처음에는 3대 정도로 시험해 보세요</span></label>
          </div>
          <div>
            <label className="check"><input type="checkbox" checked={form.skipExisting} onChange={(e) => set('skipExisting', e.target.checked)} /> DB에 이미 있는 매물은 건너뛰기 (중단된 수집 이어받기)</label>
            <label className="check"><input type="checkbox" checked={form.prune} disabled={!isFullList(form)} onChange={(e) => set('prune', e.target.checked)} /> 이번 목록에 없는 기존 매물 삭제 (같은 검색 조건으로 수집된 것만, 삭제 전 목록 재확인·자동 백업)</label>
            {!isFullList(form) && <p className="field-hint">삭제는 시작 페이지 1, 최대 페이지·대수를 비운 전체 수집에서만 쓸 수 있습니다.</p>}
          </div>
          <details className="disclosure">
            <summary>엔카 시세 API (이번 실행에만 적용 · 기본값은 <Link to="/settings">설정</Link>)</summary>
            <label className="check"><input type="checkbox" checked={form.fetchMarket} onChange={(e) => set('fetchMarket', e.target.checked)} /> 동급매물 시세도 조회 (요청 증가)</label>
            <label className="check"><input type="checkbox" checked={form.fetchYearly} onChange={(e) => set('fetchYearly', e.target.checked)} /> 연식별 시세도 조회 (요청 증가)</label>
          </details>
          {formErrors.length > 0 && <div className="notice notice-error" role="alert"><ul className="notice-list">{formErrors.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
          <div className="form-actions"><button type="submit" className="btn btn-primary" disabled={busy || running}>수집 시작</button></div>
        </fieldset>
      </form>
      {error && <ErrorBox error={error} />}
      {job && <JobStatus job={job} connection={stream.connection} onStop={() => void stop()} onResume={() => void start(resumeRequest(job.params))} busy={busy} />}
      {job && <LogPanel lines={job.log} dropped={job.logDropped} />}
    </div>
  );
}

function JobStatus({ job, connection, onStop, onResume, busy }: { job: JobSnapshot; connection: string; onStop: () => void; onResume: () => void; busy: boolean }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const running = job.state === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const p = job.progress;
  const pv = progressValue(p, job.params.startPage);
  const endMs = job.finishedAt ? Date.parse(job.finishedAt) : nowMs;
  const r = job.result;
  const canResume = !running && (job.state === 'interrupted' || job.state === 'blocked') && (r === null || r.pending > 0 || job.state === 'blocked');
  return (
    <section className="card stack" aria-live="polite">
      <div className="status-line">
        <h2 className="card-title" style={{ margin: 0 }}>{running ? PHASE_LABEL[p.phase] : `수집 ${STATE_LABEL[job.state]}`}</h2>
        <span className="muted">경과 {fmtElapsed(endMs - Date.parse(job.startedAt))}</span>
        {running && connection !== 'open' && <span className="text-warn small">{connection === 'lost' ? '서버 연결 끊김 — 새로고침하세요' : '다시 연결 중…'}</span>}
        {running && <button type="button" className="btn" style={{ marginLeft: 'auto' }} disabled={job.stopRequested} onClick={onStop}>{job.stopRequested ? '중단 요청됨' : '중단'}</button>}
      </div>
      {running && (
        <div className="progress-wrap">
          <progress className="progress" aria-label="진행률" {...(pv ? { value: pv[0], max: pv[1] } : {})} />
          <span className="num-plain">{p.phase === 'list' ? (p.listPage === null ? '첫 페이지 요청 중' : `${p.listPage}${p.listLastPage ? `/${p.listLastPage}` : ''}페이지 · ${fmtNum(p.listed ?? 0)}대`) : pv ? `${fmtNum(pv[0])}/${fmtNum(pv[1])}` : ''}</span>
        </div>
      )}
      {running && job.stopRequested && <p className="muted">진행 중인 매물까지 저장하고 재채점한 뒤 멈춥니다.</p>}
      <div className="grid-4">
        <Stat label="목록 유효 매물" value={p.listed === null ? '-' : `${fmtNum(p.listed)}대`} sub={p.skippedExisting > 0 ? `기존 제외 ${fmtNum(p.skippedExisting)}대` : undefined} />
        <Stat label="상세 수집 대상" value={p.targeted === null ? '-' : `${fmtNum(p.targeted)}대`} />
        <Stat label="성공 / 실패" value={`${fmtNum(p.saved)} / ${fmtNum(p.failed)}`} />
        <Stat label="남은 대수" value={p.targeted === null ? '-' : `${fmtNum(Math.max(0, p.targeted - p.completed))}대`} />
      </div>
      {!running && <ResultView job={job} />}
      {canResume && (
        <div className="form-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onResume}>{r === null ? '다시 시도' : '이어서 수집 (DB에 있는 매물 건너뛰기)'}</button>
          {job.state === 'blocked' && <span className="muted small">네트워크(IP)를 바꾸거나 잠시 뒤에 누르세요</span>}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div><div className="stat-label">{label}</div><div className="stat-value small">{value}</div>{sub && <div className="stat-sub">{sub}</div>}</div>;
}

function ResultView({ job }: { job: JobSnapshot }) {
  const r = job.result;
  if (job.state === 'failed') return <div className="notice notice-error" role="alert"><p className="notice-title">수집 실패</p><p>{job.error}</p></div>;
  if (r === null) {
    return <div className="notice notice-error" role="alert"><p className="notice-title">엔카가 요청을 차단했습니다</p><p>{job.error} 저장된 매물은 없습니다. 네트워크(IP)를 바꾸거나 잠시 후 다시 시도하세요.</p></div>;
  }
  const head = r.status === 'completed'
    ? (r.targeted === 0 ? `상세 수집 대상이 없습니다 (검색 결과 ${fmtNum(r.listed)}대, 기존 제외 ${fmtNum(r.skippedExisting)}대)` : `수집 완료: ${fmtNum(r.saved)}/${fmtNum(r.targeted)}대 성공, ${fmtNum(r.failed.length)}대 실패`)
    : r.status === 'blocked'
      ? `엔카 API 차단으로 중단: ${fmtNum(r.saved)}/${fmtNum(r.targeted)}대 저장, ${fmtNum(r.failed.length)}대 실패, ${fmtNum(r.pending)}대 미처리`
      : `사용자 요청으로 중단: ${fmtNum(r.saved)}/${fmtNum(r.targeted)}대 저장, ${fmtNum(r.failed.length)}대 실패, ${fmtNum(r.pending)}대 미처리`;
  const kind = r.status === 'completed' ? 'info' : r.status === 'blocked' ? 'error' : 'warn';
  const gradeMax = Math.max(1, ...GRADES.map((g) => r.gradeDistribution[g]));
  const pr = r.prune;
  return (
    <div className="stack">
      <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : undefined}>
        <p className="notice-title">{head}</p>
        <ul className="notice-list">
          {r.status === 'blocked' && <li>지금까지 수집한 {fmtNum(r.saved)}대는 저장·재채점되었습니다. 네트워크(IP)를 바꾸거나 잠시 후 이어서 수집하세요.</li>}
          {r.rescored && <li>재채점: DB 전체 {fmtNum(r.rescored.total)}대 중 {fmtNum(r.rescored.changed)}대 점수 변경</li>}
          {r.seenUpdated > 0 && <li>목록 확인: DB에 있던 {fmtNum(r.seenUpdated)}대의 마지막 확인 시각 갱신</li>}
          {pr && pr.skippedReason !== null && <li>정리 건너뜀: {pr.skippedReason}</li>}
          {pr && pr.skippedReason === null && pr.mode === 'report' && pr.candidates > 0 && <li>이번 목록에 없던 기존 매물 {fmtNum(pr.candidates)}대는 DB에 남아 있습니다 (삭제하려면 "목록에 없는 기존 매물 삭제"를 켜고 다시 수집)</li>}
          {pr && pr.skippedReason === null && pr.mode === 'prune' && <li>정리: {pr.candidates === 0 ? '이번 목록에 없던 기존 매물 없음' : `${fmtNum(pr.deleted)}대 삭제${pr.recheckFound > 0 ? `, 재확인에서 다시 보인 ${fmtNum(pr.recheckFound)}대 유지` : ''}${pr.backupPath ? ` (삭제 전 백업: ${pr.backupPath})` : ''}`}</li>}
          {r.stale && r.stale.count > 0 && <li>{r.stale.days}일 이상 엔카 목록에서 확인되지 않은 매물 {fmtNum(r.stale.count)}대 — <Link to="/purge">정리 화면</Link>에서 확인·삭제</li>}
        </ul>
      </div>
      {r.saved > 0 && (
        <div className="grid-2">
          <div>
            <h3 className="card-subtitle">이번에 저장한 매물 등급 (재채점 후)</h3>
            <table className="table compact"><tbody>
              {GRADES.map((g) => <tr key={g}><td style={{ width: 48 }}><GradeBadge grade={g} /></td><td><HBar value={r.gradeDistribution[g]} max={gradeMax} text={`${fmtNum(r.gradeDistribution[g])}대`} /></td></tr>)}
            </tbody></table>
          </div>
          <div>
            <h3 className="card-subtitle">평균</h3>
            <p>점수 {r.avgScore === null ? '-' : `${r.avgScore.toFixed(1)}점`} · 가격 {fmtManwon(r.avgPrice)}</p>
            <p><Link to="/vehicles">매물 목록 보기</Link></p>
          </div>
        </div>
      )}
      {r.failed.length > 0 && (
        <details className="disclosure">
          <summary>실패 목록 ({fmtNum(r.failed.length)}대)</summary>
          <div className="table-wrap"><table className="table compact">
            <thead><tr><th>매물 ID</th><th>오류</th></tr></thead>
            <tbody>{r.failed.map((f) => <tr key={f.carId}><td className="num-plain">{f.carId}</td><td>{f.error}</td></tr>)}</tbody>
          </table></div>
        </details>
      )}
    </div>
  );
}
