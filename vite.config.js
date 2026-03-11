export default {
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
};
