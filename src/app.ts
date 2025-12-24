import express from "express";
import cors from "cors";
import helmet from "helmet";
import fs from "fs";
import path from "path";
import { requestLogger } from "./middlewares/request-logger";
import { errorHandler } from "./middlewares/error-handler";
import routes from "./routes";
import { prisma } from "./config/db";

const app = express();

app.use(cors());
// Allow external Swagger UI assets; keep other helmet protections.
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);
app.use(express.json());
app.use(requestLogger);

const openApiPath = path.resolve(process.cwd(), "docs", "openapi.json");
const openApiSpec = JSON.parse(fs.readFileSync(openApiPath, "utf-8"));
const swaggerHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>GoGoStudy API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #f5f5f5; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/docs.json",
        dom_id: "#swagger-ui"
      });
    </script>
  </body>
</html>`;

app.get("/health", (req, res) => {
  res.json({ status: "OK", service: "GoGoStudy API" });
});

app.get("/docs.json", (_req, res) => {
  res.json(openApiSpec);
});

app.get("/docs", (_req, res) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self' https: data:",
      "script-src 'self' 'unsafe-inline' https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://unpkg.com",
      "connect-src 'self' https://unpkg.com",
      "img-src 'self' data: https:",
      "font-src 'self' https: data:",
    ].join("; "),
  );
  res.type("html").send(swaggerHtml);
});

app.use("/", routes);

app.use(errorHandler);

export default app;
