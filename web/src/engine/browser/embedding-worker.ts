/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers';

declare const self: DedicatedWorkerGlobalScope;
env.allowLocalModels = false;
env.useBrowserCache = true;

let extractor: any;
async function embed(texts: string[]): Promise<number[][]> {
  extractor ??= await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    dtype: 'q8', device: (navigator as Navigator & { gpu?: unknown }).gpu ? 'webgpu' : 'wasm',
    progress_callback: (event: { status?: string; file?: string; progress?: number }) => self.postMessage({ type: 'progress', event }),
  });
  const output: any = await extractor(texts, { pooling: 'mean', normalize: true });
  const values = output.tolist() as number[][];
  return values;
}
self.onmessage = async (message: MessageEvent<{ id: number; texts: string[] }>) => {
  try { self.postMessage({ id: message.data.id, vectors: await embed(message.data.texts) }); }
  catch (error) { self.postMessage({ id: message.data.id, error: error instanceof Error ? error.message : 'Embedding model failed to initialize.' }); }
};
