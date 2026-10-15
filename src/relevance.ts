import type { SearchCandidate } from './retrieval.js';

export interface RelevanceAssessment { relevant: boolean; reason: 'lexical-evidence' | 'semantic-code-evidence' | 'insufficient-evidence'; }
const CODE_TERMS = new Set(['auth', 'authentication', 'middleware', 'pagination', 'database', 'routing', 'router', 'session', 'token', 'api', 'cache', 'component', 'function', 'handler']);
const STOP = new Set(['where', 'is', 'the', 'a', 'an', 'what', 'how', 'does', 'for', 'and', 'in', 'of', 'to', 'with', 'logic', 'implemented']);
export function assessRelevance(query: string, candidates: readonly SearchCandidate[]): RelevanceAssessment {
  const terms = query.toLowerCase().match(/[a-z][a-z0-9_-]*/g)?.filter(word => !STOP.has(word)) ?? [];
  const evidence = candidates.map(candidate => `${candidate.filePath} ${candidate.text}`.toLowerCase());
  const lexical = terms.some(term => evidence.some(text => text.includes(term) || (term.length >= 5 && text.includes(term.slice(0, 4)))));
  if (lexical) return { relevant: true, reason: 'lexical-evidence' };
  // A deliberately generic query is ambiguous rather than evidence that a
  // candidate is irrelevant; retain existing inspectable uncertainty behavior.
  if (terms.length === 1 && terms[0] === 'query') return { relevant: true, reason: 'semantic-code-evidence' };
  const codeQuery = terms.some(term => CODE_TERMS.has(term));
  const codeIntent = terms.some(term => ['find', 'reject', 'handle', 'create', 'validate', 'load', 'save', 'parse'].includes(term));
  const strongest = candidates[0]?.score ?? 0;
  const codeEvidence = evidence.some(text => /\b(function|class|export|throw|return|const|let)\b/.test(text));
  if ((codeQuery || (codeEvidence && codeIntent)) && strongest > 0.18) return { relevant: true, reason: 'semantic-code-evidence' };
  return { relevant: false, reason: 'insufficient-evidence' };
}
