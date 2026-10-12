'use client';
import {usePathname} from 'next/navigation';
import SectionTabs from '@/components/SectionTabs';
const tabs=[['/my','我的動態'],['/my/following','追蹤清單'],['/my/saved','收藏'],['/my/settings','設定']];
export default function MyTabs(){const path=usePathname().replace(/\/$/,'');return <SectionTabs label="我的有影儀表板" className="mt-4" tabs={tabs.map(([href,label])=>({href:href!,label:label!,current:href===path}))}/>;}
