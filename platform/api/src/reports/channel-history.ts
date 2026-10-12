import { channelTrends } from './channel-trends.js';
import { channelAiOverview,channelAiDays,channelPeople } from './channel-ai.js';
import type { Reader } from '../db/client.js';
import { positiveId } from './query.js';
import type { Register } from './table.js';
export function registerChannelHistory(register: Register, reader: Reader, clock: () => Date) {
    register('/channels/:id/trends', (p,q) => channelTrends(reader, positiveId(p.id), q, clock));
    register('/channels/:id/ai', (p,q,identity) => channelAiOverview(reader,positiveId(p.id),q,identity));
    register('/channels/:id/ai/days', (p,q,identity) => channelAiDays(reader,positiveId(p.id),q,identity));
    register('/channels/:id/people', (p,q,identity) => channelPeople(reader,positiveId(p.id),q,identity));
}
