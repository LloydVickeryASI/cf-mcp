import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [],
  test: {
    environment: "node", // Use Node environment for now
    // setupFiles: ["./tests/setup/vitest.setup.ts"], // Disabled for unit tests
    include: ["tests/unit/**/*.{spec,test}.ts"], // Only unit tests for now
    globals: true, // Enable global APIs like describe, it, expect
    
    // Coverage configuration with v8 instrumentation
    coverage: {
      provider: "v8", // Native instrumentation via c8
      reporter: ["text", "html", "lcov"],
      all: true, // Include untouched files
      exclude: [
        "tests/**", 
        "src/tools/**/generated/**",
        "node_modules/**",
        "dist/**",
        "coverage/**",
        "*.config.*",
        "wrangler.jsonc"
      ],
      reportsDirectory: "coverage",
      statements: 85,
      branches: 80,
      functions: 85,
      lines: 85 // Fail run if below thresholds
    },

    // Test timeout configuration
    testTimeout: 30000, // 30 seconds for integration tests
    hookTimeout: 10000, // 10 seconds for setup/teardown
    
    // Environment variables for tests
    env: {
      NODE_ENV: "test"
    }
  },

  // Resolve configuration for better module resolution
  resolve: {
    alias: {
      "@config": "./src/config",
      "@tools": "./src/tools",
      "@auth": "./src/auth",
      "@middleware": "./src/middleware",
      "@types": "./src/types"
    }
  }
});