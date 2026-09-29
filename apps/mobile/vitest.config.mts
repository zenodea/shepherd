import { defineConfig } from "vitest/config";

// Only plain-TypeScript modules are unit tested; screens need a device.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], testTimeout: 10_000 },
});
