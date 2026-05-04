import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import tenantAuthRouter from "./tenantAuth";
import tiersRouter from "./tiers";
import tenantsRouter from "./tenants";
import injectionsRouter from "./injections";
import webhooksRouter from "./webhooks";
import statsRouter from "./stats";
import complianceRouter from "./compliance";
import conversationsRouter from "./conversations";
import departmentsRouter from "./departments";
import phoneNumbersRouter from "./phoneNumbers";
import agentsRouter from "./agents";
import billingRouter from "./billing";
import automationsRouter from "./automations";
import shortcutsRouter from "./shortcuts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(tenantAuthRouter);
router.use(tiersRouter);
router.use(tenantsRouter);
router.use(injectionsRouter);
router.use(webhooksRouter);
router.use(statsRouter);
router.use(complianceRouter);
router.use(conversationsRouter);
router.use(departmentsRouter);
router.use(phoneNumbersRouter);
router.use(agentsRouter);
router.use(billingRouter);
router.use(automationsRouter);
router.use(shortcutsRouter);

export default router;
