import {registerOps} from './ops/index.js';
import {registerAuth} from './auth/index.js';
import {registerReaderAccounts} from './reader/routes.js';
import { buildApp } from './app.js';
import {frontendDatabases} from './db/frontend.js';
const databases=frontendDatabases(process.env);
const app = buildApp();
const auth=await registerAuth(app,{databaseUrl:databases.auth,env:{...process.env,DATABASE_URL:databases.auth}});
await registerReaderAccounts(app,auth,{databaseUrl:databases.auth});
await registerOps(app,{auth});
const port = Number(process.env.PORT ?? 4100);
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port });
console.log(`YouTube Board API listening on port ${port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => void app.close().then(() => process.exit(0)));
