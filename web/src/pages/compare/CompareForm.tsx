import type { ReactNode } from 'react';
import type { CompareSettingsInfo } from '../../../../src/server/api-types';
import type { ComparePlatform } from '../../../../src/types';
import { EMPTY_FORM, settingsToForm, type CompareFormState } from '../../lib/compare-form';
import { PLATFORM_LABEL } from '../../lib/labels';

interface Props {
  form: CompareFormState;
  onChange: (f: CompareFormState) => void;
  onSubmit: () => void;
  busy: boolean;
  defaults: CompareSettingsInfo | null;
  formErrors: string[];
}

function Field({ label, required = false, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}{required && <span className="req" aria-label="필수"> *</span>}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function defaultsText(d: CompareSettingsInfo): string {
  const mil = d.mileagePercents === null ? '제한 없음' : d.mileagePercents.map((p) => `±${p}%`).join(' → ');
  return `연식 ±${d.yearRange}년 · 주행 ${mil} · 최소 ${d.minSamples}대 · 사양 보정 ±${d.specMaxAdjust}%`;
}

export function CompareForm({ form, onChange, onSubmit, busy, defaults, formErrors }: Props) {
  const set = <K extends keyof CompareFormState>(k: K, v: CompareFormState[K]): void => onChange({ ...form, [k]: v });
  const manual = form.mode === 'manual';
  const text = (k: keyof CompareFormState, placeholder = '', inputMode: 'text' | 'numeric' = 'text') => (
    <input className="input" value={form[k] as string} placeholder={placeholder} inputMode={inputMode} onChange={(e) => set(k, e.target.value as never)} />
  );
  const detailFields = (
    <div className="form-grid">
      <Field label="사고 건수 (내차피해)">{text('accidentCount', '0', 'numeric')}</Field>
      <Field label="사고 보험금 합계 (원)">{text('accidentAmount', '예: 1500000', 'numeric')}</Field>
      <Field label="소유주 변경 (회)">{text('ownerChanges', '0', 'numeric')}</Field>
      <Field label="렌트 이력">
        <select className="select" value={form.rental} onChange={(e) => set('rental', e.target.value as CompareFormState['rental'])}>
          <option value="">모름</option><option value="no">없음</option><option value="yes">있음</option>
        </select>
      </Field>
      <Field label="성능점검 요약" hint="예: 무사고, 교환 1 판금 1">{text('inspection')}</Field>
    </div>
  );
  const baseFields = (required: boolean) => (
    <div className="form-grid">
      <Field label="모델" required={required} hint='엔카 표기 권장 (예: "더 뉴 싼타페")'>{text('model')}</Field>
      <Field label="트림">{text('trim', '예: 가솔린 2.5T 2WD 프리미엄')}</Field>
      <Field label="연식" required={required} hint="2자리 또는 4자리">{text('year', '21', 'numeric')}</Field>
      <Field label="월">{text('month', '1~12', 'numeric')}</Field>
      <Field label="주행거리 (km)" required={required}>{text('mileage', '60000', 'numeric')}</Field>
      <Field label="가격 (만원)" required={required}>{text('price', '2400', 'numeric')}</Field>
    </div>
  );
  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <div className="seg" role="tablist" aria-label="입력 방식">
        <button type="button" role="tab" aria-selected={!manual} className={`seg-btn${!manual ? ' is-active' : ''}`} onClick={() => set('mode', 'url')}>URL로 비교</button>
        <button type="button" role="tab" aria-selected={manual} className={`seg-btn${manual ? ' is-active' : ''}`} onClick={() => set('mode', 'manual')}>직접 입력</button>
      </div>
      {!manual ? (
        <>
          <Field label="상세 페이지 URL" required hint="헤이딜러 https://www.heydealer.com/market/cars/… 또는 현대 인증중고차 https://certified.hyundai.com/p/goods/goodsDetail.do?goodsNo=…">
            <input className="input" type="url" value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://" />
          </Field>
          <details className="disclosure">
            <summary>파싱한 값 덮어쓰기 (선택)</summary>
            {baseFields(false)}
            {detailFields}
          </details>
        </>
      ) : (
        <>
          <Field label="플랫폼" required>
            <select className="select" value={form.platform} onChange={(e) => set('platform', e.target.value as ComparePlatform | '')}>
              <option value="">선택</option>
              {(Object.keys(PLATFORM_LABEL) as ComparePlatform[]).map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
            </select>
          </Field>
          {baseFields(true)}
          {detailFields}
        </>
      )}
      <details className="disclosure">
        <summary>동급 조건{defaults ? ` — 기본: ${defaultsText(defaults)}` : ''}</summary>
        <label className="check">
          <input type="checkbox" checked={form.useCustomSettings}
            onChange={(e) => onChange({ ...form, useCustomSettings: e.target.checked, ...(e.target.checked && defaults && form.yearRange === '' ? settingsToForm(defaults) : {}) })} />
          이번 비교에 직접 지정
        </label>
        <fieldset className="form-grid" disabled={!form.useCustomSettings}>
          <Field label="연식 범위 (±년)" hint="0~10">{text('yearRange', '', 'numeric')}</Field>
          <Field label="주행거리 범위 (±%)" hint='예: 40,60 (모자라면 다음 단계로 넓힘) 또는 "없음"'>{text('mileagePercents')}</Field>
          <Field label="최소 표본 (대)" hint="1~100">{text('minSamples', '', 'numeric')}</Field>
          <Field label="사양 보정 상한 (±%)" hint="0이면 끔, 0~30">{text('specMaxAdjust', '', 'numeric')}</Field>
          <Field label="유사 매물 수 (대)" hint="유사 매물 평가의 이웃 수, 5~200">{text('knnN', '', 'numeric')}</Field>
        </fieldset>
        {defaults && <button type="button" className="btn btn-ghost" onClick={() => onChange({ ...form, ...settingsToForm(defaults) })}>기본값으로</button>}
      </details>
      {formErrors.length > 0 && <ul className="notice notice-error notice-list" role="alert">{formErrors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? '비교 중…' : '비교하기'}</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onChange({ ...EMPTY_FORM, mode: form.mode })}>입력 지우기</button>
        {!manual && <span className="muted small">URL 비교는 해당 사이트에 1회 요청합니다 (같은 URL은 10분간 다시 요청하지 않음)</span>}
      </div>
    </form>
  );
}
