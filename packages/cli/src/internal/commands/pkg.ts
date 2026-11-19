import { Effect, Option, Path, Stdio } from "effect";
import { Argument, Command, Flag, Prompt } from "effect/cli";
import { code, log, logError, msg, plain, styled, tag } from "../message.ts";
import * as Model from "../../Model.ts";
import * as PackageError from "../../PackageError.ts";
import * as Plan from "../../Plan.ts";
import * as Workspace from "../../Workspace.ts";

/**
 * `pkg add`, `make-public`, `sync` and `rm`. Each builds a plan through the
 * workspace, then either prints it (`--dry-run`) or applies it. Anything not
 * given as an argument is asked for, unless stdin is not a terminal: then
 * the command fails naming the flag to pass, since a prompt nobody can answer
 * would only print and exit.
 */

const nameArgument = Argument.String("name").pipe(
  Argument.withDescription("Package name, without the scope (prompts when omitted)"),
  Argument.optional,
);

const dryRunFlag = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("Print what would change, and change nothing"),
  Flag.withDefault(false),
);

const installFlag = Flag.Boolean("install").pipe(
  Flag.withDescription("Run `vp install` afterwards to relink the workspace"),
  Flag.withDefault(true),
);

const npmScopeFlag = Flag.String("npm-scope").pipe(
  Flag.withDescription(
    "npm scope for public packages, recorded in the root package.json when the repo has none yet",
  ),
  Flag.optional,
);

/** Prompt, or fail naming `flag` when nobody is there to answer. */
const ask = Effect.fnUntraced(function* <A, E, R>(
  flags: ReadonlyArray<string>,
  prompt: Effect.Effect<A, E, R>,
) {
  const stdio = yield* Stdio.Stdio;
  if (!(yield* stdio.stdinIsTerminal)) {
    return yield* new PackageError.MissingInput({ flags });
  }
  return yield* prompt;
});

const resolveName = Effect.fnUntraced(function* (provided: Option.Option<string>) {
  const input = Option.isSome(provided)
    ? provided.value
    : yield* ask(
        ["<name>"],
        Prompt.run(
          Prompt.String({
            message: "Package name?",
            validate: (value) =>
              Model.decodePackageName(value).pipe(
                Effect.mapError(() => plain(msg`Invalid name — ${PackageError.nameHint}`)),
              ),
          }),
        ),
      );
  return yield* Model.decodePackageName(input);
});

/** Pick one of a list, failing when it is empty or nobody can pick. */
const resolveChoice = Effect.fnUntraced(function* (
  provided: Option.Option<string>,
  flag: string,
  message: string,
  choices: Effect.Effect<ReadonlyArray<string>, Workspace.LoadError>,
  what: string,
) {
  if (Option.isSome(provided)) {
    return provided.value;
  }
  const available = yield* choices;
  if (available.length === 0) {
    return yield* new PackageError.NothingToChoose({ what });
  }
  return yield* ask(
    [flag],
    Prompt.run(
      Prompt.Select({
        message,
        choices: available.map((choice) => ({ title: choice, value: choice })),
      }),
    ),
  );
});

/** `--public`, `--private`, or a prompt when neither is given. */
const resolveVisibility = Effect.fnUntraced(function* (isPublic: boolean, isPrivate: boolean) {
  if (isPublic && isPrivate) {
    return yield* new PackageError.ConflictingFlags({ flags: ["--public", "--private"] });
  }
  if (isPublic || isPrivate) {
    return isPublic ? "public" : "private";
  }
  return yield* ask(
    ["--public", "--private"],
    Prompt.run(
      Prompt.Select<Model.Visibility>({
        message: "Package type?",
        choices: [
          { title: "private (stays in the workspace)", value: "private" },
          { title: "public (published to npm)", value: "public" },
        ],
      }),
    ),
  );
});

const SCOPE_EXPLAINER = msg`Public packages publish to npm under a scope, such as ${code("@your-org")}.
This repo has none set yet, so pkg will add
  ${code('"monorepoSettings": { "npmScope": "<your answer>" }')}
to the root ${code("package.json")}, and name every public package ${code("<scope>/<name>")}.`;

/**
 * The scope to record for a repo that has none: `--npm-scope`, or a prompt
 * that first says what the answer will change. `undefined` when the repo
 * already has one, so the planner uses that.
 */
const resolveScope = Effect.fnUntraced(function* (provided: Option.Option<string>) {
  if (Option.isSome(provided)) {
    return yield* Model.decodeNpmScope(provided.value);
  }
  const workspace = yield* Workspace.Workspace;
  if ((yield* workspace.npmScope) !== undefined) {
    return undefined;
  }
  const answer = yield* ask(
    ["--npm-scope"],
    log(SCOPE_EXPLAINER).pipe(
      Effect.andThen(
        Prompt.run(
          Prompt.String({
            message: "npm scope?",
            validate: (value) =>
              Model.decodeNpmScope(value).pipe(Effect.mapError((error) => error.message)),
          }),
        ),
      ),
    ),
  );
  return yield* Model.decodeNpmScope(answer);
});

/**
 * Plans carry absolute paths; people read them relative to the repo root. This
 * is the edge where one becomes the other.
 */
const shownFromRoot = Effect.gen(function* () {
  const workspace = yield* Workspace.Workspace;
  const path = yield* Path.Path;
  return (target: string) => path.relative(workspace.root, target);
});

/** One line per step. */
const printPlan = Effect.fnUntraced(function* (plan: Plan.Plan) {
  const shown = yield* shownFromRoot;
  yield* log(msg`${tag("Dry run", "caution")} nothing written. Would:`);
  for (const step of plan.steps) {
    yield* log(
      Plan.Step.$match(step, {
        Copy: ({ from, to }) => msg`  copy   ${code(shown(from))} -> ${code(shown(to))}`,
        Remove: ({ path: target }) => msg`  ${styled("remove", "danger")} ${code(shown(target))}`,
        Write: ({ path: target }) => msg`  write  ${code(shown(target))}`,
      }),
    );
  }
});

/** Apply the plan and relink, or explain what is left to do; or, under `--dry-run`, print it. */
const carryOut = Effect.fnUntraced(function* (
  plan: Plan.Plan,
  options: { readonly dryRun: boolean; readonly install: boolean },
  done: Effect.Effect<void>,
) {
  if (options.dryRun) {
    return yield* printPlan(plan);
  }
  const workspace = yield* Workspace.Workspace;
  yield* workspace.apply(plan);
  yield* done;
  if (options.install) {
    yield* workspace.install;
  } else {
    yield* log(msg`${tag("Next", "info")} run ${code("vp install")} to relink the workspace`);
  }
});

const add = Command.make(
  "add",
  {
    name: nameArgument,
    template: Flag.String("template").pipe(
      Flag.withDescription("Template name (prompts when omitted)"),
      Flag.optional,
    ),
    public: Flag.Boolean("public").pipe(
      Flag.withDescription("Publishable to npm, in the repo's npm scope"),
      Flag.withDefault(false),
    ),
    private: Flag.Boolean("private").pipe(
      Flag.withDescription("Workspace-only (the type prompts when neither flag is given)"),
      Flag.withDefault(false),
    ),
    dryRun: dryRunFlag,
    npmScope: npmScopeFlag,
    install: installFlag,
  },
  (options) =>
    Effect.gen(function* () {
      const workspace = yield* Workspace.Workspace;
      const shown = yield* shownFromRoot;
      const templateName = yield* resolveChoice(
        options.template,
        "--template",
        "Which template?",
        workspace.templates,
        "templates",
      );
      // Load it now, so an unknown template is refused before the other prompts.
      const template = yield* workspace.template(templateName);
      const name = yield* resolveName(options.name);
      const visibility = yield* resolveVisibility(options.public, options.private);

      const scope = visibility === "public" ? yield* resolveScope(options.npmScope) : undefined;

      const plan = yield* workspace.planCreate(template, name, visibility, scope);
      yield* carryOut(
        plan,
        options,
        log(
          msg`${tag("Created", "success")} ${visibility} package ${code(plan.packageName)} at ${code(shown(plan.packagePath))} from the template -> ${code(shown(template.dir))}`,
        ),
      );
    }),
).pipe(Command.withDescription("Stub a new package in packages/ from a template"));

const makePublic = Command.make(
  "make-public",
  { name: nameArgument, npmScope: npmScopeFlag, dryRun: dryRunFlag, install: installFlag },
  (options) =>
    Effect.gen(function* () {
      const workspace = yield* Workspace.Workspace;
      const name = yield* Model.decodePackageName(
        yield* resolveChoice(
          options.name,
          "<name>",
          "Which package?",
          workspace.privatePackages,
          "private packages in packages/",
        ),
      );
      const plan = yield* workspace.planMakePublic(name, yield* resolveScope(options.npmScope));
      yield* carryOut(
        plan,
        options,
        log(msg`${tag("Made public", "success")} ${code(plan.from)} is now ${code(plan.to)}`),
      );
    }),
).pipe(Command.withDescription("Make a private package in packages/ publishable to npm"));

/** `[file]: problem`, the ones sync can repair first, each pointing at the command that does. */
const printFindings = Effect.fnUntraced(function* (findings: ReadonlyArray<Plan.Finding>) {
  const shown = yield* shownFromRoot;
  const line = (finding: Plan.Finding) =>
    msg`[${styled(shown(finding.path), "label")}]: ${finding.problem}`;
  for (const finding of findings.filter((f) => f.fixable)) {
    yield* logError(msg`${line(finding)} (run ${code("vpr cli pkg sync")})`);
  }
  for (const finding of findings.filter((f) => !f.fixable)) {
    yield* logError(line(finding));
  }
});

const sync = Command.make(
  "sync",
  {
    check: Flag.Boolean("check").pipe(
      Flag.withDescription("Write nothing; exit non-zero if anything is out of sync"),
      Flag.withDefault(false),
    ),
  },
  ({ check }) =>
    Effect.gen(function* () {
      const workspace = yield* Workspace.Workspace;
      const plan = yield* workspace.planSync;
      // Applied, what sync repaired is no longer a finding; what needs a decision still is.
      const findings = check ? plan.findings : plan.findings.filter((f) => !f.fixable);
      if (!check) {
        const shown = yield* shownFromRoot;
        for (const file of yield* workspace.apply(plan)) {
          yield* log(msg`${tag("Wrote", "success")} ${code(shown(file))}`);
        }
      }
      yield* printFindings(findings);
      if (findings.length > 0) {
        return yield* new PackageError.OutOfSync({ count: findings.length });
      }
    }),
).pipe(
  Command.withDescription(
    "Derive build configs, references and publish fields for every public package",
  ),
);

const rm = Command.make(
  "rm",
  {
    name: nameArgument,
    yes: Flag.Boolean("yes").pipe(
      Flag.withDescription("Skip the confirmation prompt"),
      Flag.withAlias("y"),
      Flag.withDefault(false),
    ),
    dryRun: dryRunFlag,
    install: installFlag,
  },
  (options) =>
    Effect.gen(function* () {
      const workspace = yield* Workspace.Workspace;
      const name = yield* Model.decodePackageName(
        yield* resolveChoice(
          options.name,
          "<name>",
          "Which package?",
          workspace.removablePackages,
          "removable packages in packages/",
        ),
      );

      // Planned before asking, so a "yes" is never followed by a refusal.
      const plan = yield* workspace.planRemove(name);
      const shown = yield* shownFromRoot;
      if (!options.yes && !options.dryRun) {
        const confirmed = yield* ask(
          ["--yes"],
          Prompt.run(
            Prompt.Confirm({
              message: `Delete ${plan.packageName} (${shown(plan.packagePath)})?`,
              initial: false,
            }),
          ),
        );
        if (!confirmed) {
          return yield* log(msg`${tag("Aborted", "caution")} nothing deleted`);
        }
      }

      yield* carryOut(
        plan,
        options,
        Effect.gen(function* () {
          yield* log(
            msg`${tag("Removed", "success")} ${code(plan.packageName)} at ${code(shown(plan.packagePath))}`,
          );
          if (plan.wasPublic) {
            yield* log(
              msg`${tag("Note", "caution")} any release already on npm is untouched; deprecate it there if needed`,
            );
          }
        }),
      );
    }),
).pipe(Command.withDescription("Delete a package in packages/ that nothing depends on"));

export const pkg = Command.make("pkg").pipe(
  Command.withDescription("Manage packages in packages/"),
  Command.withSubcommands([add, makePublic, sync, rm]),
);
