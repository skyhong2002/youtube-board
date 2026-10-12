import "server-only";
import { api, type ChannelData, type VideoData } from "./api";
import { PublicDataError } from "./public-data";
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
        if (route.kind === "video" && route.id) {
            const result = await api<VideoData>(`videos/${encodeURIComponent(route.id)}`, {});
            return result.ok && result.response.data.video ? { kind: "video", video: result.response.data.video, durationSeconds: result.response.data.durationSeconds } : null;
        }
    } catch (error) {
        if (!(error instanceof PublicDataError)) throw error;
    }
    return null;
}
