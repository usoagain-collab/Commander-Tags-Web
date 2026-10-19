import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Same "@/..." shortcut as tsconfig.json, so modules that use it can be tested.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
