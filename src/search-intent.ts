/** Lightweight, deterministic query intent classification.  This deliberately
 * avoids a model request: intent is a ranking hint, never a claim of certainty. */
export type SearchIntent = 'identifier' | 'test' | 'example' | 'usage' | 'implementation' | 'conceptual';

const TEST_WORDS = /\b(?:test|tests|tested|testing|spec|specs|verify|verified|coverage|cover)\b/i;
const EXAMPLE_WORDS = /\b(?:example|examples|demo|sample|usage)\b/i;
const USAGE_WORDS = /\b(?:called|calls|call site|invoked|invoke|used|use)\b/i;
const IMPLEMENTATION_WORDS = /\b(?:where|how|implemented|implementation|defines?|definition|controlled|dispatch(?:ed)?|reject(?:ed)?|bounded|handled|logic)\b/i;
const SYMBOL = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

export function classifySearchIntent(query: string): SearchIntent {
  const value = query.trim();
  if (SYMBOL.test(value)) return 'identifier';
  if (TEST_WORDS.test(value)) return 'test';
  if (EXAMPLE_WORDS.test(value)) return 'example';
  if (USAGE_WORDS.test(value)) return 'usage';
  if (IMPLEMENTATION_WORDS.test(value)) return 'implementation';
  return 'conceptual';
}
