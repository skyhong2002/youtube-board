// Pure (CSS-free) sizing policy for VideoPicture so it can be unit tested.
// Sources are i.ytimg.com mqdefault.jpg: 320x180 (16:9). Boxes crop with object-fit: cover, so a
// box with a narrower aspect than 16:9 is filled by height, and the image must be decoded at
// boxWidth * (16/9) / boxAspect to stay sharp — not at the box width.
export const VIDEO_SOURCE={width:320,height:180} as const;
// Box aspect ratios (width / height) from home.module.css.
export const VIDEO_BOX_ASPECT={
 hero:16/9, // .heroImage
 storyMobile:1, // .thumbnail at max-width: 640px
 storyDesktop:1.25, // .thumbnail
 live:4/3, // .topicCover (fixed 72px wide)
} as const;
/** Width the 16:9 source must render at for a cover crop to fill a box of this aspect. */
export const coverWidthFactor=(boxAspect:number)=>Math.max(1,(VIDEO_SOURCE.width/VIDEO_SOURCE.height)/boxAspect);
// Box widths within layout main (max 1152px, 16px gutters): hero = .center column;
// story = .thumbnail (28% mobile / 27% desktop of the story row); live = .topicCover.
// Story boxes are multiplied by their cover factor (16/9 on mobile squares, 16/9÷1.25 on desktop);
// live is 72px × 4/3 = 96px. E.g. a 390px phone: 92px square → ~164px requested.
// Trade-off: with imageSizes [.., 320] and deviceSizes [640], a ≥2x phone resolves the story cover
// to the 640 candidate. The optimizer never enlarges (withoutEnlargement), so that response is the
// native 320px source — same pixels as the 320 slot, just a separate cache variant. Avoiding it would
// need a new image-policy width (e.g. 384), which is a shared config change and deliberately not made here.
export const VIDEO_PICTURE_SIZES={
 hero:'(max-width: 640px) calc(100vw - 32px), (max-width: 1000px) calc((100vw - 52px) * .66), (max-width: 1152px) calc((100vw - 72px) * .52), 562px',
 story:'(max-width: 640px) calc((100vw - 62px) * .28 * 16 / 9), (max-width: 1000px) calc((100vw - 104px) * .18 * 16 / 9 / 1.25), (max-width: 1152px) calc((100vw - 137px) * .14 * 16 / 9 / 1.25), 203px',
 live:'96px',
} as const;
export type VideoPictureVariant=keyof typeof VIDEO_PICTURE_SIZES;
