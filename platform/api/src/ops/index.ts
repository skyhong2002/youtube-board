import { registerEditorialOps, type EditorialOptions } from './editorial.js';
import {registerKeywordReviewOps,type KeywordReviewOptions} from '../keyword-review/routes.js';
import {configuredKeywordReviewRepository} from '../keyword-review/config.js';
import { registerWorkflowOps } from './workflows.js';
import type { FastifyInstance } from 'fastify';
import { registerIngestionOps, type IngestionOpsOptions } from './ingestion.js';
import { registerDeployOps, type DeployOpsOptions } from './deploy.js';
export async function registerOps(app: FastifyInstance, options: IngestionOpsOptions & DeployOpsOptions & EditorialOptions & KeywordReviewOptions = {}) {
  await registerIngestionOps(app, options);
  await registerDeployOps(app, options);
  await registerWorkflowOps(app, options);
  await registerEditorialOps(app, options);
  await registerKeywordReviewOps(app,{...options,keywordReviewRepository:options.keywordReviewRepository??configuredKeywordReviewRepository(options.env??process.env)});
}
