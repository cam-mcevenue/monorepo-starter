import { Context, Effect, Layer, Schema } from "effect";
import { format } from "./internal/format.ts";

/**
 * An example service, laid out as this repo writes one: an `Interface`, a
 * `Service` tag, a `layer`, typed errors, and the module re-exported as its own
 * namespace so callers write `Greeter.Service` and `Greeter.layer`. Replace it
 * with something real.
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

export interface Interface {
  readonly greet: (name: string) => Effect.Effect<string, EmptyName>;
}

export class Service extends Context.Service<Service, Interface>()("@repo/pkg-effect/Greeter") {}

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
export const layer = Layer.succeed(Service, Service.of({ greet }));

export * as Greeter from "./Greeter.ts";
