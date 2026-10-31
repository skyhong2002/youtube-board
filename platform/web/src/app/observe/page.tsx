import { api, type Search } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import SiteObservationView from '@/components/SiteObservationView';
import type { SiteObservation } from '../../../../api/src/reports/site-observation';
import { DEFAULT_OBSERVATION_DAYS, OBSERVATION_DAYS, type ObservationDays } from '../../../../shared/site-analytics';

// 本站流量: /api/v1/site-observation (60 s public cache), rendered per request because ?days selects the period.
export const dynamic = 'force-dynamic';
export const metadata = pageMetadata({
  title: '本站流量',
  description: '有影儀表板的公開流量：每日瀏覽、讀者關注的影片與頻道、來源管道、Google 搜尋表現與真實使用體驗。',
  path: '/observe',
});

const daysOf = (search: Search): ObservationDays => {
  const value = Number(search.days);
  return (OBSERVATION_DAYS as readonly number[]).includes(value) ? (value as ObservationDays) : DEFAULT_OBSERVATION_DAYS;
};

export default async function ObservePage({ searchParams }: { searchParams: Promise<Search> }) {
  const days = daysOf(await searchParams);
  const result = await api<SiteObservation>('site-observation', days === DEFAULT_OBSERVATION_DAYS ? {} : { days: String(days) });
  return <SiteObservationView data={result.ok ? result.response.data : null} days={days} />;
}
