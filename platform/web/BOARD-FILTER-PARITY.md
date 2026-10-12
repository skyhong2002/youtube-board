# Personal board scope

`/boards` creates browser-local boards. `/boards?keyword=…` prepopulates the
exact maintained label selected from 新文易數; the editor keeps this separate
from YouTube **頻道分類** and **影片文字搜尋**. This is the same evidence-based
`keyword` filter supported by the videos API, not a new text-match shortcut.

The editor uses the shared named channel and taxonomy pickers. Optional filters
are `channelIds`, `tagid` (all), `or` (any), `not` (exclude), `from`, `to`, `keyword`
and `q`. All dimensions intersect. Dates are inclusive video publication dates
in Asia/Taipei, not observation dates. `name` labels a board/feed only and is
never forwarded to the API. The shared board displays evidence coverage when a
maintained label is selected, including stale and unprocessed source videos.

`parseBoardRequest` validates form submissions, shared pages, the HTTP status
proxy (both `/boards` and `/boards/view`) and RSS before fetching videos. Malformed/repeated scalar filters,
reversed/invalid dates and unknown parameters fail closed. `q` allows 100
characters, `keyword` 240; the exact case and Unicode spelling of the latter
roundtrips without trimming or normalization. Next's `_rsc` transport parameter
is ignored. Shared links, pagination, RSS and the return-to-editor link keep
all selected dimensions. RSS subscribes to the first 100 matching videos;
shared page pagination uses 50. An explicit RSS offset is validated and honored.

The `youtube-board.boards.v1` key remains unchanged. Old channel/query-only
objects and URLs are accepted, including the old comma/space/full-width-comma
channel syntax. Invalid, partially readable and unknown future storage formats
remain protected from overwrite. Saving leaves the form/picker state intact.

Verification: 26 focused board/feed/routes tests and web typecheck passed.
Native browser verification exercised named channel and category selection,
create/share/open/return-to-editor, and no horizontal overflow at 390 or 1440
CSS pixels. The HTTP development origin used the visible copy-URL fallback.
HTTP board/RSS checks returned 400 for malformed, repeated or reversed filters.
RSS IDs matched API IDs for unfiltered, category inclusion/exclusion,
channel/date and maintained-label scopes against existing fixture data.
No database mutation was needed. Detailed local evidence is in
`.local/reviews/board-filters-verify.md` (ignored).
