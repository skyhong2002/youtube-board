/** The listing page a failed report can fall back to (its family's first page), so the error page
 * offers a nearer way out than the home page. Families without a public listing (/comments) and the
 * listing page itself get none. */
const FAMILY_INDEX:Record<string,{href:string;label:string}>={
 channels:{href:'/channels',label:'頻道觀測'},
 videos:{href:'/videos',label:'影片觀測'},
 tags:{href:'/tags',label:'頻道分類'},
 keywords:{href:'/keywords',label:'熱門標籤排行'},
 vocabulary:{href:'/vocabulary',label:'共同標籤詞彙'},
 live:{href:'/live/current',label:'即時直播觀測'},
 ai:{href:'/ai/days',label:'每日公共議題'},
 groups:{href:'/groups',label:'頻道群組'},
 mayor:{href:'/mayor',label:'地方人物觀測'},
};
export function reportFamilyIndex(pathname:string|null|undefined){
 const path=(pathname??'').replace(/\/+$/,'');
 const family=FAMILY_INDEX[path.split('/')[1]??''];
 return family&&family.href!==path?family:null;
}
/** Paths rendered by the report pages (the same families the proxy sends to /render-filtered;
 * see next.config.ts), whose layout the report skeleton imitates. */
const REPORT_PATH=/^\/(channels|videos|tags|keywords|vocabulary|live|ai|groups|mayor|comments)(\/|$)/;
export function isReportPath(pathname:string|null|undefined){return REPORT_PATH.test(pathname??'');}
