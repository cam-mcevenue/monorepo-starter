import { expect, it } from "@effect/vitest";
import { greet } from "@repo/pkg-effect";
import { Effect } from "effect";
import sample from "./fixtures/sample.json" with { type: "json" };

/**
 * Guards the package boundary: `src/internal` must stay unreachable from
 * outside. If the `exports` map ever stops blocking it — say the directory gets
 * renamed and `"./internal/*": null` is not renamed with it — this suppression
 * becomes unused and `vpr check` fails. Type-only, so nothing resolves at runtime.
 */
// @ts-expect-error internals are not importable across the package boundary
export type BoundaryGuard = typeof import("@repo/pkg-effect/internal/greeting");

it.effect("greets a name read from a fixture", () =>
  Effect.gen(function* () {
    expect(yield* greet(sample.name)).toBe("Hello, Ada!");
  }),
);
