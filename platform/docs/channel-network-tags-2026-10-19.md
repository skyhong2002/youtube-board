# Channel network tags (2026-10-19)

Context: the 母站作者 asked that the daily top events not be inflated by one source
appearing as many outlets. On the YouTube side the duplication is one network running
many channels (三立 has seven channels in the AI daily set, 旺中 six). Media roles for
news articles (新聞集合 → 平台代刊, 新聞合作) live on tag.observe.tw; none of those outlets
are in its fixed 43-media ranking basis.

## Data change (production `youtube_board`, approved by the user)

Backup first: `/home/ubuntu/backups/services/channel-tags-20261019T095105Z/urt-tag-tables.sql.gz`
(`urt_tag`, `urt_tag_log`, `urt_count`, `--lock-tables`, with SHA256SUMS).

New `urt_tag` rows, created 2026-10-19 17:51:27 Taipei:
109 中央社, 110 大愛, 111 原文會, 112 中嘉, 113 凱擘, 114 上報.

Channel assignments, each with an `urt_tag_log` `add` row in the legacy format
(`redir/tag.php`):

| Tag | Channels (u_id) |
|---|---|
| 109 中央社 | 1346 中央社, 528 攝影看世界 (posts 中央社即時影音), 2376, 3722, 1273 (CNA local desks) |
| 110 大愛 | 1389, 1146 |
| 111 原文會 | 1377, 2732, 472 |
| 112 中嘉 | 1761, 1505 |
| 113 凱擘 | 2177, 1796 |
| 114 上報 | 3571, 1155 |
| 85 UDN | 2921 聯合報 |
| 53 旺中 | 2047 工商時報 |
| 84 緯來 | 3135 緯來新聞網 |

All 39 AI daily channels (`ai/src/contracts.ts` `CHANNEL_IDS`) already carried a
network tag before this change; they fall into 15 networks.

Rollback: delete the six `urt_tag` rows, remove the `[id]` markers from the listed
`urt_count.tags`, and add `del` rows to `urt_tag_log`, or restore the three tables from
the backup in isolation and copy the rows back.

## Code change

`shared/channel-networks.ts` maps network tags to a network (precedence: 旺中 before
中視/中時; MCN tags excluded). `/ai/days` (and the home focus list that reads it) now
orders topics by `rankByNetworks`: topics confirmed by at least two networks first, then
videos + 3 × networks. Topics expose `networkCount` and `networks`; the page shows
「N 個媒體集團 · N 個頻道 · N 則影片」 and explains the rule in its method block.

On the 2026-10-18 daily data the top 10 barely moves (the AI prompt already requires 2–6
channels): 2 and 3 swap, 8 and 9 swap, and three single-network topics (old 11–13) drop below
cross-network ones.
