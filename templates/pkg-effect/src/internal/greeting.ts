/**
 * Internal implementation. Nothing here is part of the package's public API —
 * `src/index.ts` decides what leaks out.
 */
export const format = (name: string): string => `Hello, ${name}!`;
