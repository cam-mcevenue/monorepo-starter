import { recommended } from "@effect/tsgo/oxlint-presets";
import type { OxlintConfig } from "vite-plus/lint";

/**
 * The one lint config. `vite.config.ts` imports it for `vpr check`, and editors
 * read it directly. The Effect rules need the Effect-patched Oxlint binding,
 * which `effect-tsgo` loads: the scripts run `effect-tsgo vp`, and
 * `.zed/settings.json` starts the language server as `effect-tsgo oxlint --lsp`.
 */
export default {
  extends: [recommended],
  jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
  rules: {
    "vite-plus/prefer-vite-plus-imports": "error",
    // Owned here rather than in tsconfig: this is what Oxlint reads.
    "effecttsgo/effect-fn-opportunity": "error",
  },
  options: { typeAware: true, typeCheck: true },
} satisfies OxlintConfig;
