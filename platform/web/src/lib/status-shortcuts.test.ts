import assert from 'node:assert/strict';
import test from 'node:test';
import { statusShortcuts } from '../components/StatusShortcuts';

test('status shortcuts never suggest the section the reader is already in', () => {
    const labels = (path: string | null) => statusShortcuts(path).map((item) => item.label);
    assert.deepEqual(labels('/'), ['熱門標籤排行', '即時直播', '每日公共議題', '頻道來源']);
    assert.deepEqual(labels(null), ['熱門標籤排行', '即時直播', '每日公共議題', '頻道來源']);
    assert.deepEqual(labels('/live/current'), ['熱門標籤排行', '每日公共議題', '頻道來源', '最新影片']);
    assert.deepEqual(labels('/channels/96/videos'), ['熱門標籤排行', '即時直播', '每日公共議題', '最新影片']);
    assert.deepEqual(labels('/ai/days/2026-11-10'), ['熱門標籤排行', '即時直播', '頻道來源', '最新影片']);
});
