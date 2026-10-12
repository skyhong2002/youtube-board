# Read-only AI prompt previews

`/channels/:id/prompt`, `/ai/days/prompt`, `/ai/days/:date/prompt`, and
`/ai/days/:date/:condition/prompt` invoke the same `planAi` implementation used
by new AI generation through a private, parameterized SELECT-only adapter.
They expose the current prompt version, schema, source counts, source limit,
omissions, period and blocked reason. They make no provider requests or writes;
the output is a current-source preview, not a historical generation snapshot.

Supported scalar query keys are `date`, `from`, `to`, `type`, `condition` and
`limit`. Unknown keys, repeated values, invalid dates and conflicting route/query
date or condition values return 400 before source reads. Types are `oneday`,
`todate` and `week`. Daily conditions are `all`, `green`, `blue`, `neutral`,
`finance` and `world`; omitted or empty condition means `all`. Channel previews
reject condition because the channel planner scopes sources only by channel ID.

Legacy `tagid`, `or` and `not` return an explicit 400 migration message, including
when empty. They never silently widen the source scope. Operators must remove
these filters and intentionally select a supported condition; arbitrary legacy
taxonomy combinations are not equivalent to the new condition presets and are
not automatically mapped. The generator's writing contract remains unchanged.

An omitted daily period selects the latest non-deleted complete-day channel AI
source with the requested type, byte-exact `CLI` token and the planner's own
`conditionSql` taxonomy predicate. A newer record in another condition, lowercase
`cli`, deleted data or a multiday interval cannot move that anchor. This selects
eligible source rows; malformed/insufficient source events are still reported by
the planner as omissions or a blocked plan instead of silently searching older
content. A channel's omitted date uses its latest video publication date. With no
source date, the fallback is Taipei today and an empty plan remains visibly
blocked. Any explicit date/from/to suppresses latest lookup; a lone endpoint
denotes one complete day. Daily generation still requires exactly one complete
Taipei day, regardless of data-type label. Channel periods retain the planner's
31-day bound. Preview and execution both use the fixed `CLI` user scope.

Channel default/max source limits are 120/500; daily default/max is 1000.
Explicit invalid limits fail rather than clamp. A missing channel returns 404.

Validation: the focused prompt/history pure suites passed 20 tests; the new
prompt/hourly MariaDB suite passed 3 tests, and the existing expanded AI-history
MariaDB suite passed 9 tests. The SQL tests used only the isolated local fixture
database and cleaned their own rows. They cover condition-specific latest dates,
case-exact tokens, deleted/multiday exclusion, omitted versus explicit all,
empty sources, exact planner-query/prompt agreement, bounded limits and query
rejection. API typecheck passed before the final documentation update. No live
provider, production access or standalone Opus review was used for this stage.
