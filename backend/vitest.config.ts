import "dotenv/config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    // Test files share one real Postgres database and some global reference
    // rows (Grade/Bin/Currency upserts), so cross-file parallelism causes
    // genuine SERIALIZABLE conflicts unrelated to the business logic being
    // tested. Intentional in-test concurrency (acceptance test #7) still
    // runs its parallel calls within a single file/worker.
    fileParallelism: false,
  },
});
