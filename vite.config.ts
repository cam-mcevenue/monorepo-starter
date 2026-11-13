import { defineConfig } from "vite-plus";
import { recommended } from "@effect/tsgo/oxlint-presets";

export default defineConfig({
  fmt: {
    ignorePatterns: ["**/*.md"],
  },
  lint: {
    extends: [recommended],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      // Owned here rather than in tsconfig: this is what vpr check reads.
      "effecttsgo/effect-fn-opportunity": "error",
    },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
    tasks: {
      // Interactive tasks must not be cached: the task runner captures output
      // instead of attaching a TTY, so prompts print and then exit immediately.
      cli: { command: "vpx packages/cli/src/bin.ts", cache: false },
      skills: { command: "DISABLE_TELEMETRY=1 vpx skills@latest", cache: false },
    },
  },
});
