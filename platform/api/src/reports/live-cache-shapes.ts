import {sourceAliases} from './source-map.js';
import {object,integer} from './normalize.js';
export function metricMap(value: unknown): Record<string, unknown> {
    const decoded = object(value);
    for (const key of ['tags_views', 'tags_video', 'views', 'videos', 'result', 'data', 'hour'])
        if (decoded[key] && typeof decoded[key] === 'object' && Object.values(object(decoded[key])).some(v => v !== null && typeof v === 'object')) return sourceAliases(object(decoded[key]));
    return sourceAliases(decoded);
}
export function hourlyPeak(value: unknown): number | null {
    const values = Object.values(object(value)).map(integer).filter((n): n is number => n !== null && n >= 0);
    return values.length ? Math.max(...values) : null;
}
