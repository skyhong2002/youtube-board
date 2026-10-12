import {VideoThumbnail} from '@/components/VideoThumbnail';
import styles from './home.module.css';
import {VIDEO_PICTURE_SIZES,type VideoPictureVariant} from './video-picture-sizes';
export {VIDEO_PICTURE_SIZES,type VideoPictureVariant};
export default function VideoPicture({videoId,variant,priority=false}:{videoId:string|null;variant:VideoPictureVariant;priority?:boolean}){
 return <span className={styles.picture}><VideoThumbnail videoId={videoId} fill priority={priority} sizes={VIDEO_PICTURE_SIZES[variant]}/></span>;
}
