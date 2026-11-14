import { expect, layer } from "@effect/vitest";
import { Greeter } from "@repo/pkg-effect";
import { Effect } from "effect";
import sample from "./fixtures/sample.json" with { type: "json" };

/**
 * Guards the package boundary: `src/internal` must stay unreachable from
 * outside. If the `exports` map ever stops blocking it — say the directory gets
 * renamed and `"./internal/*": null` is not renamed with it — this suppression
 * becomes unused and `vpr check` fails. Type-only, so nothing resolves at runtime.
 */
// @ts-expect-error internals are not importable across the package boundary
export type BoundaryGuard = typeof import("@repo/pkg-effect/internal/format");

/** Every test in the block gets the service from one shared layer. */
layer(Greeter.layer)("Greeter", (it) => {
  it.effect("greets a name read from a fixture", () =>
    Effect.gen(function* () {
      const greeter = yield* Greeter.Service;
      expect(yield* greeter.greet(sample.name)).toBe("Hello, Ada!");
    }),
  );

  it.effect("fails with a typed error when there is nobody to greet", () =>
    Effect.gen(function* () {
      const greeter = yield* Greeter.Service;
      // flip swaps the channels, so the expected failure is the value under test.
      const error = yield* Effect.flip(greeter.greet("   "));
      expect(error).toMatchObject({ _tag: "EmptyName", input: "   " });
    }),
  );
});
