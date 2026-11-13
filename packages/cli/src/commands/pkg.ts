import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag, Prompt } from "effect/cli";
import {
  createPackage,
  findRepoRoot,
  listRemovablePackages,
  listTemplates,
  nameHint,
  removePackage,
  ScaffoldError,
  validateName,
} from "../internal/scaffold.ts";

const PACKAGE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const nameArgument = Argument.String("name").pipe(
  Argument.withDescription("Package name, without the @repo/ scope (prompts when omitted)"),
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

const add = Command.make(
  "add",
  {
    name: nameArgument,
    template: Flag.String("template").pipe(
      Flag.withDescription("Template name (prompts when omitted)"),
      Flag.optional,
    ),
  },
  ({ name, template }) =>
    Effect.gen(function* () {
      const templates = yield* listTemplates();

      const chosenTemplate = Option.isSome(template)
        ? templates.includes(template.value)
          ? template.value
          : yield* new ScaffoldError({
              message: `Unknown template "${template.value}". Available: ${templates.join(", ")}`,
            })
        : yield* promptChoice("Which template?", templates, "No templates found");

      const chosenName = yield* resolveName(name, "Package name?");

      const { packageName, packagePath } = yield* createPackage(chosenName, chosenTemplate);
      yield* Console.log(
        `Created ${packageName} at ${packagePath} from the ${chosenTemplate} template`,
      );
      yield* Console.log("Next: run `vp install` to link it into the workspace");
    }),
).pipe(Command.withDescription("Stub a new package in packages/ from a template"));

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
      const chosenName = Option.isSome(name)
        ? yield* validateName(name.value)
        : yield* promptChoice(
            "Which package?",
            yield* listRemovablePackages(yield* findRepoRoot(process.cwd())),
            "No removable packages found in packages/",
          );

      const packagePath = `packages/${chosenName}`;
      if (!yes) {
        const confirmed = yield* Prompt.run(
          Prompt.Confirm({
            message: `Delete ${packagePath}?`,
            initial: false,
          }),
        );
        if (!confirmed) {
          return yield* Console.log("Aborted");
        }
      }

      const { packageName } = yield* removePackage(chosenName);
      yield* Console.log(`Removed ${packageName} and ${packagePath}`);
      yield* Console.log("Next: run `vp install` to update the workspace");
    }),
).pipe(Command.withDescription("Delete a package in packages/"));

export const pkg = Command.make("pkg").pipe(
  Command.withDescription("Manage packages in packages/"),
  Command.withSubcommands([add, rm]),
);
