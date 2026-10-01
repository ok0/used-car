import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** 작업 로그. 맨 아래를 보고 있을 때만 자동으로 따라 내려간다 */
export function LogPanel({ lines, dropped }: { lines: string[]; dropped: number }) {
  const ref = useRef<HTMLPreElement>(null);
  const [follow, setFollow] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [lines, follow]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = (): void => setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <section className="card">
      <div className="log-head">
        <h2 className="card-title" style={{ margin: 0 }}>로그</h2>
        <span className="muted small">{dropped > 0 ? `앞부분 ${dropped.toLocaleString('en-US')}줄 생략 · ` : ''}{follow ? '자동 스크롤' : <button type="button" className="btn btn-ghost" onClick={() => setFollow(true)}>맨 아래로</button>}</span>
      </div>
      <pre ref={ref} className="log-panel" role="log" aria-label="작업 로그" tabIndex={0}>{lines.join('\n')}</pre>
    </section>
  );
}
