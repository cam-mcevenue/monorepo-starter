import { Context, Effect, Layer, Schema } from "effect";
import { format } from "./internal/format.ts";

/**
 * An example service, laid out the way Effect's own packages write one: the
 * `Service` interface, a `Greeter` tag named after the module, a `layer`, and
 * typed errors. `index.ts` re-exports the module as a namespace, so callers
 * write `Greeter.Greeter` and `Greeter.layer`. Replace it with something real.
 */

/** There was nobody to greet. */
export class EmptyName extends Schema.TaggedError<EmptyName, { readonly brand: unique symbol }>()(
  "EmptyName",
  { input: Schema.String },
) {
  override get message() {
    return `Cannot greet ${JSON.stringify(this.input)}: the name is empty`;
  }
}

export interface Service {
  readonly greet: (name: string) => Effect.Effect<string, EmptyName>;
}

export class Greeter extends Context.Service<Greeter, Service>()("@repo/pkg-effect/Greeter") {}

const greet = Effect.fn("Greeter.greet")(function* (name: string) {
  const trimmed = name.trim();
  if (trimmed === "") {
    return yield* new EmptyName({ input: name });
  }
  return format(trimmed);
});

/**
 * Needs nothing, so it is already built. Once the service depends on others,
 * switch to `Layer.effect(Service, Effect.gen(...))` and yield them there.
 */
export const layer = Layer.succeed(Greeter, Greeter.of({ greet }));
