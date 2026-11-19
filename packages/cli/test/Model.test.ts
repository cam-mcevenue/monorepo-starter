import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Model from "@repo/cli/Model";

describe("Model.decodePackageName", () => {
  it.effect("rejects a name that is not kebab-case, keeping the input as given", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Model.decodePackageName("My_Package"));
      expect(error._tag).toBe("InvalidName");
      expect(error.input).toBe("My_Package");
    }),
  );

  it.effect("trims before validating, the same for an argument as for a prompt answer", () =>
    Effect.gen(function* () {
      expect(yield* Model.decodePackageName("  my-package \n")).toBe("my-package");
    }),
  );
});

describe("Model.decodeNpmScope", () => {
  it.effect("adds the @ when it was left off, and trims", () =>
    Effect.gen(function* () {
      expect(yield* Model.decodeNpmScope(" acme ")).toBe("@acme");
      expect(yield* Model.decodeNpmScope("@acme-labs")).toBe("@acme-labs");
    }),
  );

  it.effect("rejects a scope npm would not accept", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Model.decodeNpmScope("@Acme Labs"));
      expect(error).toMatchObject({ _tag: "InvalidScope", input: "@Acme Labs" });
    }),
  );
});
