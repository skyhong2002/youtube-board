import { registerEditorialOps, type EditorialOptions } from './editorial.js';
import { registerWorkflowOps } from './workflows.js';
import type { FastifyInstance } from 'fastify';
import { registerIngestionOps, type IngestionOpsOptions } from './ingestion.js';
import { registerDeployOps, type DeployOpsOptions } from './deploy.js';
export async function registerOps(app: FastifyInstance, options: IngestionOpsOptions & DeployOpsOptions & EditorialOptions = {}) {
  await registerIngestionOps(app, options);
  await registerDeployOps(app, options);
  await registerWorkflowOps(app, options);
  await registerEditorialOps(app, options);
}
