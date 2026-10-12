import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { Reader } from '../db/client.js';
import { liveReport } from './live.js';
import { tagReport } from './tags.js';
import { cloudReport } from './cloud.js';
import { channelReport } from './channel.js';
import { aiReport } from './ai.js';
import { int, str, txt, type Q } from './common.js';
const live = ['api_live_day', 'api_live_date', 'api_live_hour', 'api_live_tag_date', 'live_date', 'live_tvbs', 'video_live', 'csv_live_line'];
const tags = ['tags_list', 'tags_index', 'tags_all', 'video_tags', 'video_tags_title', 'channels_list', 'channel_videos', 'channels_videos', 'api_tag', 'api_tag_log', 'tags_day', 'tags_video', 'tags_relation_date', 'tag_month', 'tag_period', 'tag_tags_days'];
const cloud = ['cloud', 'cloud_tag_date', 'cloud_tag_date_noapi', 'group_view'];
const channels = ['api_channel_log', 'channel_pred'];
const ai = ['ai_day', 'api_topic', 'api_event', 'api_comment'];
export const legacyApiPaths = [...live, ...tags, ...cloud, ...channels, ...ai, 'api_duration', 'api_get_photo'].map(n => '/api/' + n + '.php');
/** PHP query arrays are supported only for the legacy cache selectors. */
function query(url: string): Q {
    const q: Q = Object.create(null), params = new URL(url, 'http://local').searchParams;
    for (const [k, v] of params) {
        const a = /^(tagid|or|not)\[(?:\d*)\]$/.exec(k);
        if (a) {
            const key = a[1]!;
            if (!Array.isArray(q[key]))
                q[key] = [];
            (q[key] as string[]).push(v);
        }
        else if (!k.includes('['))
            q[k.replace(/[ .]/g, '_')] = v;
    }
    return q;
}
/** PHP associative arrays become lists only when keys are consecutive integers. */
export function phpCollections(value: unknown): unknown {
    if (Array.isArray(value))
        return value.map(phpCollections);
    if (!value || typeof value !== 'object')
        return value;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length && entries.every(([key], index) => key === String(index)))
        return entries.map(([, v]) => phpCollections(v));
    return Object.fromEntries(entries.map(([key, v]) => [key, phpCollections(v)]));
}
export function registerLegacyApi(app: FastifyInstance, db: Reader, clock: () => Date, dataset = 'unknown') {
    for (const path of legacyApiPaths)
        app.get(path, { preSerialization: async (_request, _reply, value) => phpCollections(value) }, async (req, reply) => {
            const name = path.slice(5, -4), q = query(req.url), now = clock();
            reply.header('Cache-Control', 'no-store').header('X-Youtube-Board-Dataset', dataset);
            if (!live.includes(name)) {
                reply.header('Access-Control-Allow-Origin', '*').header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS').header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
            }
            if (name === 'api_duration') {
                const id = txt(q, 'videoId', 'xotRiUF93-M'), r = (await db.rows(sql `SELECT duration FROM urt_video_duration WHERE BINARY videoId=BINARY ${id} LIMIT 1`))[0];
                return reply.type('text/plain; charset=UTF-8').header('X-Youtube-Board-Data-Source', 'true').send(String(Math.max(0, int(r?.duration))));
            }
            if (name === 'api_get_photo') {
                const tag = txt(q, 'tag', '柯文哲'), r = (await db.rows(sql `SELECT image_url FROM urt_show_photo WHERE tag LIKE ${tag} ORDER BY pk DESC LIMIT 1`))[0], url = str(r?.image_url);
                return reply.type('text/plain; charset=UTF-8').header('X-Youtube-Board-Data-Source', 'true').send(url.length > 5 ? url : 'null');
            }
            if (live.includes(name)) {
                if (name === 'video_live')
                    reply.type('text/html; charset=UTF-8');
                if (name === 'csv_live_line')
                    reply.type('text/csv; charset=UTF-8').header('Content-Disposition', 'attachment;filename=' + (txt(q, 'videoId', 'quwqlazU-c8').replace(/[^A-Za-z0-9_-]/g, '') || 'quwqlazU-c8') + '.csv');
                return liveReport(db, name, q, now);
            }
            if (tags.includes(name))
                return tagReport(db, name, q, now);
            if (cloud.includes(name))
                return cloudReport(db, name, q, now);
            if (channels.includes(name))
                return channelReport(db, q, now, name === 'channel_pred');
            return aiReport(db, name, q, now);
        });
}
