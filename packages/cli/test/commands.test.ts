import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Stdio } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import { cli } from "@repo/cli";
import { RepoPath } from "@repo/cli/Model";
import { type Plan, type RemovePlan, Step } from "@repo/cli/Plan";
import { Workspace } from "@repo/cli/Workspace";

/**
 * The commands over a stub workspace, so these test the CLI's own decisions:
 * when to prompt, when to refuse, and when to apply, print, or install. stdin
 * is never a terminal here, as under an agent or the task runner.
 */

const removePlan: RemovePlan = {
  steps: [Step.Remove({ path: RepoPath.make("packages/foo") })],
  findings: [],
  packageName: "@repo/foo",
  packagePath: RepoPath.make("packages/foo"),
  wasPublic: false,
};

const stub = () => {
  const applied: Array<Plan> = [];
  let installs = 0;
  const unused = Effect.die("not used by this test");
  const workspace = Workspace.Service.of({
    root: "/repo",
    templates: Effect.succeed(["pkg-effect"]),
    template: () => unused,
    privatePackages: Effect.succeed([]),
    removablePackages: Effect.succeed(["foo"]),
    planSync: unused,
    planCreate: () => unused,
    planMakePublic: () => unused,
    planRemove: () => Effect.succeed(removePlan),
    apply: (plan) => Effect.sync(() => (applied.push(plan), [])),
    install: Effect.sync(() => void installs++),
  });
  return { applied, installs: () => installs, workspace };
};

const run = (workspace: Workspace.Interface, args: ReadonlyArray<string>) =>
  Command.runWith(cli, { version: "0.0.0", renderErrors: false })(args).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Stdio.layerTest({}),
        Layer.succeed(Workspace.Service, workspace),
      ),
    ),
  );

describe("pkg rm", () => {
  it.effect("without --yes and without a terminal, refuses naming --yes, and deletes nothing", () =>
    Effect.gen(function* () {
      const { applied, workspace } = stub();
      const error = yield* Effect.flip(run(workspace, ["pkg", "rm", "foo"]));
      expect(error).toMatchObject({ _tag: "MissingInput", flag: "--yes" });
      expect(applied).toEqual([]);
    }),
  );

  it.effect("--dry-run prints the plan and neither applies nor installs", () =>
    Effect.gen(function* () {
      const { applied, installs, workspace } = stub();
      yield* run(workspace, ["pkg", "rm", "foo", "--dry-run"]);
      expect(yield* TestConsole.logLines).toEqual([
        "Dry run, nothing written. Would:",
        "  remove packages/foo",
      ]);
      expect(applied).toEqual([]);
      expect(installs()).toBe(0);
    }),
  );

  it.effect("--yes applies the plan, then installs", () =>
    Effect.gen(function* () {
      const { applied, installs, workspace } = stub();
      yield* run(workspace, ["pkg", "rm", "foo", "--yes"]);
      expect(applied).toEqual([removePlan]);
      expect(installs()).toBe(1);
    }),
  );

  it.effect("--no-install applies the plan and says what is left to do", () =>
    Effect.gen(function* () {
      const { applied, installs, workspace } = stub();
      yield* run(workspace, ["pkg", "rm", "foo", "--yes", "--no-install"]);
      expect(applied).toEqual([removePlan]);
      expect(installs()).toBe(0);
      expect(yield* TestConsole.logLines).toContain(
        "Next: run `vp install` to relink the workspace",
      );
    }),
  );
});

describe("pkg add", () => {
  it.effect("without --template and without a terminal, refuses naming --template", () =>
    Effect.gen(function* () {
      const { workspace } = stub();
      const error = yield* Effect.flip(run(workspace, ["pkg", "add", "widget"]));
      expect(error).toMatchObject({ _tag: "MissingInput", flag: "--template" });
    }),
  );
});
