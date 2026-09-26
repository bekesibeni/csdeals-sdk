// .mjs, not .ts, on purpose. Consumers install this from GitHub, so pnpm runs `prepare` inside
// an isolated clone that lives UNDER node_modules - and Node refuses to strip types from any
// file on that path, so a .ts config aborts the consumer's install with ERR_PNPM_PREPARE_PACKAGE.
// Plain JS loads anywhere. Matches @assetpay/contracts.
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2025",
  platform: "node",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["@benji/stdlib"],
});
