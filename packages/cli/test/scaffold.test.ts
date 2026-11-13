import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { addProjectReference, removeProjectReference } from "../src/internal/scaffold.ts";

const tsconfig = `{
  "references": [
    { "path": "packages/cli" },
    { "path": "scratchpad" }
    // a comment that must survive
  ]
}
`;

it.effect("inserts a project reference and preserves comments", () =>
  Effect.gen(function* () {
    const result = yield* addProjectReference(tsconfig, "packages/example");
    expect(result).toContain('{ "path": "packages/example" },');
    expect(result).toContain('{ "path": "scratchpad" }');
    expect(result).toContain("// a comment that must survive");
  }),
);

it.effect("round-trips: adding then removing restores the original", () =>
  Effect.gen(function* () {
    const added = yield* addProjectReference(tsconfig, "packages/example");
    const removed = yield* removeProjectReference(added, "packages/example");
    expect(removed).toBe(tsconfig);
  }),
);

it.effect("removes the last entry without breaking the others", () =>
  Effect.gen(function* () {
    const result = yield* removeProjectReference(tsconfig, "scratchpad");
    expect(result).not.toContain("scratchpad");
    expect(result).toContain('{ "path": "packages/cli" },');
    expect(result).toContain("// a comment that must survive");
  }),
);

it.effect("fails when there is no references array", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(addProjectReference("{}", "packages/example"));
    expect(error._tag).toBe("ScaffoldError");
  }),
);

it.effect("fails when removing a reference that is not there", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(removeProjectReference(tsconfig, "packages/nope"));
    expect(error._tag).toBe("ScaffoldError");
  }),
);
