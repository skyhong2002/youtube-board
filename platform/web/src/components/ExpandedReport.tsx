import {ComparisonControls} from './ComparisonControls';
import {FilterPicker} from './FilterPicker';
import {familyTabs} from '@/lib/report-navigation';
import {ObservationValue} from './ObservationValue';
import {ReportTable} from './ReportTable';
import {ReportWordCloud} from './ReportWordCloud';
import {reportStyle as ui} from '@/lib/report-styles';
import {liveCoverageNotes} from './LiveCoverageNotice';
import {ReportMethod} from './ReportMethod';
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, rejectMalformedPayload, type Search } from "@/lib/api";
import { count } from "@/lib/format";
import {
    type ReportData,
    safeReportHref,
    reportLinkPrefetch,
} from "@/lib/report-contract";
import {
    Heading,
    DataNotice,
    Unavailable,
    Empty,
    Metric,
    Pagination,
    SectionHeading,
    Tabs,
} from "./ReportUI";
import { TimeChart } from "./Charts";
import { SeriesCompareChart } from "./SeriesCompareChart";
import { compareOnOneAxis, COMPARE_MAX_ENCODED, encodeOnOneAxis } from "@/lib/series-compare";
import { Suspense } from "react";
import { MayorShare, MayorShareLive, MayorSwitcher, MayorSwitcherLive } from "./MayorShare";
import { searchView } from "@/lib/mayor-view";
import { cities } from "../../../shared/city-definitions";
// Sections with this many columns or fewer are term/value lists: bounded width and a row preview.
const NARROW_SECTION_COLUMNS = 3, SECTION_PREVIEW_ROWS = 30;
// Rows past the preview (n+31 = SECTION_PREVIEW_ROWS + 1) are hidden until the toggle after the table opens; important beats the
// phone stacking rule (.table-stack tr), which is unlayered CSS.
const sectionPreview = "[&:not(:has(details[open]))_tbody>tr:nth-child(n+31)]:hidden!";
// Coverage bookkeeping (cache days per group and date, source coverage) backs the figures above;
// it opens on request instead of filling the page between the charts and the data.
// The channel AI report's provenance tables (source records, cited videos) are audit detail:
// they follow the AI summaries, folded, instead of standing between the reader and them.
const provenanceSection = (section: { key?: string }) => section.key === "sources" || section.key === "references";
const coverageSection = (section: { key?: string; title: string }) => section.key === "window-coverage" || section.key === "daily-source-totals" || /涵蓋|覆蓋/.test(section.title);
export async function ExpandedReport({
    apiPath,
    path,
    search,
    title,
    family,
    filterPath,
}: {
    apiPath: string;
    path: string;
    search: Search;
    title: string;
    family: string;
    filterPath?: string;
}) {
    const result = await api<ReportData>(apiPath, search);
    if (!result.ok) {
        if (result.status === 404) notFound();
        return <Unavailable status={result.status} title={title} />;
    }
    const { data, meta } = result.response;
    if (!Array.isArray(data.columns) || !Array.isArray(data.rows)) {
        rejectMalformedPayload();
        return <Unavailable status={502} title={title} />;
    }
    // Keyword clouds and day rankings are precomputed only for the top of the /keywords ranking
    // (runtime/schedules.report-caches.json); say so instead of a generic "no data".
    const uncachedKeyword = /^\/keywords\/[^/]+\/(cloud|days)$/.test(path) && !data.rows.length && !data.words?.length && !data.sections?.some((section) => section.rows.length);
    const keywordEmpty = { title: "這個關鍵字沒有預先計算的報表", description: "文字雲與逐日排行只為「標籤與關鍵字」排行前 50 名預先計算，每天更新兩次。這不代表來源沒有相關影片。" };
    const mayorCity = path === "/mayor" ? String((Array.isArray(search.city) ? search.city[0] : search.city) || "taipei").trim().toLowerCase() : path.match(/^\/mayor\/cities\/([^/]+)$/)?.[1]?.toLowerCase();
    const filters = data.filters || [],
        known = new Set(filters.map((filter) => filter.key));
    return (
        <>
            <Heading
                title={data.title || title}
                meta={meta}
                // The group directory and a word group's page date the hand-maintained list, not an observation.
                updatedLabel={/^\/groups(?:\/[^/]+)?$/.test(path) ? "名單最後編修" : undefined}
            />
            <DataNotice meta={meta} />
            {/* A lone tab (a content group's only report) is not a choice; the page title already names it. */}
            {(() => { const items = familyTabs(path, search, meta.coverage); return items.length > 1 ? <Tabs items={items} active={path} /> : null; })()}
            {path==='/tags/compare'&&<ComparisonControls search={search} points={data.series?.[0]?.points}/> }
            {/* Live parts read view from the URL; the fallbacks render the same markup from this request's search (ISR pages need the boundary). */}
            {mayorCity && cities[mayorCity] ? (() => { const props = { city: mayorCity, search, from: filters.find((filter) => filter.key === 'from')?.value, to: filters.find((filter) => filter.key === 'to')?.value }; return <Suspense fallback={<MayorSwitcher {...props} view={searchView(search)} />}><MayorSwitcherLive {...props} /></Suspense>; })() : null}
            {data.navigation?.length ? <Tabs label="報表切換" active={path} items={data.navigation.flatMap(item => {
                const href = safeReportHref(item.href);
                return href ? [{ href, label: item.label, active: item.active === true }] : [];
            })} /> : null}
            {/* The page's own switches (period, metric, group) sit apart from the section
                tabs above by extra space; each is its own tab group, side by side and wrapping on narrow screens. */}
            {data.tabRows?.length ? <div className="mt-6 flex flex-wrap items-start gap-x-6">{data.tabRows.map(row => <div key={row.label} className="min-w-0 max-w-full"><Tabs label={row.label} active={path} items={row.items.flatMap(item => {
                const href = safeReportHref(item.href);
                return href ? [{ href, label: item.label, active: item.active === true }] : [];
            })} /></div>)}</div> : null}
            {/* Mayor pages put their filters in MayorSwitcher's single row: period and metric chips plus a custom date range. */}
            {filters.length > 0 && !mayorCity && (
                <form key={JSON.stringify([filterPath||path,search,filters])} className={ui.form} action={filterPath || path}>
                    {Object.entries(search)
                        .filter(([key]) => !known.has(key) && key !== "offset")
                        .flatMap(([key, value]) =>
                            (Array.isArray(value)
                                ? value
                                : value === undefined
                                  ? []
                                  : [value]
                            ).map((value, index) => (
                                <input className={ui.input}
                                    key={`${key}-${index}`}
                                    type="hidden"
                                    name={key}
                                    value={value}
                                />
                            )),
                        )}
                    {filters.map((filter) => ['tagid','or','not'].includes(filter.key) ? (
                        <FilterPicker
                            key={filter.key}
                            name={filter.key}
                            label={filter.label}
                            kind="tags"
                            multiple
                            // Effective values can include a path tag or route defaults.
                            // Preserve ambiguous repeated parameters for explicit correction.
                            value={Array.isArray(search[filter.key]) ? search[filter.key] : filter.value ?? ''}
                        />
                    ) : (
                        <label className={ui.label} key={filter.key}>
                            {filter.label}
                            {filter.type === "select" ? (
                                <select className={ui.input}
                                    name={filter.key}
                                    defaultValue={filter.value}
                                >
                                    {filter.options?.map((option) => (
                                        <option
                                            value={option.value}
                                            key={option.value}
                                        >
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <input className={ui.input}
                                    type={filter.type}
                                    name={filter.key}
                                    defaultValue={filter.value}
                                />
                            )}
                        </label>
                    ))}
                    <button className={ui.primary}>套用篩選</button>
                    <Link className={ui.button} href={filterPath || path} prefetch={reportLinkPrefetch(filterPath || path)}>
                        清除
                    </Link>
                </form>
            )}
            {mayorCity && data.series?.length ? <Suspense fallback={<MayorShare part="chart" city={mayorCity} series={data.series} search={search} rows={data.bucketCoverage ?? data.rows} view={searchView(search)} />}><MayorShareLive part="chart" city={mayorCity} series={data.series} search={search} rows={data.bucketCoverage ?? data.rows} /></Suspense> : null}
            {data.metrics?.length ? (
                <div className="metrics">
                    {data.metrics.map((metric, index) => (
                        <Metric
                            key={index}
                            {...metric}
                            value={<ObservationValue value={metric.value}/>}
                            unit={metric.value===null||!Number.isFinite(metric.value)?undefined:metric.unit}
                        />
                    ))}
                </div>
            ) : null}
            {data.words?.length ? (
                <>
                    <SectionHeading title="關鍵詞分布" />
                    <ReportWordCloud words={data.words} />
                </>
            ) : null}
            {mayorCity && data.series?.length ? <MayorShare part="candidates" city={mayorCity} series={data.series} search={search} rows={data.bucketCoverage ?? data.rows} view={searchView(search)} /> : null}
            {/* Mayor pages show every candidate in the one share chart above, so no per-person raw charts. */}
            {/* A term comparison and the daily live categories draw every series on one shared axis
                (the legend toggles lines). Other reports with several series (one per group or
                category, on their own scales) sit two to a row as shorter charts. */}
            {!mayorCity && path === "/tags/compare" && data.series && compareOnOneAxis(data.series) ? (
                <section>
                    <SectionHeading title="趨勢比較" />
                    <div className={ui.panel}><SeriesCompareChart series={data.series} label={data.title || title} /></div>
                </section>
            ) : !mayorCity && path === "/live/trends/daily" && data.series && encodeOnOneAxis(data.series) ? (
                <section>
                    <SectionHeading title="每日趨勢" />
                    <div className={ui.panel}><SeriesCompareChart series={data.series} label={data.title || title} max={COMPARE_MAX_ENCODED} /></div>
                </section>
            ) : mayorCity ? null : <div className={(data.series?.length ?? 0) > 1 ? "lg:grid lg:grid-cols-2 lg:gap-x-6" : undefined}>{data.series?.map((series, index, all) => (
                <section key={`${series.name}-${index}`} className="min-w-0">
                    <SectionHeading title={series.name} />
                    <div className={ui.panel}>
                        {series.points.length ? (
                            <TimeChart
                                points={series.points}
                                label={series.name}
                                unit={series.unit}
                                compact={all.length > 1}
                            />
                        ) : (
                            <Empty title="這個期間尚無觀測點" />
                        )}
                    </div>
                </section>
            ))}</div>}
            {/* Narrow sections (term/weight lists) keep to a readable width, sit side by side on wide
                screens and show their first rows; the rest stay in the same table behind a native toggle. */}
            <div className={data.sections && data.sections.length > 1 && data.sections.every((section) => section.columns.length <= NARROW_SECTION_COLUMNS) ? "lg:grid lg:grid-cols-2 lg:gap-x-6" : undefined}>
            {data.sections?.filter((section) => !provenanceSection(section)).map((section, index) => coverageSection(section) && section.rows.length ? (
                <details key={`${section.title}-${index}`} className="group mt-6 min-w-0">
                    <summary className="cursor-pointer py-2 text-base font-semibold">{section.title}<span className="ml-2 text-sm font-normal text-zinc-500">{count(section.rows.length)} 筆</span></summary>
                    <ReportTable columns={section.columns} rows={section.rows} label={section.title} showMobileScrollHint={Boolean(mayorCity)} foldUniform/>
                </details>
            ) : (
                <section key={`${section.title}-${index}`} className={section.columns.length <= NARROW_SECTION_COLUMNS ? "max-w-xl min-w-0" : undefined}>
                    <SectionHeading title={section.title} />
                    {section.rows.length ? section.columns.length <= NARROW_SECTION_COLUMNS && section.rows.length > SECTION_PREVIEW_ROWS ? (
                        <div className={sectionPreview}>
                            <ReportTable columns={section.columns} rows={section.rows} label={section.title} showMobileScrollHint={Boolean(mayorCity)}/>
                            <details className="group">
                                <summary className={"mt-1 cursor-pointer py-3 text-sm " + ui.link}><span className="group-open:hidden">顯示全部 {count(section.rows.length)} 筆</span><span className="hidden group-open:inline">只顯示前 {SECTION_PREVIEW_ROWS} 筆</span></summary>
                            </details>
                        </div>
                    ) : <ReportTable columns={section.columns} rows={section.rows} label={section.title} showMobileScrollHint={Boolean(mayorCity)} foldUniform/> : <Empty {...(uncachedKeyword ? keywordEmpty : { title: "這個項目尚無觀測資料" })} />}
                </section>
            ))}
            </div>
            {data.rows.length > 0 ? (
                <>
                    <SectionHeading title="觀測資料" />
                    {/* A list of three columns or fewer (group, basis, count) keeps to a readable width;
                        wider tables use the whole column. */}
                    <div className={data.columns.length <= NARROW_SECTION_COLUMNS ? "max-w-3xl" : undefined}>
                        <ReportTable columns={data.columns} rows={data.rows} label={data.title||title} showMobileScrollHint={Boolean(mayorCity)} foldUniform/>
                    </div>
                </>
            ) : !data.words?.length &&
              !data.series?.some((series) => series.points.length) ? (
                uncachedKeyword && data.sections?.length ? null : <Empty {...(uncachedKeyword ? keywordEmpty : {})} />
            ) : null}
            {data.sections?.filter((section) => provenanceSection(section) && section.rows.length).map((section, index) => (
                <details key={`${section.title}-${index}`} className="group mt-6 min-w-0">
                    <summary className="cursor-pointer py-2 text-base font-semibold">{section.title}<span className="ml-2 text-sm font-normal text-zinc-500">{count(section.rows.length)} 筆</span></summary>
                    <ReportTable columns={section.columns} rows={section.rows} label={section.title} foldUniform/>
                </details>
            ))}
            {uncachedKeyword && <p className="text-sm"><Link className="text-brand-700 hover:underline dark:text-brand-400" href="/keywords">查看關鍵字排行 →</Link></p>}
            <Pagination collection={data} search={search} path={path} />
            <ReportMethod path={path} description={data.description} meta={meta} notes={[...(data.notes ?? []), ...(family === 'live' ? liveCoverageNotes(meta.coverage) : [])]} />
        </>
    );
}

