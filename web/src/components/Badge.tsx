import type { CompareVerdict, Grade } from '../../../src/types';
import { TONE_META, VERDICT_META, type Tone } from '../lib/labels';

export function ToneBadge({ tone, label }: { tone: Tone; label?: string }) {
  const m = TONE_META[tone];
  return <span className={`badge tone-${tone}`}><span aria-hidden="true">{m.glyph}</span> {label ?? m.label}</span>;
}

export function VerdictBadge({ verdict, large = false }: { verdict: CompareVerdict; large?: boolean }) {
  const m = VERDICT_META[verdict];
  return <span className={`verdict-badge ${m.cls}${large ? ' is-large' : ''}`}><span aria-hidden="true">{m.glyph}</span> {m.label}</span>;
}

export function GradeBadge({ grade }: { grade: Grade | null }) {
  return <span className={`grade grade-${grade === null ? 'none' : grade === 'A+' ? 'Ap' : grade}`}>{grade ?? '-'}</span>;
}

export function Chip({ children, tone }: { children: string; tone?: Tone }) {
  return <span className={`chip${tone ? ` tone-${tone}` : ''}`}>{children}</span>;
}
