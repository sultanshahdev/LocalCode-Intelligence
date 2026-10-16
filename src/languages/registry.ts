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
   * Throws if an adapter with the same ID, a conflicting extension (including
   * duplicates within the adapter's own fileExtensions), or an inconsistent
   * capability declaration is detected.
   */
  register(adapter: LanguageAdapter): void {
    if (this.adaptersById.has(adapter.id)) {
      throw new Error(`Language adapter with id "${adapter.id}" is already registered.`);
    }

    // Detect duplicate normalized extensions within this adapter's own declaration.
    const seenInAdapter = new Set<string>();
    for (const rawExt of adapter.fileExtensions) {
      const ext = this.normalizeExtension(rawExt);
      if (seenInAdapter.has(ext)) {
        throw new Error(
          `Adapter "${adapter.id}" declares duplicate file extension "${ext}".`,
        );
      }
      seenInAdapter.add(ext);
    }

    // Verify all extensions are normalized and non-conflicting across adapters.
    for (const rawExt of adapter.fileExtensions) {
      const ext = this.normalizeExtension(rawExt);
      const existing = this.adaptersByExtension.get(ext);
      if (existing) {
        throw new Error(
          `Extension "${ext}" is already registered to language "${existing.id}" and cannot be assigned to "${adapter.id}".`,
        );
      }
    }

    // Ensure declared capabilities are backed by actual method implementations.
    if (adapter.capabilities.structural) {
      if (typeof adapter.extractSymbols !== 'function') {
        throw new Error(
          `Adapter "${adapter.id}" declares structural capability but does not implement extractSymbols.`,
        );
      }
      if (typeof adapter.findPossibleUsages !== 'function') {
        throw new Error(
          `Adapter "${adapter.id}" declares structural capability but does not implement findPossibleUsages.`,
        );
      }
    }
    if (adapter.capabilities.precise) {
      if (typeof adapter.resolveDefinition !== 'function') {
        throw new Error(
          `Adapter "${adapter.id}" declares precise capability but does not implement resolveDefinition.`,
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
