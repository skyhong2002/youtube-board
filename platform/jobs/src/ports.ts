/** Capture-only comparison interfaces. Actual runnable coverage lives in workflow-registry and per-workspace parity ledgers. */
export interface QuotaReservation { id: string; units: number; provider: 'youtube' | 'ai' }
export interface QuotaLedger { reserve(provider: QuotaReservation['provider'], units: number): Promise<QuotaReservation>; consumed(reservation: QuotaReservation): Promise<void>; fail(reservation: QuotaReservation, kind: 'quota-exceeded' | 'transient' | 'invalid'): Promise<void> }
export interface CapturedResponse { requestKey: string; observedAt: string; payload: unknown }
export interface CapturedResponseStore { get(requestKey: string): Promise<CapturedResponse | null> }
/** Shadow mode takes captured responses only; it has no network-capable provider port. */
export interface ShadowIngestion { compare(captured: CapturedResponse, expected: unknown): Promise<{ equal: boolean; differences: string[] }> }
export const implementedYoutubeWorkflows = ['youtube.videos.stats', 'youtube.live.poll', 'youtube.tag_videos.backfill'] as const;
