import { Command } from "effect/cli";
import { pkg } from "./commands/pkg.ts";

/**
 * This repo's dev CLI. Add commands here as the repo grows — it is tooling for
 * working IN the monorepo, not a product surface.
 */
export const cli = Command.make("cli").pipe(
  Command.withDescription("Repo tooling"),
  Command.withSubcommands([pkg]),
);
