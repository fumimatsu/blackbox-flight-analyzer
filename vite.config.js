import { defineConfig } from "vite";

const isGitHubPagesBuild =
  process.env.GITHUB_ACTIONS === "true" ||
  process.env.DEPLOY_TARGET === "github-pages";

export default defineConfig({
  base: isGitHubPagesBuild ? "/blackbox-flight-analyzer/" : "/",
  server: {
    host: "127.0.0.1",
    port: 5174,
  },
  build: {
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setupTests.js",
  },
});
