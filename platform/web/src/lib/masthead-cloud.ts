import {dateTime} from './format';

// The parent site's masthead cloud (web/src/app/_home/MastheadCloud.tsx): the
// mark, tagline, edition line and a link sit in the middle of one of three
// canvases, picked by viewport width in home.module.css. Sizes are canvas units
// times --u (frame width ÷ canvas width), so mark and words never drift apart.
export interface MastheadCanvas {
 key:'compact'|'medium'|'wide';
 width:number;height:number;
 /** Widest the frame may grow, in CSS px. */
 max:number;
 /** Mark size, tagline and small-line font sizes, in canvas units. */
 logo:number;tagline:number;small:number;
 sizes:{min:number;max:number;floor:number;budget:number;gap:number;markGap:number;scatter:number};
}
export const MASTHEAD_CANVASES:readonly MastheadCanvas[]=[
 {key:'compact',width:340,height:300,max:420,logo:100,tagline:14,small:12,sizes:{min:10,max:27,floor:9,budget:.9,gap:7,markGap:12,scatter:900}},
 {key:'medium',width:680,height:280,max:780,logo:120,tagline:14,small:12,sizes:{min:11,max:36,floor:10,budget:.85,gap:10,markGap:18,scatter:1400}},
 {key:'wide',width:1120,height:280,max:1120,logo:128,tagline:14,small:12,sizes:{min:12,max:44,floor:11,budget:.8,gap:14,markGap:26,scatter:2000}},
];
/** Every ranked term the API returns for a window (at most forty). */
export const MASTHEAD_WORDS=40;
/** Ink cells of /brand/family/logo-{light,dark}.svg on a 16×16 grid of its 512 viewBox
 * ('#' = ink): 有影 (y 30–216, x 69–445), the play mark (y 245–289, x 235–277) and
 * 儀表板 (y 320–457, x 48–466). Coarser than the parent's glyph mask; markGap keeps words off the strokes. */
export const FAMILY_LOGO_MASK:readonly string[]=[
 '................',
 ...Array<string>(6).fill('..############..'),
 ...Array<string>(2).fill('.......##.......'),
 '................',
 ...Array<string>(5).fill('.##############.'),
 '................',
];
/** The boxes the cloud keeps clear, matching the masthead's CSS: the mark (by
 *  its glyphs), a 3% gap, the tagline (line-height 1.6), 2 units, then the
 *  edition line and the link (line-height 1.7 each). Widths allow for the text plus a little slack. */
export function mastheadStack({logo,tagline:t,small:e}:Pick<MastheadCanvas,'logo'|'tagline'|'small'>){
 const gap=logo*.03,top=-(logo+gap+1.6*t+2+3.4*e)/2;
 const y1=top+logo+gap,y2=y1+1.6*t+2,y3=y2+1.7*e;
 return {
  hole:{width:logo,height:logo,mask:FAMILY_LOGO_MASK,dy:top+logo/2},
  clear:[
   {x:-5.7*t,y:y1-1,width:11.4*t,height:1.6*t+2},
   {x:-6.3*e,y:y2-1,width:12.6*e,height:1.7*e+2},
   {x:-3.3*e,y:y3-1,width:6.6*e,height:1.7*e+2},
  ],
 };
}
export function mastheadLayouts(classNames:Record<MastheadCanvas['key'],string>){
 return MASTHEAD_CANVASES.map(c=>({width:c.width,height:c.height,className:classNames[c.key],sizes:{...c.sizes,curve:.85,words:MASTHEAD_WORDS,irregular:.2,...mastheadStack(c)}}));
}
/** Per-canvas numbers for the CSS, which picks one set per breakpoint. */
export function mastheadFrameVars(){
 return Object.fromEntries(MASTHEAD_CANVASES.flatMap(c=>[[`--${c.key}-w`,c.width],[`--${c.key}-h`,c.height],[`--${c.key}-max`,`${c.max}px`],[`--${c.key}-logo`,c.logo],[`--${c.key}-t`,c.tagline],[`--${c.key}-e`,c.small]]));
}
/** Short enough to sit under the mark inside the cloud: 10/12（一）09:30 更新. */
export function mastheadEdition(updatedAt:string|null,aiDate:string|null){
 const time=updatedAt?Date.parse(updatedAt):NaN;
 if(Number.isFinite(time)){
  const parts=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hourCycle:'h23',month:'numeric',day:'numeric',weekday:'narrow',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(time));
  const at=(type:Intl.DateTimeFormatPartTypes)=>parts.find(p=>p.type===type)?.value??'';
  return `${at('month')}/${at('day')}（${at('weekday')}）${at('hour')}:${at('minute')} 更新`;
 }
 const day=aiDate?dateTime(aiDate,true):'未記錄';
 return day==='未記錄'?'等待資料更新':`觀測資料 ${day}`;
}
