/** Only the public video thumbnail derivative is eligible for remote optimization. */
export const imageWidths = [48, 96, 160, 192, 320, 640] as const;
export function validImageOptimizationQuery(query: URLSearchParams): boolean {
  if ([...query.keys()].some(key => !['url', 'w', 'q'].includes(key))) return false;
  if (['url', 'w', 'q'].some(key => query.getAll(key).length !== 1)) return false;
  return /^https:\/\/i\.ytimg\.com\/vi\/[A-Za-z0-9_-]{11}\/mqdefault\.jpg$/.test(query.get('url') ?? '')
    && imageWidths.some(width => String(width) === query.get('w')) && query.get('q') === '75';
}
