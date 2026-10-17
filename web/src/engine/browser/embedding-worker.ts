/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers';

declare const self: DedicatedWorkerGlobalScope;
env.allowLocalModels = false;
env.useBrowserCache = true;

let extractor: any;
async function embed(texts: string[]): Promise<number[][]> {
  if (!extractor) {
    const options = (device: 'webgpu' | 'wasm') => ({
      dtype: 'q8' as const, device,
      progress_callback: (event: { status?: string; file?: string; progress?: number }) => self.postMessage({ type: 'progress', event: { ...event, device } }),
    });
    // WebGPU is opportunistic. A driver, model, or browser incompatibility
    // must not make semantic search unavailable when WASM can run it.
    if ((navigator as Navigator & { gpu?: unknown }).gpu) {
      try { extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', options('webgpu')); }
      catch { self.postMessage({ type: 'progress', event: { status: 'WebGPU unavailable; using WASM.' } }); }
    }
    extractor ??= await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', options('wasm'));
  }
  const output: any = await extractor(texts, { pooling: 'mean', normalize: true });
  const values = output.tolist() as number[][];
  return values;
}
self.onmessage = async (message: MessageEvent<{ id: number; texts: string[] }>) => {
  try { self.postMessage({ id: message.data.id, vectors: await embed(message.data.texts) }); }
  catch (error) { self.postMessage({ id: message.data.id, error: error instanceof Error ? error.message : 'Embedding model failed to initialize.' }); }
};
