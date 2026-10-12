/** Read models over the preserved baseline. No schema pushes against the legacy database. */
import { mysqlTable, int, varchar, datetime, text, bigint } from 'drizzle-orm/mysql-core';
const timestamp = (name: string) => datetime(name, { mode: 'string' });
export const channels = mysqlTable('urt_channel', {
    id: int('u_id').primaryKey(), youtubeId: varchar('youtube_id', { length: 32 }).notNull(),
    title: varchar('title', { length: 256 }), description: text('description'),
    thumbnail: varchar('thumbnails', { length: 256 }), updatedAt: timestamp('mtime'), capturedAt: timestamp('stime'),
});
export const videos = mysqlTable('urt_video', {
    pk: int('pk').primaryKey(), id: varchar('videoId', { length: 32 }).notNull(),
    channelId: int('u_id').notNull(), title: varchar('title', { length: 512 }).notNull(),
    publishedAt: timestamp('publishedAt').notNull(), updatedAt: timestamp('mtime'),
    views: bigint('viewCount', { mode: 'number' }),
});
export const channelTags = mysqlTable('urt_tag', {
    id: int('tag_id').primaryKey(), name: varchar('tag_name', { length: 64 }).notNull(),
});
