import express from "express";
import cors from "cors";
import helmet from "helmet";
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

app.get("/health", (req, res) => {
  res.json({ status: "OK", service: "GoGoStudy API" });
});

// 라우트 연결
app.use("/", routes);

// 에러 핸들러
app.use(errorHandler);

export default app;