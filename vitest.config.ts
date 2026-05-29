import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@bdta/domain": fileURLToPath(new URL("./packages/domain/src/index.ts", import.meta.url)),
      "@bdta/contracts": fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)),
      "@bdta/application": fileURLToPath(new URL("./packages/application/src/index.ts", import.meta.url)),
      "@bdta/infrastructure": fileURLToPath(new URL("./packages/infrastructure/src/index.ts", import.meta.url)),
      "@bdta/platform": fileURLToPath(new URL("./packages/platform/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.spec.ts"]
  }
});
