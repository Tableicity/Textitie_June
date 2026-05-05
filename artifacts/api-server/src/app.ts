import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { conductorAuth } from "./middleware/conductorAuth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        const rawUrl = req.url?.split("?")[0] ?? "";
        // Redact survey response tokens so they never appear in logs.
        const url = rawUrl.replace(/^(\/api)?\/s\/[^/?#]+/, "$1/s/[REDACTED]");
        return {
          id: req.id,
          method: req.method,
          url,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", conductorAuth, router);

export default app;
