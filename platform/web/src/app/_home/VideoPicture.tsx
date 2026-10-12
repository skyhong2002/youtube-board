import {VideoThumbnail} from '@/components/VideoThumbnail';
import styles from './home.module.css';
export default function VideoPicture({videoId,priority=false}:{videoId:string|null;priority?:boolean}){
 return <span className={styles.picture}><VideoThumbnail videoId={videoId} fill priority={priority} sizes="(max-width: 640px) 100vw, 640px"/></span>;
}
