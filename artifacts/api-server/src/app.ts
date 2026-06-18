import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { conductorAuth } from "./middleware/conductorAuth";
import { WebhookHandlers } from "./lib/stripeWebhookHandlers";

const app: Express = express();

// Stripe webhook MUST be registered before express.json() — it needs raw Buffer body
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature" });
      return;
    }
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err: any) {
      logger.error({ err }, "Stripe webhook error");
      res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

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
