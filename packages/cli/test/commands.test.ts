import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Stdio } from "effect";
import { Command, TerminalCapabilities } from "effect/cli";
import { TestConsole } from "effect/testing";
import { cli } from "@repo/cli";
import { RepoPath } from "@repo/cli/Model";
import { type CreatePlan, type Plan, type RemovePlan, Step, type Template } from "@repo/cli/Plan";
import * as Workspace from "@repo/cli/Workspace";

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

const template: Template = { name: "pkg-effect", dir: "/t", files: new Map(), pruned: [] };

const createPlan: CreatePlan = {
  steps: [],
  findings: [],
  packageName: "@acme/widget",
  packagePath: RepoPath.make("packages/widget"),
};

const stub = (options: { readonly npmScope?: string } = {}) => {
  const applied: Array<Plan> = [];
  /** The scope each `planCreate` call was given. */
  const scopes: Array<string | undefined> = [];
  let installs = 0;
  const unused = Effect.die("not used by this test");
  const workspace = Workspace.Workspace.of({
    root: "/repo",
    templates: Effect.succeed(["pkg-effect"]),
    template: () => Effect.succeed(template),
    npmScope: Effect.succeed(options.npmScope),
    privatePackages: Effect.succeed([]),
    removablePackages: Effect.succeed(["foo"]),
    planSync: unused,
    planCreate: (_template, _name, _visibility, scope) =>
      Effect.sync(() => (scopes.push(scope), createPlan)),
    planMakePublic: () => unused,
    planRemove: () => Effect.succeed(removePlan),
    apply: (plan) => Effect.sync(() => (applied.push(plan), [])),
    install: Effect.sync(() => void installs++),
  });
  return { applied, scopes, installs: () => installs, workspace };
};

const run = (workspace: Workspace.Service, args: ReadonlyArray<string>) =>
  Command.runWith(cli, { version: "0.0.0", renderErrors: false })(args).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Stdio.layerTest({}),
        // Plain output, whatever the test runner does to colour.
        Layer.succeed(TerminalCapabilities.TerminalCapabilities, {
          canColor: false,
          canAnimate: false,
          canPrompt: false,
        }),
        Layer.succeed(Workspace.Workspace, workspace),
      ),
    ),
  );

describe("pkg rm", () => {
  it.effect("without --yes and without a terminal, refuses naming --yes, and deletes nothing", () =>
    Effect.gen(function* () {
      const { applied, workspace } = stub();
      const error = yield* Effect.flip(run(workspace, ["pkg", "rm", "foo"]));
      expect(error).toMatchObject({ _tag: "MissingInput", flags: ["--yes"] });
      expect(applied).toEqual([]);
    }),
  );

  it.effect("--dry-run prints the plan and neither applies nor installs", () =>
    Effect.gen(function* () {
      const { applied, installs, workspace } = stub();
      yield* run(workspace, ["pkg", "rm", "foo", "--dry-run"]);
      expect(yield* TestConsole.logLines).toEqual([
        "[Dry run] nothing written. Would:",
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
        "[Next] run vp install to relink the workspace",
      );
    }),
  );
});

describe("pkg add", () => {
  it.effect("without --template and without a terminal, refuses naming --template", () =>
    Effect.gen(function* () {
      const { workspace } = stub();
      const error = yield* Effect.flip(run(workspace, ["pkg", "add", "widget"]));
      expect(error).toMatchObject({ _tag: "MissingInput", flags: ["--template"] });
    }),
  );
});

describe("pkg add --public", () => {
  const args = ["pkg", "add", "widget", "--template", "pkg-effect", "--public", "--no-install"];

  it.effect("in a repo with no scope and no terminal, refuses naming --npm-scope", () =>
    Effect.gen(function* () {
      const { scopes, workspace } = stub();
      const error = yield* Effect.flip(run(workspace, args));
      expect(error).toMatchObject({ _tag: "MissingInput", flags: ["--npm-scope"] });
      expect(scopes).toEqual([]);
    }),
  );

  it.effect("--npm-scope is decoded, adding the @ when it was left off", () =>
    Effect.gen(function* () {
      const { scopes, workspace } = stub();
      yield* run(workspace, [...args, "--npm-scope", "acme"]);
      expect(scopes).toEqual(["@acme"]);
    }),
  );

  it.effect("in a repo with a scope, asks nothing and leaves it to the repo's", () =>
    Effect.gen(function* () {
      const { scopes, workspace } = stub({ npmScope: "@acme" });
      yield* run(workspace, args);
      expect(scopes).toEqual([undefined]);
    }),
  );
});
