import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createLocalcodeServer } from '../src/server.js';
import { SearchExecutionController, SearchOverloadedError } from '../src/search-execution.js';
import { prepareSourceScope } from '../src/source.js';

async function withServer(
  run: (port: number) => Promise<void>,
  options: Parameters<typeof createLocalcodeServer>[0] = {},
): Promise<void> {
  const server = createLocalcodeServer(options);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await run(address.port); } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

async function post(port: number, body: string, contentType = 'application/json'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ port, host: '127.0.0.1', path: '/api/search', method: 'POST', headers: { 'Content-Type': contentType } }, res => {
      let result = '';
      res.on('data', chunk => { result += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: result }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('HTTP JSON endpoints reject malformed, oversized, and unsupported content safely', async () => {
  await withServer(async port => {
    const malformed = await post(port, '{');
    assert.deepEqual(malformed, { status: 400, body: '{"error":"Invalid JSON body."}' });
    const oversized = await post(port, JSON.stringify({ padding: 'x'.repeat(64 * 1024) }));
    assert.equal(oversized.status, 413);
    assert.match(oversized.body, /64 KiB/);
    const unsupported = await post(port, '{}', 'text/plain');
    assert.deepEqual(unsupported, { status: 415, body: '{"error":"Content-Type must be application/json."}' });
    const missing = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      request({ port, host: '127.0.0.1', path: '/api/missing' }, response => {
        let body = '';
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      }).on('error', reject).end();
    });
    assert.deepEqual(missing, { status: 404, body: '{"error":"Unknown API route: /api/missing"}' });
  });
});

test('an aborted body does not prevent a subsequent request from completing', async () => {
  await withServer(async port => {
    await new Promise<void>(resolve => {
      const req = request({ port, host: '127.0.0.1', path: '/api/search', method: 'POST', headers: { 'Content-Type': 'application/json' } });
      req.on('error', () => resolve());
      req.write('{"query":"partial');
      req.destroy();
    });
    const health = await new Promise<number>((resolve, reject) => {
      request({ port, host: '127.0.0.1', path: '/api/health' }, response => resolve(response.statusCode ?? 0)).on('error', reject).end();
    });
    assert.equal(health, 200);
  });
});

test('search execution is bounded, releases failures, and skips aborted queued work', async () => {
  const controller = new SearchExecutionController(1, 2, 1_000);
  let release!: () => void;
  const first = controller.execute(() => new Promise<string>(resolve => { release = () => resolve('first'); }));
  const second = controller.execute(async () => 'second');
  const aborter = new AbortController();
  const aborted = controller.execute(async () => 'never', aborter.signal);
  await assert.rejects(controller.execute(async () => 'overload'), SearchOverloadedError);
  aborter.abort();
  await assert.rejects(aborted, /cancelled/);
  release();
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
  await assert.rejects(controller.execute(async () => { throw new Error('failed'); }), /failed/);
  assert.equal(await controller.execute(async () => 'released'), 'released');
});

test('large files are skipped before bounded reading while normal source remains searchable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'localcode-source-'));
  try {
    await writeFile(join(directory, 'large.ts'), 'x'.repeat(300 * 1024));
    await writeFile(join(directory, 'small.ts'), 'export const usable = true;\n');
    const scope = await prepareSourceScope(directory);
    assert.equal(scope.filesProcessed, 1);
    assert.deepEqual(scope.regions.map(region => region.filePath), ['small.ts']);
    assert.match(scope.warnings.join('\n'), /large\.ts: exceeds/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('completed JSON request receives asynchronous semantic-search response', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'localcode-reliability-'));
  try {
    await withServer(async port => {
      const response = await post(port, JSON.stringify({ repositoryPath: directory, query: 'find auth' }));
      assert.equal(response.status, 200);
      const payload = JSON.parse(response.body);
      assert.equal(payload.ok, true);
      assert.equal(payload.outcome, 'no-supported-candidate');
      assert.deepEqual(payload.candidates, []);
    }, {
      performSearch: async () => {
        // Delay past the point when Node automatically marks the fully read
        // IncomingMessage stream as destroyed. It is not a client cancellation.
        await new Promise(resolve => setTimeout(resolve, 30));
        return {
          ok: true as const,
          outcome: 'no-supported-candidate' as const,
          candidates: [],
          withheldCandidates: 0,
          scope: { regions: [], filesProcessed: 0, warnings: [] },
        };
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
