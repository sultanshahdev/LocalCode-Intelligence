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
 * Shared default language registry instance for runtime convenience.
 */
export function getDefaultLanguageRegistry(): LanguageRegistry {
  if (!sharedRegistry) {
    sharedRegistry = createDefaultLanguageRegistry();
  }
  return sharedRegistry;
}

export const defaultLanguageRegistry = new Proxy({} as LanguageRegistry, {
  get(target, prop, receiver) {
    const registry = getDefaultLanguageRegistry();
    const value = Reflect.get(registry, prop, registry);
    return typeof value === 'function' ? value.bind(registry) : value;
  },
});
