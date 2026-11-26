# Services, Layers, And Modules

Use this when defining service tags, module surfaces, layer implementations, runtime wiring, typed errors, or `Effect.fn` operation boundaries.

## Module Surface

Write service modules the way Effect's own packages do, for example
`@effect/ai-anthropic`'s `AnthropicClient.ts`: the shape is an interface named `Service`, the
tag is a class named after the module, `make` builds the implementation, and `layer` provides it.

```ts
// UserRepo.ts
export interface Service {
  readonly get: (id: UserId) => Effect.Effect<User, NotFound | PersistenceError>
}

export class UserRepo extends Context.Service<UserRepo, Service>()(
  "@app/UserRepo",
) {}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const get = Effect.fn("UserRepo.get")(function* (id: UserId) {
    // ...
  })

  return UserRepo.of({ get })
})

export const layer = Layer.effect(UserRepo, make)

export class NotFound extends Schema.TaggedError<NotFound>()(
  "UserRepo.NotFound",
  { id: UserId },
) {}
```

Consumers import the module as a namespace, so the tag reads `UserRepo.UserRepo` and the
rest of the surface `UserRepo.layer`, `UserRepo.NotFound`, `UserRepo.Service`.

```ts
import * as UserRepo from "./UserRepo.ts"

const program = Effect.gen(function* () {
  const repo = yield* UserRepo.UserRepo
  return yield* repo.get(id)
})
```

A package barrel relays each module as a namespace, as Effect's `index.ts` files do:

```ts
// index.ts
export * as UserRepo from "./UserRepo.ts"
```

Guidance:

- Name the module file and the tag class after the domain concept, `UserRepo.ts` and `class UserRepo`.
- Name the shape `Service`. A test double's richer shape extends it, as `TestService`.
- Check implementations with `Tag.of({ ... })`, which types the object against `Service` without a return annotation.
- Export `make` when the implementation is effectful, and build `layer` from it; take parameters as `make(options)` and `layer(options)`.
- Do not self-export a module's namespace from inside the module (`export * as UserRepo from "./UserRepo.ts"` at its bottom). Callers write `import * as UserRepo`, and the barrel does the relaying.
- Sibling modules import each other's module directly, not through their own package barrel.
- Export only intentional surface; keep local schemas, row codecs, helpers, and implementation details unexported.
- Do not introduce TypeScript `namespace` declarations for organization.

## Layer Constructors

Choose the layer constructor that matches the thing produced.

```ts
Layer.succeed(Service, impl)       // already-built service
Layer.sync(Service, () => impl)    // lazy synchronous service
Layer.effect(Service, makeEffect)  // effectful service acquisition
```

Guidance:

- Default real implementations to `Layer.effect(Service, Effect.gen(...))`.
- Use `Layer.effectContext(...)` when one acquisition intentionally supplies multiple services, especially first-class test stubs or one client backing several service tags.
- Use `Layer.unwrap(...)` when config or runtime discovery chooses/builds the layer.
- Use `Layer.fresh(...)` or `Effect.provide(layer, { local: true })` only when a test or operation needs isolated acquisition.
- Use `Context.Reference` rarely, only for ambient/defaultable runtime references where a safe default is real.

## Long-Lived Work

A layer that starts a stream, listener, worker, subscription, or forever loop must fork that work into the layer scope. Layer acquisition must complete.

```ts
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* Events.Events

    yield* events.stream.pipe(
      Stream.runForEach(handleEvent),
      Effect.forkScoped,
    )
  }),
)
```

Guidance:

- Use `Effect.forkScoped`, `FiberSet`, or `FiberMap` for scoped background work.
- Do not run forever work inline during layer acquisition.
- Do not expose public `start` methods unless the domain explicitly needs manual lifecycle control.

## Runtime Wiring

- Use `Layer.provide(...)` to hide an implementation dependency.
- Use `Layer.provideMerge(...)` only when the dependency should remain exposed for downstream consumers.
- Use `Layer.mergeAll(...)` for independent exposed layers.
- Prefer flat, topologically sorted runtime layer values with named subgraphs.
- Avoid using `provideMerge` as a blind make-it-compile tool.
- Avoid hiding important authority or lifecycle dependencies behind broad invisible provisioning.

## Effect.fn

Use extra `Effect.fn(...)` arguments for wrappers that apply to the whole function call. Each transform receives `(effect, ...originalArgs)`.

```ts
const readAttachment = Effect.fn("Attachment.read")(
  function* (ref: AttachmentRef) {
    return yield* api.read(ref)
  },
  (effect, ref) =>
    effect.pipe(
      attachmentError("Attachment.read", { attachmentId: ref.id }),
    ),
)
```

Good whole-function transforms:

- error classification
- localized recovery
- logging annotations
- spans
- retry
- timeout
- ensuring cleanup
- small local provisioning
- result mapping

Guidance:

- Keep the generator body focused on the core workflow.
- Use transforms when the wrapper needs original arguments.
- Do not build long clever pipelines; one or two transforms is usually enough.
- Do not use this for local branch-level handling inside the workflow.

## Operation Error Helpers

For boundary errors with operation labels, prefer a shared curried `mapError` helper over hand-writing wrappers in every module.

```ts
const persistenceError = operationError(PersistenceError.make)

const row = yield* query.pipe(
  persistenceError("UserRepository.findById"),
)
```

Name the local helper after the error it produces, such as `persistenceError`, `projectionError`, or `processingError`. Use `Effect.fn(...)` and spans for observability in addition to payload labels, not instead of them.
