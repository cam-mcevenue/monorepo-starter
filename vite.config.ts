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
      // Effect 4 marks effect/cli, FileSystem, Path and friends as unstable.
      // This repo builds on them deliberately, so the warning is noise.
      "effecttsgo/unstable-api-usage": "off",
    },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
