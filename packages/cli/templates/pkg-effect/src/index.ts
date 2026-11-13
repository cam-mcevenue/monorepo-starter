import { Effect } from "effect";
import { format } from "./internal/greeting.ts";

/**
 * The public API of this package. Replace it with something real.
 */
export const greet = (name: string): Effect.Effect<string> => Effect.sync(() => format(name));
