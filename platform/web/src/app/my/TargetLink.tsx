import Link from 'next/link';
import {VideoThumbnail} from '@/components/VideoThumbnail';
import {ChannelSourceLabel,hasSource} from '@/components/ChannelSource';
import type {ChannelSource} from '../../../../shared/media-assets';
/** Feed/saved target. A channel byline sits under the title as its own link, so the
 * thumbnail and title link separately instead of wrapping it. */
export default function TargetLink({href,videoId,label,source,className=''}:{href:string;videoId:string|null;label:string;source?:ChannelSource|null;className?:string}){
 const extra=className?' '+className:'';
 if(!hasSource(source))return <Link className={'flex min-w-0 items-start gap-3 break-words font-medium hover:underline'+extra} href={href}>{videoId!==null&&<VideoThumbnail videoId={videoId}/>}<span className="min-w-0">{label}</span></Link>;
 return <div className={'flex min-w-0 items-start gap-3'+extra}>{videoId!==null&&<Link className="shrink-0" href={href} tabIndex={-1} aria-hidden="true"><VideoThumbnail videoId={videoId}/></Link>}<div className="min-w-0"><Link className="break-words font-medium hover:underline" href={href}>{label}</Link><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400"><ChannelSourceLabel source={source}/></p></div></div>;
}
