import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

import { prepareSourceScope, type SourceScope, type SourceRegion } from '../src/source.js';
import {
  createLocalEmbedder,
  CachingEmbedder,
  retrieveCandidates,
  retrieveHybridCandidates,
  retrieveLexicalCandidates,
  selectDisplayCandidates,
  type Embedder,
  type SearchCandidate,
} from '../src/retrieval.js';
import { assessRelevance } from '../src/relevance.js';
import { BENCHMARK_DATASET, type BenchmarkQuery } from './benchmark-dataset.js';

const REPO_ROOT = process.env['LOCALCODE_BENCHMARK_ROOT'] ?? '/home/sultan/Desktop/repos/benchmarks';
const SELECTED_REPOS = (process.env['LOCALCODE_BENCHMARK_REPOS'] ?? 'express,axios,fastify,localcode')
  .split(',').map(value => value.trim()).filter(Boolean);
const SELECTED_SPLIT = process.env['LOCALCODE_BENCHMARK_SPLIT'] ?? 'all';
const REPO_PATHS: Record<string, string> = {
  express: resolve(REPO_ROOT, 'express'),
  axios: resolve(REPO_ROOT, 'axios'),
  fastify: resolve(REPO_ROOT, 'fastify'),
  localcode: resolve(REPO_ROOT, 'localcode'),
};

const REPO_COMMITS: Record<string, string> = {
  express: 'a419aa7350389a275ab45fde2e849ed1f02449ef',
  axios: '326843a3902d73c9f6af9bad7b55e2412566a251',
  fastify: '37df44a421817e7bb048fce834bf691abb0999d6',
  localcode: 'c4bebd4b1d39179d7f5503db24155c3720f47bd0',
};

export type PipelineConfig = 'semantic-only' | 'earlier-hybrid' | 'corrected-hybrid' | 'merged-baseline' | 'intent-aware';

export interface QueryEvaluationResult {
  queryId: string;
  repo: string;
  query: string;
  type: string;
  split: string;
  expectedFile?: string | undefined;
  finalOutcome: string;
  candidatesCount: number;
  topCandidateFile?: string | undefined;
  topCandidateScore?: number | undefined;
  recallAt1: number;
  recallAt5: number;
  mrr: number;
  isFalseNegative: boolean;
  isFalsePositive: boolean;
  correctAbstention: boolean;
  retrievalLatencyMs: number;
}

export interface BenchmarkMetrics {
  config: PipelineConfig;
  totalQueries: number;
  positiveQueries: number;
  negativeQueries: number;
  recallAt1: number;
  recallAt5: number;
  mrrAt5: number;
  falseNegativeRate: number;
  falsePositiveRate: number;
  correctAbstentionRate: number;
  meanLatencyMs: number;
  modelInitLatencyMs: number;
  memoryUsageMb: number;
  rssMemoryMb: number;
  repoCoverage: Record<string, { filesProcessed: number; regions: number; warnings: number }>;
  results: QueryEvaluationResult[];
}

// Earlier simple lexical function for comparison (Problem D: token frequency only, without tiered evidence)
function earlierRetrieveLexical(query: string, regions: readonly SourceRegion[], limit = 50): SearchCandidate[] {
  const terms = (query.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) ?? []).map(t => t.toLowerCase());
  if (terms.length === 0) return [];
  return regions
    .map(region => {
      const tokens = new Set((`${region.filePath} ${region.text}`.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) ?? []).map(t => t.toLowerCase()));
      const matches = terms.filter(term => tokens.has(term)).length;
      return { ...region, score: matches / terms.length };
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Earlier hybrid implementation: cosine floor filtered out negative scores, and earlier lexical was used
async function earlierHybridSearch(query: string, regions: readonly SourceRegion[], embedder: Embedder) {
  const allSemantic = await retrieveCandidates(query, regions, embedder, regions.length);
  const semantic = allSemantic.slice(0, 50);
  const rawByLoc = new Map(allSemantic.map(c => [`${c.filePath}:${c.startLine}:${c.endLine}`, c]));
  const lexical = earlierRetrieveLexical(query, regions, 50).map(c => rawByLoc.get(`${c.filePath}:${c.startLine}:${c.endLine}`) ?? c);

  const fused = new Map<string, { candidate: SearchCandidate; score: number; lexical: boolean }>();
  const add = (candidate: SearchCandidate, rank: number) => {
    const key = `${candidate.filePath}:${candidate.startLine}:${candidate.endLine}`;
    const cur = fused.get(key);
    fused.set(key, { candidate, score: (cur?.score ?? 0) + 1 / (60 + rank), lexical: cur?.lexical ?? false });
  };
  semantic.forEach((c, i) => add(c, i + 1));
  lexical.forEach((c, i) => {
    add(c, i + 1);
    const e = fused.get(`${c.filePath}:${c.startLine}:${c.endLine}`);
    if (e) e.lexical = true;
  });

  const candidates = [...fused.values()]
    .sort((a, b) => b.score - a.score || b.candidate.score - a.candidate.score)
    .slice(0, 5)
    .map(item => ({ ...item.candidate, fusionScore: item.score, lexicalEvidence: item.lexical }));

  // Earlier display policy: only score > 0 (Problem D: strictly cosine > 0!)
  const displayed = candidates.filter(c => c.score > 0);
  const relevance = assessRelevance(query, displayed);
  return {
    outcome: displayed.length === 0 ? 'no-supported-candidate' : relevance.relevant ? 'candidates' : 'no-relevant-results',
    candidates: relevance.relevant ? displayed : [],
  };
}

async function semanticOnlySearch(query: string, regions: readonly SourceRegion[], embedder: Embedder) {
  const all = await retrieveCandidates(query, regions, embedder, 5);
  const displayed = all.filter(c => c.score > 0);
  const relevance = assessRelevance(query, displayed);
  return {
    outcome: displayed.length === 0 ? 'no-supported-candidate' : relevance.relevant ? 'candidates' : 'no-relevant-results',
    candidates: relevance.relevant ? displayed : [],
  };
}

async function correctedHybridSearch(query: string, regions: readonly SourceRegion[], embedder: Embedder, intentReranking = true) {
  const retrieved = await retrieveHybridCandidates(query, regions, embedder, 5, { intentReranking });
  const selection = selectDisplayCandidates(retrieved);
  const relevance = assessRelevance(query, selection.candidates);
  return {
    outcome: selection.candidates.length === 0 ? 'no-supported-candidate' : relevance.relevant ? 'candidates' : 'no-relevant-results',
    candidates: relevance.relevant ? selection.candidates : [],
  };
}

export async function runBenchmark(
  config: PipelineConfig, embedder: Embedder, modelInitLatencyMs: number,
  scopes: Readonly<Record<string, SourceScope>>,
): Promise<BenchmarkMetrics> {
  console.log(`\n========================================================`);
  console.log(`RUNNING BENCHMARK: ${config.toUpperCase()}`);
  console.log(`========================================================\n`);

  const repoCoverage: BenchmarkMetrics['repoCoverage'] = {};
  for (const [repo, scope] of Object.entries(scopes)) {
    repoCoverage[repo] = {
      filesProcessed: scope.filesProcessed,
      regions: scope.regions.length,
      warnings: scope.warnings.length,
    };
    console.log(`  ${repo}: ${scope.filesProcessed} files, ${scope.regions.length} regions`);
  }
  console.log('');

  const results: QueryEvaluationResult[] = [];

  const selectedDataset = BENCHMARK_DATASET.filter(item =>
    SELECTED_REPOS.includes(item.repo) && (SELECTED_SPLIT === 'all' || item.split === SELECTED_SPLIT));
  for (let i = 0; i < selectedDataset.length; i++) {
    const item = selectedDataset[i]!;
    const scope = scopes[item.repo];
    if (!scope) throw new Error(`Missing scope for ${item.repo}`);

    const tStart = performance.now();
    let searchResult: { outcome: string; candidates: SearchCandidate[] };

    if (config === 'semantic-only') {
      searchResult = await semanticOnlySearch(item.query, scope.regions, embedder);
    } else if (config === 'earlier-hybrid') {
      searchResult = await earlierHybridSearch(item.query, scope.regions, embedder);
    } else if (config === 'merged-baseline') {
      searchResult = await correctedHybridSearch(item.query, scope.regions, embedder, false);
    } else {
      searchResult = await correctedHybridSearch(item.query, scope.regions, embedder, true);
    }

    const latencyMs = performance.now() - tStart;
    const finalCandidates = searchResult.candidates;
    const isPositiveQuery = item.expectedMatch !== undefined;

    let recallAt1 = 0;
    let recallAt5 = 0;
    let mrr = 0;
    let isFalseNegative = false;
    let isFalsePositive = false;
    let correctAbstention = false;

    if (isPositiveQuery) {
      const expFile = item.expectedMatch!.file;
      const rank = finalCandidates.findIndex(c => c.filePath === expFile);

      if (rank === 0) {
        recallAt1 = 1;
        recallAt5 = 1;
        mrr = 1;
      } else if (rank > 0 && rank < 5) {
        recallAt5 = 1;
        mrr = 1 / (rank + 1);
      } else {
        isFalseNegative = true;
      }
    } else {
      // Negative / irrelevant query: should return 0 candidates
      if (finalCandidates.length > 0) {
        isFalsePositive = true;
      } else {
        correctAbstention = true;
      }
    }

    const evalResult: QueryEvaluationResult = {
      queryId: item.id,
      repo: item.repo,
      query: item.query,
      type: item.type,
      split: item.split,
      expectedFile: item.expectedMatch?.file,
      finalOutcome: searchResult.outcome,
      candidatesCount: finalCandidates.length,
      topCandidateFile: finalCandidates[0]?.filePath,
      topCandidateScore: finalCandidates[0]?.score,
      recallAt1,
      recallAt5,
      mrr,
      isFalseNegative,
      isFalsePositive,
      correctAbstention,
      retrievalLatencyMs: latencyMs,
    };

    results.push(evalResult);

    const statusMark = isPositiveQuery
      ? recallAt5 > 0 ? (recallAt1 > 0 ? '✓ R@1' : '✓ R@5') : '✗ FN'
      : correctAbstention ? '✓ ABSTAIN' : '✗ FP';

    console.log(
      `[${String(i + 1).padStart(2)}/${selectedDataset.length}] ${item.repo.padEnd(9)} | ${statusMark.padEnd(9)} | "${item.query.slice(0, 35).padEnd(35)}" | top: ${evalResult.topCandidateFile ?? 'none'}`
    );
  }

  const positiveResults = results.filter(r => r.expectedFile !== undefined);
  const negativeResults = results.filter(r => r.expectedFile === undefined);

  const meanR1 = positiveResults.reduce((acc, r) => acc + r.recallAt1, 0) / (positiveResults.length || 1);
  const meanR5 = positiveResults.reduce((acc, r) => acc + r.recallAt5, 0) / (positiveResults.length || 1);
  const meanMrr = positiveResults.reduce((acc, r) => acc + r.mrr, 0) / (positiveResults.length || 1);
  const falseNegCount = positiveResults.filter(r => r.isFalseNegative).length;
  const fnRate = falseNegCount / (positiveResults.length || 1);

  const falsePosCount = negativeResults.filter(r => r.isFalsePositive).length;
  const fpRate = falsePosCount / (negativeResults.length || 1);
  const correctAbstainCount = negativeResults.filter(r => r.correctAbstention).length;
  const abstainRate = correctAbstainCount / (negativeResults.length || 1);

  const meanLatency = results.reduce((acc, r) => acc + r.retrievalLatencyMs, 0) / (results.length || 1);
  const memUsageMb = process.memoryUsage().heapUsed / 1024 / 1024;
  const rssMemoryMb = process.memoryUsage().rss / 1024 / 1024;

  return {
    config,
    totalQueries: results.length,
    positiveQueries: positiveResults.length,
    negativeQueries: negativeResults.length,
    recallAt1: meanR1,
    recallAt5: meanR5,
    mrrAt5: meanMrr,
    falseNegativeRate: fnRate,
    falsePositiveRate: fpRate,
    correctAbstentionRate: abstainRate,
    meanLatencyMs: meanLatency,
    modelInitLatencyMs,
    memoryUsageMb: memUsageMb,
    rssMemoryMb,
    repoCoverage,
    results,
  };
}

async function loadScopes(): Promise<Record<string, SourceScope>> {
  const scopes: Record<string, SourceScope> = {};
  for (const repo of SELECTED_REPOS) {
    const repoPath = REPO_PATHS[repo]!;
    let actualSha: string;
    try {
      actualSha = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], {
        encoding: 'utf8', timeout: 10_000,
      }).trim();
    } catch {
      throw new Error('Benchmark checkout missing or invalid: ' + repoPath);
    }
    if (actualSha !== REPO_COMMITS[repo]) {
      throw new Error('Pinned SHA mismatch for ' + repo + ': expected ' + REPO_COMMITS[repo] + ', found ' + actualSha);
    }
    scopes[repo] = await prepareSourceScope(repoPath);
  }
  return scopes;
}

async function main() {
  if (SELECTED_REPOS.length === 0 || SELECTED_REPOS.some(repo => !(repo in REPO_PATHS))) {
    throw new Error('LOCALCODE_BENCHMARK_REPOS must contain at least one of express, axios, fastify, localcode.');
  }
  if (!['all', 'tuning', 'evaluation'].includes(SELECTED_SPLIT)) {
    throw new Error('LOCALCODE_BENCHMARK_SPLIT must be all, tuning, or evaluation.');
  }
  const allowedConfigs: PipelineConfig[] = ['merged-baseline', 'intent-aware', 'semantic-only', 'earlier-hybrid', 'corrected-hybrid'];
  const configs = (process.env['LOCALCODE_BENCHMARK_CONFIGS'] ?? 'merged-baseline,intent-aware')
    .split(',').map(item => item.trim()).filter(Boolean) as PipelineConfig[];
  if (configs.length === 0 || configs.some(config => !allowedConfigs.includes(config))) {
    throw new Error('LOCALCODE_BENCHMARK_CONFIGS accepts: ' + allowedConfigs.join(', '));
  }
  console.log('Benchmark checkout root: ' + REPO_ROOT);
  console.log('Selected repositories: ' + SELECTED_REPOS.join(', '));
  console.log('Query split: ' + SELECTED_SPLIT);
  console.log('Pipeline configurations: ' + configs.join(', '));

  console.log('Inspecting and verifying pinned source checkouts...');
  const scopes = await loadScopes();
  const selectedDataset = BENCHMARK_DATASET.filter(item =>
    SELECTED_REPOS.includes(item.repo) && (SELECTED_SPLIT === 'all' || item.split === SELECTED_SPLIT));
  if (selectedDataset.length === 0) throw new Error('No benchmark queries selected.');

  const tInit0 = performance.now();
  const rawEmbedder = await createLocalEmbedder();
  const modelInitLatencyMs = performance.now() - tInit0;
  console.log('Embedding model initialized in ' + (modelInitLatencyMs / 1000).toFixed(2) + 's');

  // Embed the pinned corpus and selected queries ONCE, before measuring either
  // configuration. This avoids configuration-order bias and the previous 3x
  // repeated full-corpus CPU inference. Cache inputs must match retrieval.ts.
  const embedder = new CachingEmbedder(rawEmbedder, 30_000);
  const inputs = [...new Set([
    ...selectedDataset.map(item => item.query),
    ...Object.values(scopes).flatMap(scope =>
      scope.regions.map(region => 'File: ' + region.filePath + '\n' + region.text)),
  ])];
  const warmStart = performance.now();
  console.log('Precomputing ' + inputs.length + ' unique vectors once (bounded batches of 32)...');
  for (let offset = 0; offset < inputs.length; offset += 32) {
    await embedder.embed(inputs.slice(offset, offset + 32));
    if ((offset + 32) % 320 === 0 || offset + 32 >= inputs.length) {
      console.log('  vectors prepared: ' + Math.min(offset + 32, inputs.length) + '/' + inputs.length);
    }
  }
  const prewarmMs = performance.now() - warmStart;
  console.log('Precompute completed in ' + (prewarmMs / 1000).toFixed(2) + 's');
  const allMetrics: Partial<Record<PipelineConfig, BenchmarkMetrics>> = {};
  for (const cfg of configs) {
    allMetrics[cfg] = await runBenchmark(cfg, embedder, modelInitLatencyMs, scopes);
  }

  const reportPath = process.env['LOCALCODE_BENCHMARK_OUTPUT'] ?? '/tmp/benchmark-metrics.json';
  writeFileSync(reportPath, JSON.stringify({
    repositoryCommits: Object.fromEntries(SELECTED_REPOS.map(repo => [repo, REPO_COMMITS[repo]])),
    selectedSplit: SELECTED_SPLIT,
    queryCount: selectedDataset.length,
    prewarmMs,
    configs,
    metrics: allMetrics,
  }, null, 2));
  console.log('\nSUMMARY — warm-cache retrieval, same pinned vectors for every configuration');
  for (const cfg of configs) {
    const v = allMetrics[cfg]!;
    console.log('\n' + cfg + ' (' + v.totalQueries + ' queries; ' + v.positiveQueries + ' positive, ' + v.negativeQueries + ' negative)');
    console.log('  Recall@1: ' + (v.recallAt1 * 100).toFixed(1) + '% | Recall@5: ' + (v.recallAt5 * 100).toFixed(1) + '% | MRR@5: ' + v.mrrAt5.toFixed(3));
    console.log('  FNR: ' + (v.falseNegativeRate * 100).toFixed(1) + '% | FPR: ' + (v.falsePositiveRate * 100).toFixed(1) + '%');
    console.log('  Warm query mean: ' + v.meanLatencyMs.toFixed(1) + 'ms | heap: ' + v.memoryUsageMb.toFixed(1) + ' MiB | RSS snapshot: ' + v.rssMemoryMb.toFixed(1) + ' MiB');
  }
  console.log('\nModel startup: ' + modelInitLatencyMs.toFixed(1) + 'ms | source/query precompute: ' + prewarmMs.toFixed(1) + 'ms');
  console.log('Memory figures are snapshots, not peak RSS; file-level labels are not implementation-level verification.');
  console.log('Machine-readable metrics: ' + reportPath);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  void main().catch(error => { console.error(error); process.exitCode = 1; });
}
