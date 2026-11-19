import { Console, Effect, Predicate } from "effect";
import { TerminalCapabilities } from "effect/cli";

/**
 * Text for the user, with parts marked by what they are rather than how they
 * look. Messages are built where they are decided and rendered only where they
 * are printed, so planners stay pure, and tests and logs read plain text.
 *
 * One meaning per style, so a skimming eye learns it once:
 *
 * | Style     | Marks                                        | On a terminal |
 * | --------- | -------------------------------------------- | ------------- |
 * | `code`    | a name, path, flag or setting in a sentence  | cyan          |
 * | `label`   | the file a finding is about                  | yellow        |
 * | `success` | a status tag for a change made               | bold green    |
 * | `caution` | a status tag for nothing done, or a warning  | bold yellow   |
 * | `info`    | a status tag for what to do next             | bold cyan     |
 * | `danger`  | a destructive step                           | red           |
 */

export type Style = "code" | "label" | "success" | "caution" | "info" | "danger";

export interface Styled {
  readonly text: string;
  readonly style: Style;
}

export interface Message {
  readonly parts: ReadonlyArray<string | Styled>;
}

type Value = string | number | Styled | Message;

export const is = (value: unknown): value is Message =>
  Predicate.hasProperty(value, "parts") && Array.isArray(value.parts);

const partsOf = (value: Value): ReadonlyArray<string | Styled> =>
  typeof value === "string" || typeof value === "number"
    ? [String(value)]
    : is(value)
      ? value.parts
      : [value];

export const styled = (text: string, style: Style): Styled => ({ text, style });

/** A name, path, flag or setting inside a sentence. */
export const code = (text: string): Styled => styled(text, "code");

/** A status tag that leads a line, such as `[Created]`. Only the word is styled. */
export const tag = (text: string, style: "success" | "caution" | "info"): Message => ({
  parts: ["[", styled(text, style), "]"],
});

/** A message from a template: ``msg`${code(name)} already exists` ``. */
export const msg = (strings: TemplateStringsArray, ...values: ReadonlyArray<Value>): Message => {
  const parts: Array<string | Styled> = [];
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
  message.parts.map((part) => (typeof part === "string" ? part : part.text)).join("");

// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Control characters shown as `\xNN`, as Effect's formatter does, so input cannot drive the terminal. */
const escapeControl = (text: string) =>
  text.replace(
    CONTROL,
    (character) => `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );

const ESC = "\x1b[";
const SGR: Record<Style, readonly [open: string, close: string]> = {
  code: [`${ESC}36m`, `${ESC}39m`],
  label: [`${ESC}33m`, `${ESC}39m`],
  success: [`${ESC}1m${ESC}32m`, `${ESC}39m${ESC}22m`],
  caution: [`${ESC}1m${ESC}33m`, `${ESC}39m${ESC}22m`],
  info: [`${ESC}1m${ESC}36m`, `${ESC}39m${ESC}22m`],
  danger: [`${ESC}31m`, `${ESC}39m`],
};

/**
 * The message for a terminal, styled when `colors` is set. Callers take
 * `colors` from `TerminalCapabilities.canColor`, the same answer Effect's own
 * formatter uses, so `NO_COLOR` and piping behave alike.
 */
export const render = (message: Message, colors: boolean): string =>
  message.parts
    .map((part) => {
      if (typeof part === "string") {
        return escapeControl(part);
      }
      const text = escapeControl(part.text);
      if (!colors) {
        return text;
      }
      const [open, close] = SGR[part.style];
      return `${open}${text}${close}`;
    })
    .join("");

/** Print to stdout, styled when the terminal can colour. */
export const log = Effect.fnUntraced(function* (message: Message) {
  const { canColor } = yield* TerminalCapabilities.TerminalCapabilities;
  yield* Console.log(render(message, canColor));
});

/** Print to stderr, styled when the terminal can colour. */
export const logError = Effect.fnUntraced(function* (message: Message) {
  const { canColor } = yield* TerminalCapabilities.TerminalCapabilities;
  yield* Console.error(render(message, canColor));
});
