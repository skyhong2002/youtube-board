/** The one ECharts entry point for the site's charts (TimeChart, SeriesCompareChart, MayorShare).
 * Charts load it with `await import('@/lib/echarts')`, so ECharts stays out of the page bundle and
 * only the pieces registered here are shipped, instead of the whole `echarts` package.
 *
 * Registered on purpose — add to this list before using another series type, component or renderer
 * in a chart option; an unregistered one is silently not drawn in production builds:
 * - LineChart: every series is `type: 'line'` (including endLabel on the comparison chart).
 * - Grid, Tooltip, Legend (plain and scroll, with the all/inverse selector), DataZoom (inside and slider)
 *   and Aria (screen-reader description) components.
 * - SVGRenderer: charts are initialised with `{renderer: 'svg'}`. */
import { init, use, type EChartsType } from "echarts/core";
import { LineChart } from "echarts/charts";
import { AriaComponent, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, AriaComponent, SVGRenderer]);

export { init };
export type ECharts = EChartsType;
