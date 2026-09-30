import { useEffect, useState } from 'react';
import type { VehicleListResponse } from '../../../src/server/api-types';
import type { VehicleSortField } from '../../../src/types';
import { useApi } from '../api';
import { buildQuery, navigate, useLocation } from '../router';
import { SORT_LABEL } from '../lib/labels';
import { fmtNum } from '../lib/format';
import { VehicleTable } from '../components/VehicleTable';
import { Empty, ErrorBox, Loading } from '../components/States';

type StaleFilter = 'all' | 'active' | 'stale';
const SORTS: VehicleSortField[] = ['score', 'price', 'mileage', 'year'];
const PAGE = 100;

export function VehicleListPage() {
  const { query } = useLocation();
  const model = query.get('model') ?? '';
  const minScore = query.get('minScore') ?? '';
  const sortQ = query.get('sort') ?? '';
  const sort: VehicleSortField = (SORTS as string[]).includes(sortQ) ? (sortQ as VehicleSortField) : 'score';
  const staleQ = query.get('stale') ?? '';
  const stale: StaleFilter = staleQ === 'active' || staleQ === 'stale' ? staleQ : 'all';

  const [modelInput, setModelInput] = useState(model);
  const [minScoreInput, setMinScoreInput] = useState(minScore);
  useEffect(() => setModelInput(model), [model]);
  useEffect(() => setMinScoreInput(minScore), [minScore]);

  const go = (next: { model?: string; minScore?: string; sort?: VehicleSortField; stale?: StaleFilter }, replace = true): void => {
    const m = next.model ?? model; const ms = next.minScore ?? minScore; const so = next.sort ?? sort; const st = next.stale ?? stale;
    navigate(`/vehicles${buildQuery({ model: m.trim(), minScore: ms.trim(), sort: so === 'score' ? '' : so, stale: st === 'all' ? '' : st })}`, { replace });
  };
  // 입력 300ms 멈추면 URL 반영 (URL이 곧 필터 상태)
  useEffect(() => {
    if (modelInput.trim() === model && minScoreInput.trim() === minScore) return;
    const t = setTimeout(() => go({ model: modelInput, minScore: minScoreInput }), 300);
    return () => clearTimeout(t);
  }, [modelInput, minScoreInput]); // 입력값 변화에만 반응 (go·model·minScore 는 의도적으로 제외)

  const apiPath = `/api/vehicles${buildQuery({ model, minScore, sort })}`;
  const { data, error, loading, reload } = useApi<VehicleListResponse>(apiPath);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [apiPath, stale]);

  const all = data?.items ?? [];
  const items = stale === 'all' ? all : all.filter((v) => (stale === 'stale' ? v.stale : !v.stale));
  const staleCount = all.filter((v) => v.stale).length;

  return (
    <div className="stack">
      <h1 className="page-title">매물 목록</h1>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); go({ model: modelInput, minScore: minScoreInput }); }}>
        <label className="field"><span className="field-label">모델/트림 키워드</span>
          <input className="input" value={modelInput} onChange={(e) => setModelInput(e.target.value)} placeholder="예: 싼타페 캘리그래피" /></label>
        <label className="field field-narrow"><span className="field-label">최소 점수</span>
          <input className="input" type="number" min={0} max={100} value={minScoreInput} onChange={(e) => setMinScoreInput(e.target.value)} /></label>
        <label className="field field-narrow"><span className="field-label">정렬</span>
          <select className="select" value={sort} onChange={(e) => go({ sort: e.target.value as VehicleSortField })}>
            {SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
          </select></label>
        <label className="field field-narrow"><span className="field-label">목록 확인</span>
          <select className="select" value={stale} onChange={(e) => go({ stale: e.target.value as StaleFilter })}>
            <option value="all">전체</option><option value="active">활성만</option><option value="stale">미확인만</option>
          </select></label>
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/vehicles', { replace: true })}>초기화</button>
      </form>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {!data && loading && <Loading />}
      {data && (
        <>
          <p className="muted">
            조건 일치 {fmtNum(items.length)}대{loading ? ' · 갱신 중…' : ''}
            {staleCount > 0 && ` · 미확인 ${fmtNum(staleCount)}대 (엔카 목록에서 ${data.staleDays}일 이상 확인되지 않음 — 비교·시세·가격 점수 기준에서 제외)`}
          </p>
          {items.length === 0
            ? <Empty title="조건에 맞는 매물이 없습니다" />
            : <VehicleTable items={items.slice(0, shown)} />}
          {items.length > shown && (
            <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE)}>
              더 보기 ({fmtNum(shown)} / {fmtNum(items.length)})
            </button>
          )}
        </>
      )}
    </div>
  );
}
