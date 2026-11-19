import { Context, Effect, Layer, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { ProcessFailure, UnexpectedOutput } from "./PackageError.ts";

/**
 * The repo's own tools, as the CLI calls them: pnpm to list workspace members,
 * and Vite+ to format and install. A seam so tests can stand in a fixed member
 * list rather than spawning pnpm.
 */

export interface Service {
  /** Absolute paths of the workspace members, as pnpm resolves pnpm-workspace.yaml. */
  readonly listMembers: (
    root: string,
  ) => Effect.Effect<ReadonlyArray<string>, ProcessFailure | UnexpectedOutput>;
  /** Run the repo formatter over files the CLI wrote as plain `JSON.stringify` output. */
  readonly format: (
    root: string,
    files: ReadonlyArray<string>,
  ) => Effect.Effect<void, ProcessFailure>;
  /** Relink the workspace, with the install's output shown as it runs. */
  readonly install: (root: string) => Effect.Effect<void, ProcessFailure>;
}

export class Toolchain extends Context.Service<Toolchain, Service>()("@repo/cli/Toolchain") {}

const PnpmProjects = Schema.fromJsonString(Schema.Array(Schema.Struct({ path: Schema.String })));

/** The toolchain over a child-process spawner. */
export const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  /** Run to completion, failing on a non-zero exit. */
  const run = Effect.fnUntraced(function* (command: ChildProcess.Command, label: string) {
    const exitCode = yield* spawner
      .exitCode(command)
      .pipe(Effect.mapError((cause) => new ProcessFailure({ command: label, cause })));
    if (exitCode !== 0) {
      return yield* new ProcessFailure({ command: label, exitCode });
    }
  });

  const listMembers = Effect.fn("Toolchain.listMembers")(function* (root: string) {
    const args = ["ls", "-r", "--depth", "-1", "--json"];
    const command = `pnpm ${args.join(" ")}`;
    const output = yield* spawner
      .string(ChildProcess.make("pnpm", args, { cwd: root }))
      .pipe(Effect.mapError((cause) => new ProcessFailure({ command, cause })));
    const projects = yield* Schema.decodeEffect(PnpmProjects)(output).pipe(
      Effect.mapError(() => new UnexpectedOutput({ command, output })),
    );
    return projects.map((project) => project.path);
  });

  const format = Effect.fn("Toolchain.format")(function* (
    root: string,
    files: ReadonlyArray<string>,
  ) {
    if (files.length > 0) {
      yield* run(ChildProcess.make("vp", ["fmt", ...files], { cwd: root }), "vp fmt");
    }
  });

  const install = Effect.fn("Toolchain.install")(function* (root: string) {
    yield* run(
      ChildProcess.make("vp", ["install"], { cwd: root, stdout: "inherit", stderr: "inherit" }),
      "vp install",
    );
  });

  return Toolchain.of({ listMembers, format, install });
});

export const layer = Layer.effect(Toolchain, make);
