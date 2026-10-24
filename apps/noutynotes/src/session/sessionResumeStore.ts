import { parseResumeIntent } from './sessionResume';
import type { ResumeIntent } from './sessionResume';

const KEY = 'noutynotes.session-resume.v1';

export function readResumeIntent(): ResumeIntent | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const parsed = parseResumeIntent(sessionStorage.getItem(KEY));
    if (!parsed) sessionStorage.removeItem(KEY);
    return parsed;
  } catch { return null; }
}

export function writeResumeIntent(intent: ResumeIntent | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (intent) sessionStorage.setItem(KEY, JSON.stringify(intent));
    else sessionStorage.removeItem(KEY);
  } catch { /* No sustituir sessionStorage por una selección global ni perder la sesión actual. */ }
}

export function isReload(): boolean {
  return typeof performance !== 'undefined'
    && (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload';
}
