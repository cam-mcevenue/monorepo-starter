/**
 * Internal implementation: unexported from the package, because the `exports`
 * map blocks `src/internal`. `Greeter.ts` decides what of it leaks out.
 */
export const format = (name: string): string => `Hello, ${name}!`;
