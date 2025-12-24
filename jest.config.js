module.exports = {
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/tests/jest.setup.js"],
  testMatch: ["**/tests/**/*.test.js"],
  testTimeout: 30000,
  transform: {
    "^.+\\.tsx?$": "<rootDir>/jest.transform.js",
  },
  moduleFileExtensions: ["ts", "tsx", "js", "json", "node"],
};
