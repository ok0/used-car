// 수집 작업 진행 스트림 (EventSource). 연결(재연결 포함)마다 서버가 snapshot 을 먼저 보내므로 상태를 통째로 교체한다
import { useEffect, useState } from 'react';
import { MAX_JOB_LOG_LINES, type CollectProgress, type JobSnapshot, type JobState } from '../../../src/server/api-types';

export interface JobStreamState { job: JobSnapshot | null; connection: 'connecting' | 'open' | 'closed' | 'lost' }

/** from(첫 줄의 전체 순번) 기준으로 이미 받은 줄은 건너뛰고 붙인다 (스냅샷과 겹치는 줄 제거) */
export function appendLog(job: JobSnapshot, from: number, lines: string[], max: number = MAX_JOB_LOG_LINES): JobSnapshot {
  const skip = job.logDropped + job.log.length - from;
  if (skip >= lines.length) return job;
  const log = job.log.concat(skip > 0 ? lines.slice(skip) : lines);
  const drop = Math.max(0, log.length - max);
  return { ...job, log: drop > 0 ? log.slice(drop) : log, logDropped: job.logDropped + drop };
}

export function useJobStream(jobId: string | null, initial: JobSnapshot | null): JobStreamState {
  const [state, setState] = useState<JobStreamState>({ job: initial, connection: jobId === null ? 'closed' : 'connecting' });
  useEffect(() => {
    if (jobId === null) return;
    setState((s) => ({ job: s.job?.id === jobId ? s.job : initial, connection: 'connecting' }));
    const es = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
    const upd = (f: (j: JobSnapshot) => JobSnapshot): void => setState((s) => (s.job === null ? s : { ...s, job: f(s.job) }));
    es.addEventListener('open', () => setState((s) => ({ ...s, connection: 'open' })));
    es.addEventListener('snapshot', (e) => setState({ job: JSON.parse((e as MessageEvent<string>).data) as JobSnapshot, connection: 'open' }));
    es.addEventListener('log', (e) => { const d = JSON.parse((e as MessageEvent<string>).data) as { from: number; lines: string[] }; upd((j) => appendLog(j, d.from, d.lines)); });
    es.addEventListener('progress', (e) => { const p = JSON.parse((e as MessageEvent<string>).data) as CollectProgress; upd((j) => ({ ...j, progress: p })); });
    es.addEventListener('state', (e) => { const d = JSON.parse((e as MessageEvent<string>).data) as { state: JobState; stopRequested: boolean }; upd((j) => ({ ...j, ...d })); });
    es.addEventListener('end', (e) => { es.close(); setState({ job: JSON.parse((e as MessageEvent<string>).data) as JobSnapshot, connection: 'closed' }); });
    es.addEventListener('error', () => {
      // CONNECTING: 브라우저가 자동 재연결 중. CLOSED: 서버가 작업을 모름(재시작) 또는 서버 없음
      setState((s) => ({ ...s, connection: es.readyState === EventSource.CLOSED ? 'lost' : 'connecting' }));
    });
    return () => es.close();
  }, [jobId]); // initial 은 jobId 가 바뀔 때만 의미가 있음
  return state;
}
