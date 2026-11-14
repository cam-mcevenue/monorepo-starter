import { Predicate } from "effect";

/**
 * Text for the user, with the parts to emphasise marked: package names,
 * paths, flags and settings. Messages are built where they are decided and
 * rendered only where they are printed, so planners stay pure, and tests and
 * logs read plain text.
 */

/** A part to emphasise. */
export interface Code {
  readonly code: string;
}

export interface Message {
  readonly parts: ReadonlyArray<string | Code>;
}

type Value = string | number | Code | Message;

export const isMessage = (value: unknown): value is Message =>
  Predicate.hasProperty(value, "parts") && Array.isArray(value.parts);

const partsOf = (value: Value): ReadonlyArray<string | Code> =>
  typeof value === "string" || typeof value === "number"
    ? [String(value)]
    : isMessage(value)
      ? value.parts
      : [value];

export const code = (text: string): Code => ({ code: text });

/** A message from a template: ``msg`${code(name)} already exists` ``. */
export const msg = (strings: TemplateStringsArray, ...values: ReadonlyArray<Value>): Message => {
  const parts: Array<string | Code> = [];
  strings.forEach((text, index) => {
    if (text !== "") {
      parts.push(text);
    }
    const value = values[index];
    if (value !== undefined) {
      parts.push(...partsOf(value));
    }
  });
  return { parts };
};

/** `values` with `separator` between them, as one message. */
export const join = (values: ReadonlyArray<Value>, separator: string): Message => ({
  parts: values.flatMap((value, index) =>
    index === 0 ? partsOf(value) : [separator, ...partsOf(value)],
  ),
});

export const plain = (message: Message): string =>
  message.parts.map((part) => (typeof part === "string" ? part : part.code)).join("");

/** Control characters shown as `\xNN`, as Effect's formatter does, so input cannot drive the terminal. */
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const escapeControl = (text: string) =>
  text.replace(
    CONTROL,
    (character) => `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );

/**
 * The message for a terminal: emphasised parts in cyan when `colors` is set.
 * Callers take `colors` from `TerminalCapabilities.canColor`, the same answer
 * Effect's own formatter uses, so `NO_COLOR` and piping behave alike.
 */
export const render = (message: Message, colors: boolean): string =>
  message.parts
    .map((part) =>
      typeof part === "string"
        ? escapeControl(part)
        : colors
          ? `\x1b[36m${escapeControl(part.code)}\x1b[39m`
          : escapeControl(part.code),
    )
    .join("");
