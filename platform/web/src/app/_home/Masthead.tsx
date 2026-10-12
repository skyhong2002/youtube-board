import Link from 'next/link';
import type {CSSProperties,ReactNode} from 'react';
import {mastheadFrameVars,mastheadLayouts} from '@/lib/masthead-cloud';
import styles from './home.module.css';

// The parent site's masthead cloud with the family mark: the selected window's
// keywords are packed around the mark, tagline and edition line. `cloud` is
// laid out with mastheadCanvases; `caption` follows the frame (heading,
// window switch, coverage).
export const mastheadCanvases=mastheadLayouts({compact:styles.mastheadCloudCompact,medium:styles.mastheadCloudMedium,wide:styles.mastheadCloudWide});
const frameVars=mastheadFrameVars() as CSSProperties;

export default function Masthead({edition,cloud,caption}:{edition:string;cloud:ReactNode;caption:ReactNode}){
 return <div className={styles.mastheadCloud}>
  <div className={styles.mastheadCloudFrame} style={frameVars}>
   {cloud}
   <div className={styles.mastheadCloudCentre}>
    <h1 id="home-masthead"><span className="sr-only">有影儀表板</span><img src="/brand/family/logo-light.svg" className={`${styles.mastheadCloudMark} dark:hidden`} alt="" aria-hidden="true"/><img src="/brand/family/logo-dark.svg" className={`${styles.mastheadCloudMark} hidden dark:block`} alt="" aria-hidden="true"/></h1>
    <p className={styles.mastheadTagline}>同一件事，各台怎麼說</p>
    <p className={styles.edition}>{edition}</p>
    <Link href="/keywords" className={styles.mastheadCloudLink}>熱門標籤排行 →</Link>
   </div>
  </div>
  {caption}
 </div>;
}
