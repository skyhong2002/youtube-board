import {LEGACY_VIDEO_DEFAULTS,LEGACY_KEYWORD_VIDEO_DEFAULTS} from '../shared/legacy-redirects.ts';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const routesSource = await readFile(new URL('../../routes/web.php', import.meta.url), 'utf8');
const jobsSource = await readFile(new URL('../../config/ingestion.php', import.meta.url), 'utf8');
// This is a source declaration inventory, not Laravel's expanded route cache.
const routeMatches = [...routesSource.matchAll(/Route::(get|post|match)\((?:\[([^\]]+)\],\s*)?'([^']+)'/g)];
const routes = routeMatches.map((match, index) => {
  const body = routesSource.slice(match.index, routeMatches[index + 1]?.index ?? routesSource.length);
  return {
    methods: match[1] === 'match' ? [...match[2].matchAll(/'(\w+)'/g)].map(m => m[1]) : [match[1].toUpperCase()],
    path: match[3], name: body.match(/->name\('([^']+)'\)/)?.[1] ?? null,
    kind: body.includes('return redirect()') ? 'redirect' : match[3].startsWith('/api/') ? 'compatibility-api' : match[3].startsWith('/ops/') || match[3].startsWith('/dev/') ? 'operations' : match[3].startsWith('/redir/') || match[3].startsWith('/prompt/') ? 'write-guard' : 'report',
    sourceLine: routesSource.slice(0, match.index).split('\n').length,
    status: 'pending',
    ...(['/videos.php','/channel_videos.php','/ch/{u_id}/videos'].includes(match[3])?{replacementQueryDefaults:LEGACY_VIDEO_DEFAULTS}:match[3]==='/tag_video.php'?{replacementQueryDefaults:LEGACY_KEYWORD_VIDEO_DEFAULTS,discardedDisplayOnlyQuery:['hours']}:{}),
  };
});
const jobMatches = [...jobsSource.matchAll(/'key'\s*=>\s*'([^']+)'/g)];
const jobs = jobMatches.map((match, index) => {
  const body = jobsSource.slice(match.index, jobMatches[index + 1]?.index ?? jobsSource.length);
  const field = (name) => body.match(new RegExp(`'${name}'\\s*=>\\s*'([^']+)'`))?.[1] ?? null;
  return { key: match[1], command: field('modern_command'), schedule: field('schedule'), externalDependency: field('external_dependency'), status: 'pending' };
});
await mkdir(new URL('../inventory/', import.meta.url), { recursive: true });
await writeFile(new URL('../inventory/legacy.json', import.meta.url), JSON.stringify({ note: 'Generated source inventory. Pending is the default; implementation and acceptance are recorded separately in api/PARITY.md, api/LEGACY-PARITY.md and ingestion/CACHE-PARITY.md.', routes, jobs }, null, 2) + '\n');
console.log(JSON.stringify({ routeDeclarations: routes.length, jobDeclarations: jobs.length, kinds: Object.fromEntries([...new Set(routes.map(r => r.kind))].map(kind => [kind, routes.filter(r => r.kind === kind).length])) }));
