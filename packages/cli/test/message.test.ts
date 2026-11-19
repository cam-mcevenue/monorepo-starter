import { describe, expect, it } from "@effect/vitest";
import { CliError } from "effect/cli";
import { code, join, msg, plain, render, styled, tag } from "@repo/cli/internal/message";
import { formatter } from "@repo/cli/internal/output";
import * as PackageError from "@repo/cli/PackageError";

describe("message", () => {
  it("keeps emphasised parts apart, flattening nested messages and lists", () => {
    const names = join(["a", "b"].map(code), ", ");
    const message = msg`pass ${code("--yes")}, ${3} of ${names}`;
    expect(message.parts).toEqual([
      "pass ",
      { text: "--yes", style: "code" },
      ", ",
      "3",
      " of ",
      { text: "a", style: "code" },
      ", ",
      { text: "b", style: "code" },
    ]);
    expect(plain(message)).toBe("pass --yes, 3 of a, b");
  });

  it("renders emphasis in cyan only when the terminal can colour", () => {
    const message = msg`${code("@acme/foo")} already exists`;
    expect(render(message, false)).toBe("@acme/foo already exists");
    expect(render(message, true)).toBe("\x1b[36m@acme/foo\x1b[39m already exists");
  });

  it("styles a status tag's word, not its brackets, and a finding's file in yellow", () => {
    expect(render(msg`${tag("Created", "success")} x`, true)).toBe(
      "[\x1b[1m\x1b[32mCreated\x1b[39m\x1b[22m] x",
    );
    expect(render(msg`[${styled("a/package.json", "label")}]: y`, true)).toBe(
      "[\x1b[33ma/package.json\x1b[39m]: y",
    );
    expect(render(msg`${tag("Created", "success")} x`, false)).toBe("[Created] x");
  });

  it("escapes control characters from input, so a name cannot drive the terminal", () => {
    expect(render(msg`${code("bad\x1b[2Jname")}`, true)).toBe("\x1b[36mbad\\x1b[2Jname\x1b[39m");
  });
});

describe("formatter", () => {
  const error = new PackageError.InvalidName({ input: "Bad_Name" });
  const userError = new CliError.UserError({ cause: error, userMessage: error.message });

  it("renders this CLI's expected errors from their text, emphasised", () => {
    expect(formatter(true).formatError(userError)).toContain("\x1b[36mBad_Name\x1b[39m");
    expect(formatter(false).formatError(userError)).toBe(`\nERROR\n  ${error.message}`);
  });

  it("leaves any other error to Effect's own formatting", () => {
    const other = new CliError.UserError({ cause: new Error("x"), userMessage: "plain words" });
    expect(formatter(false).formatError(other)).toBe("\nERROR\n  plain words");
  });
});
