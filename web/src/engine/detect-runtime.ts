import type { AnalysisEngine } from './types';

/**
 * Pages returns the SPA HTML for unknown paths, so status alone is not proof
 * that a local API exists. Require the local server's JSON health shape.
 */
export async function hasNodeApi(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher('/api/health', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(1_500) });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return false;
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null &&
      (body as { service?: unknown }).service === 'localcode-intelligence';
  } catch { return false; }
}

let selected: Promise<AnalysisEngine> | undefined;
export function getAnalysisEngine(): Promise<AnalysisEngine> {
  selected ??= hasNodeApi().then(async available => {
    if (available) return (await import('./node-engine')).nodeEngine;
    return (await import('./browser/browser-engine')).browserEngine;
  });
  return selected;
}

export function resetAnalysisEngineForTests(): void { selected = undefined; }
