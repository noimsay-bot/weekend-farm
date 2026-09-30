import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "supabase/tests/**/*.test.ts"],
    testTimeout: 30000,
    // PGlite DB 생성(beforeAll)이 병렬 실행 시 느린 PC에서 10초를 넘는다
    hookTimeout: 60000,
  },
});
