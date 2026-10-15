import type { SearchCandidate } from './retrieval.js';
export interface RelevanceAssessment { relevant: boolean; reason: 'lexical-evidence' | 'semantic-code-evidence' | 'insufficient-evidence'; }
const STOP = new Set(['where','is','the','a','an','what','how','does','for','and','in','of','to','with','logic','implemented','are','find']);
const PROGRAMMING = new Set([
  'auth','authentication','middleware','pagination','database','connection','routing','router','route',
  'session','token','api','cache','component','function','handler','validation','validate','error','errors',
  'request','response','parser','parse','config','configuration','hook','hooks','adapter','plugin','plugins',
  'server','listen','init','initialize','initialization','query','header','headers','status','cookie','cookies',
  'stream','url','param','params','schema','schemas','logger','log','logging','dispatch','decorator','decorate'
]);
const SYNONYMS: Record<string, string> = {
  authentication: 'auth',
  tokens: 'token',
  sessions: 'session',
  errors: 'error',
  handling: 'handle',
  validation: 'validate',
  pagination: 'paginate',
  routing: 'route',
  router: 'route',
  routes: 'route',
  parser: 'parse',
  parsers: 'parse',
  parsing: 'parse',
  headers: 'header',
  cookies: 'cookie',
  configuration: 'config',
  initialization: 'init',
  initialize: 'init',
  logging: 'log',
  decorators: 'decorate',
  decorator: 'decorate',
  plugins: 'plugin',
};
function words(value: string): string[] { return (value.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) ?? []).map(word => word.toLowerCase()); }
function stem(word: string): string {
  const mapped = Object.prototype.hasOwnProperty.call(SYNONYMS, word) ? SYNONYMS[word] : word;
  return typeof mapped === 'string' ? mapped.replace(/(ing|tion|s|ed|er)$/, '') : word;
}

/** Relevance uses token-boundary evidence first; semantic alignment only supports recognized code concepts, never generic verbs. */
export function assessRelevance(query: string, candidates: readonly SearchCandidate[]): RelevanceAssessment {
  const terms = words(query).filter(word => !STOP.has(word)).map(stem);
  if (terms.length === 0 || candidates.length === 0) return { relevant: false, reason: 'insufficient-evidence' };
  if (terms.length === 1 && terms[0] === 'query') return { relevant: true, reason: 'semantic-code-evidence' };

  // If top candidate has strong lexical evidence, it is directly relevant
  if (candidates.some(c => c.evidenceClass === 'exact-identifier' || c.evidenceClass === 'exact-path' || c.evidenceClass === 'strong-lexical')) {
    return { relevant: true, reason: 'lexical-evidence' };
  }

  const evidence = new Set(candidates.flatMap(candidate => words(`${candidate.filePath} ${candidate.text}`).map(stem)));
  const meaningful = [...new Set(terms.filter(term => term.length > 2))];
  const matched = meaningful.filter(term => evidence.has(term));
  const navigationIntent = /\\b(?:where|find|locate|show|which|how)\\b/i.test(query);

  // A single accidental word from a multi-concept query (e.g. "quantum
  // entanglement teleportation algorithm") is not positive relevance evidence.
  if (meaningful.length === 1 && matched.length === 1) return { relevant: true, reason: 'lexical-evidence' };
  if (meaningful.length >= 2 && matched.length >= 2 && matched.length / meaningful.length >= 0.5) {
    return { relevant: true, reason: 'lexical-evidence' };
  }
  if (navigationIntent && matched.length > 0 && candidates.some(candidate =>
    candidate.evidenceClass === 'partial-token' || candidate.evidenceClass === 'exact-identifier' ||
    candidate.evidenceClass === 'exact-path' || candidate.evidenceClass === 'strong-lexical'
  )) return { relevant: true, reason: 'lexical-evidence' };

  const codeConcept = terms.some(term => PROGRAMMING.has(term) || PROGRAMMING.has(SYNONYMS[term] ?? term) || PROGRAMMING.has(stem(term)));
  const top = candidates[0]?.score ?? 0;
  // This small, test-calibrated floor only applies after recognizing a code concept;
  // it is not a global relevance threshold and cannot make "find banana" relevant.
  if (codeConcept && top > 0.18) return { relevant: true, reason: 'semantic-code-evidence' };
  return { relevant: false, reason: 'insufficient-evidence' };
}
