import { defineConfig } from "vite-plus";
import * as path from "node:path";
import lint from "./oxlint.config.ts";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@repo\/cli\/(.*)$/,
        replacement: path.resolve(import.meta.dirname, "packages/cli/src/$1.ts"),
      },
    ],
  },
  fmt: {
    ignorePatterns: ["**/*.md"],
  },
  lint,
  run: {
    cache: true,
    tasks: {
      // Interactive tasks must not be cached: the task runner captures output
      // instead of attaching a TTY, so prompts print and then exit immediately.
      cli: { command: "vpx packages/cli/src/bin.ts", cache: false },
      // Vendored skills from cam-mcevenue/skills, tracked in skills-lock.json.
      // Edit a skill upstream and pull it in: an update overwrites local edits.
      skills: { command: "DISABLE_TELEMETRY=1 vpx skills@1.9.0", cache: false },
    },
  },
});
