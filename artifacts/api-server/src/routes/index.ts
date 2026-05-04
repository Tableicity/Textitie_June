import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tiersRouter from "./tiers";
import tenantsRouter from "./tenants";
import injectionsRouter from "./injections";
import webhooksRouter from "./webhooks";
import statsRouter from "./stats";
import complianceRouter from "./compliance";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tiersRouter);
router.use(tenantsRouter);
router.use(injectionsRouter);
router.use(webhooksRouter);
router.use(statsRouter);
router.use(complianceRouter);

export default router;
