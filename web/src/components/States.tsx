import type { ReactNode } from 'react';
import type { ApiClientError } from '../api';

export function Loading({ text = '불러오는 중…' }: { text?: string }) {
  return <p className="state state-loading" role="status">{text}</p>;
}

export function ErrorBox({ error, onRetry }: { error: ApiClientError; onRetry?: () => void }) {
  return (
    <div className="notice notice-error" role="alert">
      <p className="notice-title">{error.message}</p>
      {error.details.length > 0 && <ul className="notice-list">{error.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
      {onRetry && <button type="button" className="btn" onClick={onRetry}>다시 시도</button>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state state-empty">
      <p className="state-title">{title}</p>
      {children}
    </div>
  );
}

export function Notice({ kind, title, items }: { kind: 'warn' | 'info'; title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className={`notice notice-${kind}`}>
      <p className="notice-title">{kind === 'warn' ? '! ' : 'i '}{title}</p>
      <ul className="notice-list">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}
