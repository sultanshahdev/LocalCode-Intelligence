import { extname } from 'node:path';
import type { LanguageAdapter, LanguageId } from './types.js';

export class LanguageRegistry {
  private readonly adaptersById = new Map<LanguageId, LanguageAdapter>();
  private readonly adaptersByExtension = new Map<string, LanguageAdapter>();

  constructor(initialAdapters: readonly LanguageAdapter[] = []) {
    for (const adapter of initialAdapters) {
      this.register(adapter);
    }
  }

  /**
   * Registers a new language adapter.
   * Throws if an adapter with the same ID or conflicting extension is already registered.
   */
  register(adapter: LanguageAdapter): void {
    if (this.adaptersById.has(adapter.id)) {
      throw new Error(`Language adapter with id "${adapter.id}" is already registered.`);
    }

    // Verify all extensions are normalized and non-conflicting
    for (const rawExt of adapter.fileExtensions) {
      const ext = this.normalizeExtension(rawExt);
      const existing = this.adaptersByExtension.get(ext);
      if (existing) {
        throw new Error(
          `Extension "${ext}" is already registered to language "${existing.id}" and cannot be assigned to "${adapter.id}".`,
        );
      }
    }

    this.adaptersById.set(adapter.id, adapter);
    for (const rawExt of adapter.fileExtensions) {
      const ext = this.normalizeExtension(rawExt);
      this.adaptersByExtension.set(ext, adapter);
    }
  }

  /**
   * Looks up an adapter by exact language ID.
   */
  getById(id: LanguageId): LanguageAdapter | undefined {
    return this.adaptersById.get(id);
  }

  /**
   * Resolves the language adapter responsible for a given file path or extension.
   * Returns undefined if the file extension is unsupported or unknown.
   */
  getByPath(filePath: string): LanguageAdapter | undefined {
    const ext = this.normalizeExtension(extname(filePath));
    if (!ext) return undefined;
    return this.adaptersByExtension.get(ext);
  }

  /**
   * Returns whether a given file path or extension is supported by any registered adapter.
   */
  isSupported(filePath: string): boolean {
    return this.getByPath(filePath) !== undefined;
  }

  /**
   * Returns a deduplicated Set of all registered file extensions (lowercase, starting with dot).
   */
  getSupportedExtensions(): Set<string> {
    return new Set(this.adaptersByExtension.keys());
  }

  /**
   * Returns all registered language adapters.
   */
  getAllAdapters(): LanguageAdapter[] {
    return Array.from(this.adaptersById.values());
  }

  private normalizeExtension(ext: string): string {
    const trimmed = ext.trim().toLowerCase();
    if (!trimmed) return '';
    return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
  }
}
