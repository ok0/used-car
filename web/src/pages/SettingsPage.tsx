import { useState } from 'react';
import type { ConfigEntry, ConfigKey, ConfigResponse, ConfigSaveResponse } from '../../../src/server/api-types';
import { ApiClientError, postJson, useApi } from '../api';
import { CONFIG_GROUP_LABEL, CONFIG_META, isFlagOn, type ConfigGroup } from '../lib/config-meta';
import { ErrorBox, Loading } from '../components/States';
import { Chip } from '../components/Badge';

type Draft = Partial<Record<ConfigKey, string>>; // 텍스트: 입력값('' = 기본값), 플래그: '1' 또는 ''

function initialDraft(entries: ConfigEntry[]): Draft {
  const d: Draft = {};
  for (const e of entries) d[e.key] = e.kind === 'flag' ? (isFlagOn(e.fileValue) ? '1' : '') : (e.fileValue ?? '');
  return d;
}

export function SettingsPage() {
  const { data, error, loading, reload } = useApi<ConfigResponse>('/api/config');
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return loading ? <Loading /> : null;
  return <SettingsForm key={data.revision} initial={data} onReload={reload} />;
}

function SettingsForm({ initial, onReload }: { initial: ConfigResponse; onReload: () => void }) {
  const [cfg, setCfg] = useState<ConfigResponse>(initial);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(initial.entries));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [saved, setSaved] = useState<ConfigSaveResponse | null>(null);
  const base = initialDraft(cfg.entries);
  const dirty = (Object.keys(draft) as ConfigKey[]).filter((k) => (draft[k] ?? '') !== (base[k] ?? ''));

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const values: Partial<Record<ConfigKey, string | null>> = {};
      for (const k of dirty) values[k] = draft[k] === '' ? null : draft[k]!.trim();
      const r = await postJson<ConfigSaveResponse>('/api/config', { revision: cfg.revision, values });
      setCfg(r);
      setDraft(initialDraft(r.entries));
      setSaved(r);
    } catch (err) {
      setError(err instanceof ApiClientError ? err : new ApiClientError(0, 'UNKNOWN', String(err)));
    } finally {
      setBusy(false);
    }
  };

  const groups = (Object.keys(CONFIG_GROUP_LABEL) as ConfigGroup[]).map((g) => ({ g, entries: cfg.entries.filter((e) => CONFIG_META[e.key].group === g) }));
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h1 className="page-title">설정</h1>
      <div className="notice notice-info">
        <p>설정 파일: <code>{cfg.envPath}</code>{cfg.exists ? '' : ' (아직 없음 — 저장하면 .env.example 을 바탕으로 만듭니다)'}. 저장하면 주석과 다른 줄은 그대로 두고 바꾼 항목만 고칩니다. 비우면 기본값을 씁니다.</p>
        <p className="small muted">DB: <code>{cfg.dbPath}</code></p>
      </div>
      {cfg.jobRunning && <div className="notice notice-warn"><p>수집·정리 작업이 실행 중입니다. 끝난 뒤 저장할 수 있습니다.</p></div>}
      {saved && (
        <div className="notice notice-info" role="status">
          <p className="notice-title">{saved.changed.length === 0 ? '바뀐 내용이 없습니다' : '저장했습니다'}</p>
          <ul className="notice-list">
            {saved.applied.length > 0 && <li>바로 적용: {saved.applied.map((k) => CONFIG_META[k].label).join(', ')}</li>}
            {saved.restartRequired.length > 0 && <li>서버를 다시 시작해야 적용: {saved.restartRequired.map((k) => CONFIG_META[k].label).join(', ')}</li>}
            {saved.shellOverridden.length > 0 && <li>실행 환경변수가 우선이라 지금은 적용되지 않음: {saved.shellOverridden.map((k) => CONFIG_META[k].label).join(', ')}</li>}
          </ul>
        </div>
      )}
      {error && <ErrorBox error={error} onRetry={error.code === 'ENV_CHANGED' ? onReload : undefined} />}
      {groups.map(({ g, entries }) => (
        <section className="card" key={g}>
          <h2 className="card-title">{CONFIG_GROUP_LABEL[g]}</h2>
          {entries.map((e) => {
            const m = CONFIG_META[e.key];
            const id = `cfg-${e.key}`;
            const v = draft[e.key] ?? '';
            return (
              <div className="setting-row" key={e.key}>
                <div>
                  <label htmlFor={id} style={{ fontWeight: 600 }}>{m.label}</label>
                  <div className="small muted"><code>{e.key}</code></div>
                </div>
                <div>
                  {e.kind === 'flag'
                    ? <label className="check" style={{ marginTop: 0 }}><input id={id} type="checkbox" checked={v === '1'} onChange={(ev) => setDraft((d) => ({ ...d, [e.key]: ev.target.checked ? '1' : '' }))} /> 켜기</label>
                    : <input id={id} className="input" value={v} placeholder={`기본 ${e.defaultText}`} onChange={(ev) => setDraft((d) => ({ ...d, [e.key]: ev.target.value }))} aria-describedby={`${id}-help`} />}
                  <p id={`${id}-help`} className="field-hint" style={{ margin: '4px 0 0' }}>{m.help} (기본 {e.defaultText})</p>
                  <div className="setting-meta">
                    {e.restartRequired && <Chip tone="neutral">재시작 필요</Chip>}
                    {e.shellOverride && <Chip tone="warn">실행 환경변수가 우선</Chip>}
                    {(e.effectiveValue ?? '') !== (e.fileValue ?? '') && <span className="small muted">실행 중인 값: {e.effectiveValue ?? '(기본값)'}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      ))}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || dirty.length === 0 || cfg.jobRunning}>{busy ? '저장 중…' : `저장${dirty.length > 0 ? ` (${dirty.length}개 변경)` : ''}`}</button>
        <button type="button" className="btn" disabled={busy || dirty.length === 0} onClick={() => { setDraft(initialDraft(cfg.entries)); setError(null); }}>되돌리기</button>
      </div>
    </form>
  );
}
