import { useState } from 'react';

type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'used-car:theme';
const NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ThemePref, string> = { system: '테마: 시스템', light: '테마: 라이트', dark: '테마: 다크' };

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function applyPref(p: ThemePref): void {
  const el = document.documentElement;
  if (p === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', p);
  try {
    if (p === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch { /* 무시 */ }
}

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(readPref);
  return (
    <button type="button" className="btn btn-ghost" title="클릭하면 시스템 → 라이트 → 다크 순으로 바뀝니다"
      onClick={() => { const n = NEXT[pref]; applyPref(n); setPref(n); }}>
      {LABEL[pref]}
    </button>
  );
}
