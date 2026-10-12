import type { Register } from './table.js';
import { bounded, NotFound } from './query.js';
const news = [
    [['QsGswQvRmtU','三立'],['vr3XyVCR4T0','中天'],['ylYJSBUgaMA','民視'],['m_dhMSvUCIc','TVBS']],
    [['quwqlazU-c8','公視新聞'],['C6gYqSHLRw4','公視'],['wM0g8EoUZ_E','華視'],['6KlRR_DGhmI','公視台語台']],
    [['5n0y6b0Q25o','鏡新聞'],['-Bk_tdwVDPQ','中天深喉嚨'],['6IquAgfvYmc','寰宇新聞'],['1I2iq41Akmo','東森財經']],
    [['91PfFoqvuUk','地震'],['z_fY1pj1VBw','象山'],['xwAWSh35uuw','漁人碼頭'],['UCG1aXVO8H8','多良']],
    [['KyT4qSK8lJo','地震'],['q2OqoVjIZJY','台南'],['meHTKm4XBS8','華視'],['5cRG33-IVVg','TREM']],
    [['zkDPXEIIuSs','國會現場 1'],['PT9HDbvsRSA','國會現場 2'],['JEfEzYctdrI','國會現場 3'],['WeBCFkb0SJw','國會現場 4']],
    [['tg3EV-tvtI4','政治現場 1'],['QElZ52jXWyg','政治現場 2'],['8Xz8TeXnuk8','政治現場 3'],['R2VDU_T2-DY','政治現場 4']],
];
const other: Record<string,string[]> = { china:['dSgvHzDGX3k','-GDOZ_XVQDA','OhHsiIvqfgk','imuXJFb2Uh0'],alternate:['6dXQoQqG7o8','mARiTBux7YQ','ex9lbHmXBO0','fJKhyf4C8UY'] };
export function registerLiveWall(register:Register) {
    register('/live/walls/:variant',async(p,q)=>{
        if(!['news','china','alternate'].includes(p.variant))throw new NotFound();
        const type=bounded(q.type,1,1,7), labels=['主流新聞','公廣集團','談話國際','台灣地景','地震直播','國會現場','政治現場'];
        const streams=p.variant==='news'?news[type-1]!:other[p.variant]!.map((id,i)=>[id,`直播 ${i+1}`]);
        return {title:`${p.variant==='news'?labels[type-1]:p.variant==='china'?'中國相關':'備用'}四窗直播`,variant:p.variant,type,tabs:p.variant==='news'?labels.map((label,i)=>({label,type:i+1})):[],streams:streams.map(([id,label],i)=>({id,label,slot:i+1})),updatedAt:null,notes:['播放清單沿用已審核舊版設定，不代表連結目前仍在直播；播放可用性由 YouTube 提供。']};
    });
}
