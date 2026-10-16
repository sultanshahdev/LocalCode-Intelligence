import { LanguageRegistry } from './registry.js';
import { javaScriptTypeScriptAdapter } from './javascript-typescript.js';

export * from './types.js';
export * from './registry.js';
export * from './javascript-typescript.js';

/**
 * Creates a language registry initialized with the standard production language adapters.
 * Each invocation returns a distinct registry instance with no shared mutable state.
 */
export function createDefaultLanguageRegistry(): LanguageRegistry {
  return new LanguageRegistry([javaScriptTypeScriptAdapter]);
}

let sharedRegistry: LanguageRegistry | undefined;

/**
 * Returns the shared default language registry singleton, creating it on first call.
 * Uses lazy initialization to avoid circular-module initialization hazards.
 */
export function getDefaultLanguageRegistry(): LanguageRegistry {
  if (!sharedRegistry) {
    sharedRegistry = createDefaultLanguageRegistry();
  }
  return sharedRegistry;
}

/**
 * Shared default language registry instance for runtime convenience.
 * Equivalent to calling getDefaultLanguageRegistry(); no Proxy indirection.
 */
export const defaultLanguageRegistry: LanguageRegistry = getDefaultLanguageRegistry();
