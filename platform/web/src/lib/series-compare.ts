/** Categorical line colours for comparing terms on one axis, in fixed slot order (never cycled).
 * Light and dark are the same eight hues stepped for each surface; validated for adjacent-pair
 * colour-vision separation on white and on the dark panel (#18181b). Light-mode aqua, yellow and
 * magenta sit under 3:1 against white, so the chart always ships with a legend, a tooltip naming
 * every term and the report's value table. */
export const COMPARE_COLORS={
 light:['#2a78d6','#eb6834','#1baf7a','#eda100','#e87ba4','#008300','#6250d6','#e34948'],
 dark:['#3987e5','#d95926','#199e70','#c98500','#d55181','#008300','#9085e9','#e66767'],
} as const;
/** More terms than slots would need generated hues; such a comparison keeps one chart per term. */
export const COMPARE_MAX_SERIES=COMPARE_COLORS.light.length;
/** One shared-axis chart when every series has the same unit and there are enough slots for them. */
export const compareOnOneAxis=(series:readonly {unit:string;points:readonly unknown[]}[])=>series.length>1&&series.length<=COMPARE_MAX_SERIES&&series.every(s=>s.unit===series[0]!.unit&&s.points.length===series[0]!.points.length);
/** Camp names keep their political colour on every chart (藍／白／綠／紅), validated as a set with
 * the dataviz palette checker in both modes; no FAIL, the red–green CVD WARN is relieved by the
 * legend, the end labels and the value table. */
export const CAMP_COLORS:Record<string,{light:string;dark:string}>={
 泛藍:{light:'#2a78d6',dark:'#3987e5'},泛白:{light:'#eda100',dark:'#c98500'},泛綠:{light:'#008300',dark:'#008300'},泛紅:{light:'#e34948',dark:'#e0405a'},
};
/** Up to two passes over the slots: the second pass keeps the slot hue but adds a dashed line and a
 * triangle marker (composite encoding), so a 14-category group still never gets a generated hue. */
export const COMPARE_MAX_ENCODED=COMPARE_MAX_SERIES*2;
export function compareStyle(name:string,index:number,theme:'light'|'dark'){
 const pass=Math.floor(index/COMPARE_MAX_SERIES);
 return {color:CAMP_COLORS[name]?.[theme]??COMPARE_COLORS[theme][index%COMPARE_MAX_SERIES]!,dashed:pass>0,symbol:pass>0?'triangle':'circle'};
}
/** Same-unit, same-length series that fit the encoded slots draw on one shared axis. */
export const encodeOnOneAxis=(series:readonly {unit:string;points:readonly unknown[]}[])=>series.length>1&&series.length<=COMPARE_MAX_ENCODED&&series.every(s=>s.unit===series[0]!.unit&&s.points.length===series[0]!.points.length);
