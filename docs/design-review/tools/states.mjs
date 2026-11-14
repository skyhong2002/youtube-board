// Screenshot inventory for the design review. docs/design-review/states.md documents
// the same IDs; change both together and only between rounds that re-shoot the baseline.
//
// data:    normal | empty | error           (scenario applied to every /api/v1 read)
// loading: { from, click, match }           open `from` with normal data, make API paths
//          matching `match` hang, click the in-site link `click`, shoot while pending
// click:   selectors clicked in order after load      anchor: start the shot here
// theme:   light (default) | dark
export const SIZES = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, maxHeight: 2400 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, maxHeight: 1688, isMobile: true, hasTouch: true },
};

const LIVE = '/live/current?or=1,2,12,13,14,81';
const CHANNEL = '/channels/96';
export const AI_DATE = '2026-11-10';

export const STATES = [
  // Home
  { id: 'home', path: '/' },
  { id: 'home-dark', path: '/', theme: 'dark' },
  { id: 'home-today', path: '/', click: ['label:has(input[value="today"])'] },
  { id: 'home-empty', path: '/', data: 'empty' },
  { id: 'home-error', path: '/', data: 'error' },
  { id: 'home-loading', path: '/', loading: { from: LIVE, click: 'header a[href="/"]', match: '^/api/v1/home' } },
  // Keyword ranking
  { id: 'keywords', path: '/keywords' },
  { id: 'keywords-dark', path: '/keywords', theme: 'dark' },
  { id: 'keywords-today', path: '/keywords?window=today' },
  { id: 'keywords-empty', path: '/keywords', data: 'empty' },
  { id: 'keywords-error', path: '/keywords', data: 'error' },
  { id: 'keywords-loading', path: '/keywords', loading: { from: LIVE, click: 'header a[href="/keywords"]', match: '^/api/v1/home' } },
  // Live now
  { id: 'live', path: LIVE },
  { id: 'live-dark', path: LIVE, theme: 'dark' },
  { id: 'live-all', path: '/live/current' },
  { id: 'live-empty', path: LIVE, data: 'empty' },
  { id: 'live-error', path: LIVE, data: 'error' },
  { id: 'live-loading', path: LIVE, loading: { from: '/keywords', click: 'header a[href^="/live/current"]', match: '^/api/v1/live' } },
  // Channel profile
  { id: 'channel', path: CHANNEL },
  { id: 'channel-dark', path: CHANNEL, theme: 'dark' },
  { id: 'channel-videos', path: `${CHANNEL}/videos` },
  { id: 'channel-empty', path: CHANNEL, data: 'empty' },
  { id: 'channel-error', path: CHANNEL, data: 'error' },
  { id: 'channel-loading', path: CHANNEL, loading: { from: '/keywords', click: 'main a[href="/channels/96"]', match: '^/api/v1/channels/96' } },
  // Events: production /events and /events/:id redirect (307) to /ai/days, so the
  // daily AI issue list and one dated day stand for them.
  { id: 'events', path: '/ai/days' },
  { id: 'events-dark', path: '/ai/days', theme: 'dark' },
  { id: 'event-day', path: `/ai/days/${AI_DATE}` },
  { id: 'events-empty', path: '/ai/days', data: 'empty' },
  { id: 'events-error', path: '/ai/days', data: 'error' },
  { id: 'events-loading', path: '/ai/days', loading: { from: '/keywords', click: 'header a[href="/ai/days"]', match: '^/api/v1/ai/days' } },
];

// Reference sites: photographed once and reused in every round.
export const REFERENCES = [
  { id: 'playboard-channel', url: 'https://playboard.co/en/channel/UC2VmWn8dAqkzlQqvy02E1PA' },
  { id: 'google-trends', url: 'https://trends.google.com/trending?geo=TW&hl=zh-TW', locale: 'zh-TW' },
  { id: 'socialblade-channel', url: 'https://socialblade.com/youtube/channel/UC2VmWn8dAqkzlQqvy02E1PA' },
];

// Browser clock: the snapshot's evaluation time, so relative times never drift.
export const NOW = '2026-11-13T02:40:00+08:00';
