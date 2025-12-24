const ts = require("typescript");
const path = require("path");

const tsconfigPath = path.resolve(__dirname, "tsconfig.json");
const { config, error } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
if (error) {
  throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
}
const parsed = ts.parseJsonConfigFileContent(
  config,
  ts.sys,
  path.dirname(tsconfigPath),
);
const compilerOptions = parsed.options;

module.exports = {
  process(src, filename) {
    if (filename.endsWith(".d.ts")) {
      return { code: "" };
    }

    const result = ts.transpileModule(src, {
      compilerOptions: {
        ...compilerOptions,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        sourceMap: true,
      },
      fileName: filename,
    });

    return {
      code: result.outputText,
      map: result.sourceMapText ?? undefined,
    };
  },
};
