// 최소 라우터 (History API). 화면 4개뿐이라 라이브러리 없이 구현
import { useMemo, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

const NAV_EVENT = 'used-car:navigate';

function subscribe(cb: () => void): () => void {
  window.addEventListener('popstate', cb);
  window.addEventListener(NAV_EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(NAV_EVENT, cb);
  };
}
function currentKey(): string { return window.location.pathname + window.location.search; }

export function useLocation(): { pathname: string; query: URLSearchParams } {
  const key = useSyncExternalStore(subscribe, currentKey);
  return useMemo(() => {
    const u = new URL(key, window.location.origin);
    return { pathname: u.pathname, query: u.searchParams };
  }, [key]);
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === currentKey()) return;
  if (opts.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAV_EVENT));
  if (!opts.replace) window.scrollTo(0, 0);
}

/** 값이 비어 있는(undefined/null/'') 항목은 뺀 쿼리스트링 ("?a=1" 또는 "") */
export function buildQuery(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && String(v) !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

type LinkProps = { to: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>;
export function Link({ to, children, onClick, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a {...rest} href={to} onClick={handle}>{children}</a>;
}

export type Route =
  | { name: 'dashboard' }
  | { name: 'vehicles' }
  | { name: 'vehicle'; carId: string }
  | { name: 'compare' }
  | { name: 'notFound' };

export function matchRoute(pathname: string): Route {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return { name: 'dashboard' };
  if (p === '/vehicles') return { name: 'vehicles' };
  if (p === '/compare') return { name: 'compare' };
  const m = /^\/vehicles\/([^/]+)$/.exec(p);
  if (m) return { name: 'vehicle', carId: decodeURIComponent(m[1]) };
  return { name: 'notFound' };
}
