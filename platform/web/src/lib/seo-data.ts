import "server-only";
import { api, type ChannelData, type VideoData } from "./api";
import { PublicDataError } from "./public-data";
import { filterOptionsMatch, type FilterOptions } from "../../../shared/filter-options";
import type { ReportRoute } from "./routes";
import type { ReportSubject } from "./seo";
/** Names for channel and video detail metadata. The reads are exactly the ones ReportPage
 * makes for the same route (same path, empty search), so in ISR they share its cached
 * entry. A 404 still ends in notFound(); any other failure only drops the name. */
export async function reportSubject(route: ReportRoute): Promise<ReportSubject> {
    try {
        if (route.kind === "channel") {
            const result = await api<ChannelData>(route.apiPath, {});
            return result.ok && result.response.data.channel?.title ? { kind: "channel", title: result.response.data.channel.title } : null;
        }
        // A channel's sub-report is titled with the channel's name, through the same light
        // filter-options read that ChannelContext uses for the visible breadcrumb.
        const sub = route.kind !== "channel" && route.family === "channels" ? route.apiPath.match(/^channels\/(\d+)\//)?.[1] : undefined;
        if (sub) {
            const result = await api<FilterOptions>("filter-options/channels", { ids: sub }, { optional: true });
            const label = result.ok && filterOptionsMatch(result.response.data, { kind: "channels", ids: [sub], limit: 20 }) ? result.response.data.rows.find((row) => row.id === sub)?.label : undefined;
            return label ? { kind: "channel", title: label } : null;
        }
        if (route.kind === "video" && route.id) {
            const result = await api<VideoData>(`videos/${encodeURIComponent(route.id)}`, {});
            return result.ok && result.response.data.video ? { kind: "video", video: result.response.data.video, durationSeconds: result.response.data.durationSeconds } : null;
        }
    } catch (error) {
        if (!(error instanceof PublicDataError)) throw error;
    }
    return null;
}
