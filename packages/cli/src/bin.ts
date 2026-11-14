import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { cli } from "./index.ts";
import * as Output from "./internal/output.ts";
import * as Toolchain from "./Toolchain.ts";
import * as Workspace from "./Workspace.ts";

/** The workspace over the real toolchain, with the Node services `Command.run` also needs kept exposed. */
const MainLive = Layer.merge(
  Workspace.layer.pipe(Layer.provide(Toolchain.layer)),
  Output.layer,
).pipe(Layer.provideMerge(NodeServices.layer));

Command.run(cli, { version: "0.0.0" }).pipe(Effect.provide(MainLive), NodeRuntime.runMain);
