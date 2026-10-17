/** The mayor trend chart's y-axis: raw volume unless the URL says view=share. Plain module so the
 * server report (Suspense fallbacks) and the client chart and switcher read the choice the same way. */
export type View='share'|'raw';
export const mayorView=(params:Pick<URLSearchParams,'get'>):View=>params.get('view')==='share'?'share':'raw';
export const searchView=(search:Record<string,string|string[]|undefined>):View=>{const v=search.view;return (Array.isArray(v)?v[0]:v)==='share'?'share':'raw';};
