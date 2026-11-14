import { Effect, Layer, Predicate } from "effect";
import { type CliError, CliOutput, TerminalCapabilities } from "effect/cli";
import { isMessage, type Message, render } from "./message.ts";

/**
 * How the CLI prints its errors: Effect's own formatter, except that one of
 * this CLI's expected errors is rendered from its `text`, so the names in it
 * are emphasised. Effect escapes control characters in a plain user message,
 * which would print colour codes literally, hence a formatter rather than
 * colour codes inside the message.
 */

/** The `text` of the expected error a `UserError` was raised for, if it is one of ours. */
const textOf = (error: CliError.CliError): Message | undefined => {
  const cause = error._tag === "UserError" ? error.cause : undefined;
  return Predicate.hasProperty(cause, "text") && isMessage(cause.text) ? cause.text : undefined;
};

export const formatter = (colors: boolean): CliOutput.Formatter => {
  const base = CliOutput.defaultFormatter({ colors });
  const heading = colors ? "\x1b[1m\x1b[31mERROR\x1b[0m" : "ERROR";
  return {
    formatHelpDoc: base.formatHelpDoc,
    formatCliError: base.formatCliError,
    formatVersion: base.formatVersion,
    formatErrors: base.formatErrors,
    formatError: (error) => {
      const text = textOf(error);
      return text === undefined
        ? base.formatError(error)
        : `\n${heading}\n  ${render(text, colors)}`;
    },
  };
};

/** Installs the formatter, colouring when `TerminalCapabilities` says the terminal can. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const { canColor } = yield* TerminalCapabilities.TerminalCapabilities;
    return CliOutput.layer(formatter(canColor));
  }),
);
