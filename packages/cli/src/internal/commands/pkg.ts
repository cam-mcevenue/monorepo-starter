import { Console, Effect, Option, Path, Stdio } from "effect";
import { Argument, Command, Flag, Prompt } from "effect/cli";
import { decodeNpmScope, decodePackageName, type Visibility } from "../../Model.ts";
import {
  ConflictingFlags,
  MissingInput,
  nameHint,
  NothingToChoose,
  OutOfSync,
} from "../../PackageError.ts";
import { type Finding, type Plan, Step } from "../../Plan.ts";
import { Workspace } from "../../Workspace.ts";

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
const ask = Effect.fnUntraced(function* <A, E, R>(flag: string, prompt: Effect.Effect<A, E, R>) {
  const stdio = yield* Stdio.Stdio;
  if (!(yield* stdio.stdinIsTerminal)) {
    return yield* new MissingInput({ flag });
  }
  return yield* prompt;
});

const resolveName = Effect.fnUntraced(function* (provided: Option.Option<string>) {
  const input = Option.isSome(provided)
    ? provided.value
    : yield* ask(
        "<name>",
        Prompt.run(
          Prompt.String({
            message: "Package name?",
            validate: (value) =>
              decodePackageName(value).pipe(Effect.mapError(() => `Invalid name — ${nameHint}`)),
          }),
        ),
      );
  return yield* decodePackageName(input);
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
    return yield* new NothingToChoose({ what });
  }
  return yield* ask(
    flag,
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
    return yield* new ConflictingFlags({ flags: ["--public", "--private"] });
  }
  if (isPublic || isPrivate) {
    return isPublic ? "public" : "private";
  }
  return yield* ask(
    "--public or --private",
    Prompt.run(
      Prompt.Select<Visibility>({
        message: "Package type?",
        choices: [
          { title: "private (stays in the workspace)", value: "private" },
          { title: "public (published to npm)", value: "public" },
        ],
      }),
    ),
  );
});

const SCOPE_EXPLAINER = `Public packages publish to npm under a scope, such as @your-org.
This repo has none set yet, so pkg will add
  "repo": { "npmScope": "<your answer>" }
to the root package.json, and name every public package <scope>/<name>.`;

/**
 * The scope to record for a repo that has none: `--npm-scope`, or a prompt
 * that first says what the answer will change. `undefined` when the repo
 * already has one, so the planner uses that.
 */
const resolveScope = Effect.fnUntraced(function* (provided: Option.Option<string>) {
  if (Option.isSome(provided)) {
    return yield* decodeNpmScope(provided.value);
  }
  const workspace = yield* Workspace.Service;
  if ((yield* workspace.npmScope) !== undefined) {
    return undefined;
  }
  const answer = yield* ask(
    "--npm-scope",
    Console.log(SCOPE_EXPLAINER).pipe(
      Effect.andThen(
        Prompt.run(
          Prompt.String({
            message: "npm scope?",
            validate: (value) =>
              decodeNpmScope(value).pipe(Effect.mapError((error) => error.message)),
          }),
        ),
      ),
    ),
  );
  return yield* decodeNpmScope(answer);
});

/** One line per step, with paths relative to the repo root. */
const printPlan = Effect.fnUntraced(function* (plan: Plan) {
  const workspace = yield* Workspace.Service;
  const path = yield* Path.Path;
  yield* Console.log("Dry run, nothing written. Would:");
  for (const step of plan.steps) {
    yield* Console.log(
      Step.$match(step, {
        Copy: ({ from, to }) => `  copy   ${path.relative(workspace.root, from)} → ${to}`,
        Remove: ({ path: target }) => `  remove ${target}`,
        Write: ({ path: target }) => `  write  ${target}`,
      }),
    );
  }
});

/** Apply the plan and relink, or explain what is left to do; or, under `--dry-run`, print it. */
const carryOut = Effect.fnUntraced(function* (
  plan: Plan,
  options: { readonly dryRun: boolean; readonly install: boolean },
  done: Effect.Effect<void>,
) {
  if (options.dryRun) {
    return yield* printPlan(plan);
  }
  const workspace = yield* Workspace.Service;
  yield* workspace.apply(plan);
  yield* done;
  if (options.install) {
    yield* workspace.install;
  } else {
    yield* Console.log("Next: run `vp install` to relink the workspace");
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
      const workspace = yield* Workspace.Service;
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
        Console.log(
          `Created ${visibility} ${plan.packageName} at ${plan.packagePath} from the ${template.name} template`,
        ),
      );
    }),
).pipe(Command.withDescription("Stub a new package in packages/ from a template"));

const makePublic = Command.make(
  "make-public",
  { name: nameArgument, npmScope: npmScopeFlag, dryRun: dryRunFlag, install: installFlag },
  (options) =>
    Effect.gen(function* () {
      const workspace = yield* Workspace.Service;
      const name = yield* decodePackageName(
        yield* resolveChoice(
          options.name,
          "<name>",
          "Which package?",
          workspace.privatePackages,
          "private packages in packages/",
        ),
      );
      const plan = yield* workspace.planMakePublic(name, yield* resolveScope(options.npmScope));
      yield* carryOut(plan, options, Console.log(`${plan.from} is now public as ${plan.to}`));
    }),
).pipe(Command.withDescription("Make a private package in packages/ publishable to npm"));

const printFindings = Effect.fnUntraced(function* (findings: ReadonlyArray<Finding>) {
  for (const finding of findings.filter((f) => f.fixable)) {
    yield* Console.error(`${finding.path}: ${finding.problem} (run \`vpr cli pkg sync\`)`);
  }
  for (const finding of findings.filter((f) => !f.fixable)) {
    yield* Console.error(`${finding.path}: ${finding.problem}`);
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
      const workspace = yield* Workspace.Service;
      const plan = yield* workspace.planSync;
      // Applied, what sync repaired is no longer a finding; what needs a decision still is.
      const findings = check ? plan.findings : plan.findings.filter((f) => !f.fixable);
      if (!check) {
        for (const file of yield* workspace.apply(plan)) {
          yield* Console.log(`Wrote ${file}`);
        }
      }
      yield* printFindings(findings);
      if (findings.length > 0) {
        return yield* new OutOfSync({ count: findings.length });
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
      const workspace = yield* Workspace.Service;
      const name = yield* decodePackageName(
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
      if (!options.yes && !options.dryRun) {
        const confirmed = yield* ask(
          "--yes",
          Prompt.run(
            Prompt.Confirm({
              message: `Delete ${plan.packageName} (${plan.packagePath})?`,
              initial: false,
            }),
          ),
        );
        if (!confirmed) {
          return yield* Console.log("Aborted");
        }
      }

      yield* carryOut(
        plan,
        options,
        Effect.gen(function* () {
          yield* Console.log(`Removed ${plan.packageName} (${plan.packagePath})`);
          if (plan.wasPublic) {
            yield* Console.log(
              "Any release already on npm is untouched; deprecate it there if needed",
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
