import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag, Prompt } from "effect/cli";
import {
  checkRemovable,
  createPackage,
  findRepoRoot,
  listRemovablePackages,
  listTemplates,
  nameHint,
  removePackage,
  ScaffoldError,
  validateName,
  type Visibility,
} from "../internal/scaffold.ts";
import {
  type Finding,
  formatFiles,
  listPrivatePackages,
  makePublic,
  syncWorkspace,
  WorkspaceError,
} from "../internal/workspace.ts";

const PACKAGE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const nameArgument = Argument.String("name").pipe(
  Argument.withDescription("Package name, without the scope (prompts when omitted)"),
  Argument.optional,
);

/** Ask for the package name, rejecting invalid input at the prompt. */
const promptName = (message: string) =>
  Prompt.run(
    Prompt.String({
      message,
      validate: (value) =>
        PACKAGE_NAME.test(value.trim())
          ? Effect.succeed(value.trim())
          : Effect.fail(`Invalid name — ${nameHint}`),
    }),
  );

const resolveName = Effect.fnUntraced(function* (provided: Option.Option<string>, message: string) {
  if (Option.isSome(provided)) {
    return yield* validateName(provided.value);
  }
  return yield* promptName(message);
});

/** Pick one of a list, or fail if the list is empty. */
const promptChoice = Effect.fnUntraced(function* (
  message: string,
  choices: ReadonlyArray<string>,
  emptyMessage: string,
) {
  if (choices.length === 0) {
    return yield* new ScaffoldError({ message: emptyMessage });
  }
  return yield* Prompt.run(
    Prompt.Select({
      message,
      choices: choices.map((choice) => ({ title: choice, value: choice })),
    }),
  );
});

const repoRoot = Effect.suspend(() => findRepoRoot(process.cwd()));

/** `--public`, `--private`, or a prompt when neither is given. */
const resolveVisibility = Effect.fnUntraced(function* (isPublic: boolean, isPrivate: boolean) {
  if (isPublic && isPrivate) {
    return yield* new ScaffoldError({ message: "Pass --public or --private, not both" });
  }
  if (isPublic || isPrivate) {
    return isPublic ? "public" : "private";
  }
  return yield* Prompt.run(
    Prompt.Select<Visibility>({
      message: "Package type?",
      choices: [
        { title: "private (stays in the workspace)", value: "private" },
        { title: "public (published to npm)", value: "public" },
      ],
    }),
  );
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
  },
  (options) =>
    Effect.gen(function* () {
      const templates = yield* listTemplates();
      const { template } = options;

      const chosenTemplate = Option.isSome(template)
        ? templates.includes(template.value)
          ? template.value
          : yield* new ScaffoldError({
              message: `Unknown template "${template.value}". Available: ${templates.join(", ")}`,
            })
        : yield* promptChoice("Which template?", templates, "No templates found");

      const chosenName = yield* resolveName(options.name, "Package name?");
      const visibility = yield* resolveVisibility(options.public, options.private);

      const root = yield* repoRoot;
      const { packageName, packagePath, written } = yield* createPackage(
        root,
        chosenName,
        chosenTemplate,
        visibility,
      );
      yield* formatFiles(root, written);
      yield* Console.log(
        `Created ${visibility} ${packageName} at ${packagePath} from the ${chosenTemplate} template`,
      );
      yield* Console.log("Next: run `vp install` to link it into the workspace");
    }),
).pipe(Command.withDescription("Stub a new package in packages/ from a template"));

const makePublicCommand = Command.make("make-public", { name: nameArgument }, ({ name }) =>
  Effect.gen(function* () {
    const root = yield* repoRoot;
    const chosenName = Option.isSome(name)
      ? yield* validateName(name.value)
      : yield* promptChoice(
          "Which package?",
          yield* listPrivatePackages(root),
          "No private packages found in packages/",
        );

    const { from, to, written } = yield* makePublic(root, chosenName);
    yield* formatFiles(root, written);
    yield* Console.log(`${from} is now public as ${to}`);
    yield* Console.log("Next: run `vp install` to relink the renamed package");
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
      const root = yield* repoRoot;
      const { findings, written } = yield* syncWorkspace(root, { check });
      yield* formatFiles(root, written);
      for (const file of written) {
        yield* Console.log(`Wrote ${file}`);
      }
      yield* printFindings(findings);
      if (findings.length > 0) {
        return yield* new WorkspaceError({
          message: `pkg sync: ${findings.length} problem${findings.length === 1 ? "" : "s"} found`,
        });
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
  },
  ({ name, yes }) =>
    Effect.gen(function* () {
      const root = yield* repoRoot;
      const chosenName = Option.isSome(name)
        ? yield* validateName(name.value)
        : yield* promptChoice(
            "Which package?",
            yield* listRemovablePackages(root),
            "No removable packages found in packages/",
          );

      // Refuse before asking, so a "yes" is never followed by a refusal.
      const { packageName: target, packagePath } = yield* checkRemovable(root, chosenName);
      if (!yes) {
        const confirmed = yield* Prompt.run(
          Prompt.Confirm({
            message: `Delete ${target} (${packagePath})?`,
            initial: false,
          }),
        );
        if (!confirmed) {
          return yield* Console.log("Aborted");
        }
      }

      const { packageName, written, wasPublic } = yield* removePackage(root, chosenName);
      yield* formatFiles(root, written);
      yield* Console.log(`Removed ${packageName} (${packagePath})`);
      if (wasPublic) {
        yield* Console.log("Any release already on npm is untouched; deprecate it there if needed");
      }
      yield* Console.log("Next: run `vp install` to update the workspace");
    }),
).pipe(Command.withDescription("Delete a package in packages/ that nothing depends on"));

export const pkg = Command.make("pkg").pipe(
  Command.withDescription("Manage packages in packages/"),
  Command.withSubcommands([add, makePublicCommand, sync, rm]),
);
