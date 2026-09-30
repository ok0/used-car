import { useEffect, useState } from 'react';
import type { CompareResponse, SettingsResponse } from '../../../src/server/api-types';
import { ApiClientError, postJson, useApi } from '../api';
import { formToRequest, loadForm, saveForm, type CompareFormState } from '../lib/compare-form';
import { ErrorBox } from '../components/States';
import { CompareForm } from './compare/CompareForm';
import { CompareResultView } from './compare/CompareResultView';

// 상세 화면에 갔다가 돌아와도 결과가 남도록 메모리에 보관 (새로고침하면 사라짐, 입력값은 localStorage)
let lastResult: CompareResponse | null = null;

export function ComparePage() {
  const settings = useApi<SettingsResponse>('/api/settings');
  const [form, setForm] = useState<CompareFormState>(loadForm);
  const [result, setResult] = useState<CompareResponse | null>(lastResult);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => saveForm(form), [form]);

  const submit = async (): Promise<void> => {
    const { body, errors } = formToRequest(form);
    setFormErrors(errors);
    if (body === null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<CompareResponse>('/api/compare', body);
      lastResult = r;
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiClientError ? err : new ApiClientError(0, 'UNKNOWN', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <h1 className="page-title">가격 비교</h1>
      <CompareForm form={form} onChange={setForm} onSubmit={() => void submit()} busy={busy}
        defaults={settings.data?.compare ?? null} formErrors={formErrors} />
      {error && <ErrorBox error={error} />}
      {result && !error && <CompareResultView r={result} />}
    </div>
  );
}
