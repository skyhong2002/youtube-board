import {ComparisonControls} from './ComparisonControls';
import {FilterPicker} from './FilterPicker';
import {familyTabs} from '@/lib/report-navigation';
import {ObservationValue} from './ObservationValue';
import {ReportTable} from './ReportTable';
import {reportStyle as ui} from '@/lib/report-styles';
import {LiveCoverageNotice} from './LiveCoverageNotice';
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type Search } from "@/lib/api";
import { count } from "@/lib/format";
import {
    type ReportData,
    safeReportHref,
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
    if (!Array.isArray(data.columns) || !Array.isArray(data.rows))
        return <Unavailable status={502} title={title} />;
    const filters = data.filters || [],
        known = new Set(filters.map((filter) => filter.key));
    return (
        <>
            <Heading
                title={data.title || title}
                description={data.description}
                meta={meta}
            />
            <DataNotice meta={meta} />
            {family==='live'&&<LiveCoverageNotice coverage={meta.coverage}/> }
            <Tabs items={familyTabs(path,search,meta.coverage)} active={path} />
            {path==='/tags/compare'&&<ComparisonControls search={search} points={data.series?.[0]?.points}/> }
            {data.navigation?.length ? <Tabs label="報表切換" active={path} items={data.navigation.flatMap(item => {
                const href = safeReportHref(item.href);
                return href ? [{ href, label: item.label, active: item.active === true }] : [];
            })} /> : null}
            {data.notes?.length ? (
                <aside className={ui.note}>
                    {data.notes.map((note, index) => (
                        <p key={index}>{note}</p>
                    ))}
                </aside>
            ) : null}
            {filters.length > 0 && (
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
                    <Link className={ui.button} href={filterPath || path}>
                        清除
                    </Link>
                </form>
            )}
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
                    <section className={ui.panel} aria-label="關鍵詞分布">
                        <div
                            className="tags"
                            style={{ gap: 14, alignItems: "baseline" }}
                        >
                            {data.words.map((word, index) => {
                                const href = safeReportHref(word.href);
                                const style = {
                                    fontSize: Math.min(
                                        30,
                                        12 +
                                            Math.log2(
                                                Math.max(1, word.weight),
                                            ) *
                                                2,
                                    ),
                                };
                                return href ? (
                                    <Link
                                        key={`${word.term}-${index}`}
                                        href={href}
                                        style={style}
                                        className="tag"
                                        title={`${word.term}：${count(word.weight)}`}
                                    >
                                        {word.term}
                                        <small
                                            style={{
                                                fontSize: 12,
                                                marginLeft: 5,
                                            }}
                                        >
                                            {count(word.weight)}
                                        </small>
                                    </Link>
                                ) : (
                                    <span
                                        key={`${word.term}-${index}`}
                                        style={style}
                                        className="tag"
                                    >
                                        {word.term}
                                        <small
                                            style={{
                                                fontSize: 12,
                                                marginLeft: 5,
                                            }}
                                        >
                                            {count(word.weight)}
                                        </small>
                                    </span>
                                );
                            })}
                        </div>
                    </section>
                </>
            ) : null}
            {data.series?.map((series, index) => (
                <section key={`${series.name}-${index}`}>
                    <SectionHeading title={series.name} />
                    <div className={ui.panel}>
                        {series.points.length ? (
                            <TimeChart
                                points={series.points}
                                label={series.name}
                                unit={series.unit}
                            />
                        ) : (
                            <Empty title="這個期間尚無觀測點" />
                        )}
                    </div>
                </section>
            ))}
            {data.sections?.map((section, index) => (
                <section key={`${section.title}-${index}`}>
                    <SectionHeading title={section.title} />
                    {section.rows.length ? <ReportTable columns={section.columns} rows={section.rows} label={section.title}/> : <Empty title="這個項目尚無觀測資料" />}
                </section>
            ))}
            {data.rows.length > 0 ? (
                <>
                    <SectionHeading title="觀測資料" />
                    <ReportTable columns={data.columns} rows={data.rows} label={data.title||title}/>
                    
                </>
            ) : !data.words?.length &&
              !data.series?.some((series) => series.points.length) ? (
                <Empty />
            ) : null}
            <Pagination collection={data} search={search} path={path} />
        </>
    );
}

