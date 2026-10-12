import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decodeReportSegments, resolveRoute, reportFilterPath } from "./routes";
import { count, dateTime, youtubeUrl } from "./format";
test('date-editing forms leave path dates behind without decoding opaque person names again',()=>{
    for(const person of ['王小明','姓名%41','姓名/片段','姓名?type=tags_views']){
        const segments=['mayor','cities','taipei','people',person,'days','2026-10-11'],route=resolveRoute(segments)!;
        const path='/'+segments.map(encodeURIComponent).join('/'),target=reportFilterPath(path,route)!;
        assert.equal(target,'/mayor/cities/taipei/people/'+encodeURIComponent(person));
        const submitted=new URL(target+'?'+new URLSearchParams({date:'2026-10-10',type:'tags_video'}),'http://local');
        assert.equal(submitted.searchParams.get('type'),'tags_video');assert.equal(submitted.searchParams.get('date'),'2026-10-10');
        assert.equal(decodeReportSegments(submitted.pathname.split('/').filter(Boolean))?.[4],person);
    }
    assert.equal(reportFilterPath('/live/days/2026-10-11',{apiPath:'live/days/2026-10-11'}),'/live/days');
    assert.equal(reportFilterPath('/channels/8/ai/days/2026-10-11',{apiPath:'channels/8/ai/days',query:{date:'2026-10-11'}}),'/channels/8/ai/days');
    assert.equal(reportFilterPath('/mayor/cities/taipei/people/王小明',{apiPath:'mayor/cities/taipei/people/王小明'}),undefined);
});
test("unrecognized report paths return 404 rather than a misleading migration screen", () => {
    for (const path of [
        "arbitrary",
        "channels/12/ai/not-a-report",
        "live/walls/arbitrary",
        "tags/not-a-number/channels",
    ])
        assert.equal(resolveRoute(path.split("/")), null, path);
});
test("legacy daily URL resolves to the same API with explicit date and condition", () => {
    const route = resolveRoute(["ai", "days", "2026-10-10", "media"]);
    assert.equal(route?.kind, "ai-days");
    assert.equal(route?.apiPath, "ai/days");
    assert.equal(route?.id, "2026-10-10");
    assert.equal(route?.condition, "media");
});
test("case-sensitive video identifiers remain intact", () => {
    assert.equal(resolveRoute(["videos", "AbC_123xYz9"])?.id, "AbC_123xYz9");
});
test("missing observations stay missing and public links allow only YouTube HTTPS", () => {
    assert.equal(count(null), "—");
    assert.equal(count(0), "0");
    assert.equal(dateTime(null), "未記錄");
    assert.equal(
        youtubeUrl("https://www.youtube.com/watch?v=AbC"),
        "https://www.youtube.com/watch?v=AbC",
    );
    assert.equal(youtubeUrl("https://youtube.com.invalid/watch"), undefined);
    assert.equal(youtubeUrl("javascript:alert(1)"), undefined);
});

test("channel daily aliases preserve the path date while using the canonical API", () => {
    const route = resolveRoute(["channels", "990001", "ai", "days", "2026-10-11"]);
    assert.equal(route?.apiPath, "channels/990001/ai/days");
    assert.deepEqual(route?.query, { date: "2026-10-11" });
});

test("daily topic identifiers are separated from AI event primary keys", () => {
    assert.equal(resolveRoute(["ai", "days", "990001", "events"])?.apiPath, "ai/days/990001/events");
    assert.equal(resolveRoute(["ai", "events", "990001"])?.apiPath, "ai/events/990001");
});

test("analytics uses its dedicated report and rejects invalid parameters before streaming", async () => {
    const { reportRequestStatus } = await import("./request-status");
    assert.equal(resolveRoute(["videos", "AbC_123xYz9", "analytics"])?.kind, "video-analytics");
    assert.equal(reportRequestStatus(new URL("http://localhost/videos/AbC_123xYz9/analytics")), null);
    for (const suffix of ['?limit=0','?limit=201','?limit=abc','?limit=1&limit=2'])
        assert.equal(reportRequestStatus(new URL("http://localhost/videos/AbC_123xYz9/analytics"+suffix))?.status, 400);
    assert.equal(reportRequestStatus(new URL("http://localhost/videos/bad!/analytics"))?.status, 400);
    assert.equal(reportRequestStatus(new URL("http://localhost/boards/view?q=" + "a".repeat(101)))?.status, 400);
    assert.equal(reportRequestStatus(new URL("http://localhost/boards/view?q=" + "a".repeat(100))), null);
});

test('implemented wall and prompt pages select dedicated renderers',()=>{
    assert.equal(resolveRoute(['tags','videos'])?.kind,'videos');
    assert.equal(resolveRoute(['live','walls','news'])?.kind,'live-wall');
    assert.equal(resolveRoute(['ai','events','1','wall'])?.kind,'live-wall');
    assert.equal(resolveRoute(['channels','1','prompt'])?.kind,'prompt-preview');
    assert.equal(resolveRoute(['ai','days','2026-10-11','blue','prompt'])?.kind,'prompt-preview');
    assert.equal(resolveRoute(['ai','days','2026-10-11','blue','prompt'])?.apiPath,'ai/days/2026-10-11/blue/prompt');
});

test("AI event history uses its bounded source report",()=>{assert.equal(resolveRoute(["ai","events","123","history"])?.kind,"extended");});

test('video list limits and filters reject invalid input before streaming while detail limits stay200',async()=>{const {reportRequestStatus}=await import('./request-status');for(const path of ['/videos','/tags/8/videos','/channels/8/videos','/keywords/AI/videos']){assert.equal(reportRequestStatus(new URL('http://localhost'+path+'?limit=1000')),null);for(const suffix of ['?limit=','?offset=','?from=2034-07-02&to=2034-07-01','?limit=1001','?hours=0','?hours=bad','?min=-1','?column=bad','?from=2036-02-30','?limit=2&limit=3'])assert.equal(reportRequestStatus(new URL('http://localhost'+path+suffix))?.status,400);}assert.equal(reportRequestStatus(new URL('http://localhost/keywords/AI/videos?days=91'))?.status,400);});


test('Next encoded catchall values decode once before titles, API paths and form links',()=>{
    for(const term of ['交通','交通 ','100%','%41','%E4%BA%A4','A/B','臺灣 🗳️']){
        const encoded=['keywords',encodeURIComponent(term),'videos'];
        const segments=decodeReportSegments(encoded)!;
        assert.equal(segments[1],term);
        const route=resolveRoute(segments)!;
        assert.equal(route.id,term);
        assert.equal(route.title,`「${term}」的影片`);
        assert.equal(route.apiPath,encoded.join('/'));
        const daily=resolveRoute([segments[0],segments[1],'days'])!;
        assert.equal(daily.kind,'extended');
        assert.equal(daily.apiPath,`keywords/${encodeURIComponent(term)}/days`);
    }
    assert.equal(decodeReportSegments(['keywords','%E4%ZZ','days']),null);
    assert.equal(decodeReportSegments(['keywords','%','days']),null);
    assert.deepEqual(decodeReportSegments(['videos','AbC_123xYz9']),['videos','AbC_123xYz9']);
    // Existing callers already supply decoded data and must never be decoded again.
    assert.equal(resolveRoute(['keywords','%41','videos'])?.id,'%41');
});


test('pinned Next page parameter contract remains encoded and preserves literal percent terms',async()=>{
    const {getDynamicParam}=await import('next/dist/shared/lib/router/utils/get-dynamic-param.js');
    const decoded=['keywords','%41','videos'];
    const pageParams=getDynamicParam({segments:decoded},'segments','c',null,null).value;
    assert.deepEqual(pageParams,['keywords','%2541','videos']);
    assert.deepEqual(decodeReportSegments(pageParams as string[]),decoded);
    assert.equal(resolveRoute(decoded)?.title,'「%41」的影片');
    for(const invalid of ['', '.', '..'])assert.equal(decodeReportSegments(['keywords',invalid,'days']),null);
});
