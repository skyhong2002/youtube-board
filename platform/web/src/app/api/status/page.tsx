import ApiTabs from '@/components/ApiTabs';
import { endpointSummaries } from '@/lib/api-docs';
import { loadApiDocs } from '@/lib/api-docs-source';
import { apiStatusMetadata } from '@/lib/seo';
import ApiStatusView from './ApiStatusView';

// HTML view of GET /api/status. The shell is static and never shared-cached (the proxy
// marks it private, no-store); availability is read by the browser with
// Accept: application/json and no-store, so this page never fetches itself.
export const metadata = apiStatusMetadata();

export default function ApiStatusPage() {
  const purposes = Object.fromEntries(endpointSummaries(loadApiDocs()));
  return (
    <div className="space-y-6">
      <ApiTabs current="status" />
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">API 狀態</h1>
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          只檢查公開 API 目前能否回應，不代表資料更新時間、收錄進度或上游來源狀態。
        </p>
      </header>
      <ApiStatusView purposes={purposes} />
    </div>
  );
}
