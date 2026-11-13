# Errors

One tagged error per module, and a helper that collapses library failures into it. The working
example is `packages/cli/src/internal/scaffold.ts`: read `ScaffoldError` and `orFail` there.
It is the live code rather than a copy, so it cannot drift from what the lint rules accept.

```ts
export class ScaffoldError extends Data.TaggedError("ScaffoldError")<{
  readonly message: string;
}> {}
```

The error channel should name the step that failed, not the mechanism. A signature carrying
`PlatformError` tells the caller a filesystem call failed somewhere; one carrying
`ScaffoldError` with `Failed to read the templates directory` tells them what to fix.

## Two rules enforce this

`effecttsgo(missing-effect-error)` fires when a library error reaches a signature that does not
declare it. Mapping some calls and forgetting one is the usual cause, and the giveaway is a
declared return type that no longer matches, reported as `TS2375`.

`typescript(restrict-template-expressions)` fires on interpolating an error object into a
string. `PlatformError` has a `message` getter, so build the text from `cause.message` rather
than from `${cause}`.

## Functions returning Effect

`effecttsgo/effect-fn-opportunity` is `"error"` in the `lint` block of `vite.config.ts`, so a
function written as an arrow returning `Effect.gen` fails `vpr check`. Write it as
`Effect.fnUntraced(function* (...) {})`.

Which form the rule names comes from `effectFn: ["untraced"]` in the tsconfig plugin block, and
that option is required: without it the rule never fires at all, however its severity is set.
