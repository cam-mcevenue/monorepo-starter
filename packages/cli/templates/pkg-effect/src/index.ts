/**
 * The package's main entry point, re-exporting each module as a namespace.
 * Every top-level module in `src/` is also its own entry point, so
 * `import * as Greeter from "@repo/pkg-effect/Greeter"` reaches the same one.
 */
export * as Greeter from "./Greeter.ts";
