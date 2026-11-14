import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { decodePackageName } from "@repo/cli/Model";

describe("decodePackageName", () => {
  it.effect("rejects a name that is not kebab-case, keeping the input as given", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(decodePackageName("My_Package"));
      expect(error._tag).toBe("InvalidName");
      expect(error.input).toBe("My_Package");
    }),
  );

  it.effect("trims before validating, the same for an argument as for a prompt answer", () =>
    Effect.gen(function* () {
      expect(yield* decodePackageName("  my-package \n")).toBe("my-package");
    }),
  );
});
