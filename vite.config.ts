import { defineConfig } from "vite-plus";
import * as MyConfigs from "@cam-mcevenue/vite-config";

export default defineConfig({
  fmt: MyConfigs.fmt,
  lint: MyConfigs.lintEffect,
  run: MyConfigs.run,
});
