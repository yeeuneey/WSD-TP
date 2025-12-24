import express = require("express");
import cors = require("cors");
import helmet = require("helmet");
import * as fs from "fs";
import * as path from "path";
import { requestLogger } from "./middlewares/request-logger";
import { errorHandler } from "./middlewares/error-handler";
import routes from "./routes";
import { prisma } from "./config/db";

const app = express();

// 기본 보안 및 파서
app.use(cors());
app.use(helmet());
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
  res.type("html").send(swaggerHtml);
});

// 라우트 연결
app.use("/", routes);

// 에러 핸들러
app.use(errorHandler);

export default app;
