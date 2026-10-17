'use client';
import {usePathname} from 'next/navigation';
import SectionTabs from '@/components/SectionTabs';
const tabs=[['/manage','頻道'],['/manage/editorial','事件與頻道審核'],['/manage/keywords','關鍵字覆核'],['/manage/users','帳號']];
export default function ManageTabs(){const path=usePathname().replace(/\/$/,'');return <SectionTabs label="管理後台" className="mt-4" tabs={tabs.map(([href,label])=>({href:href!,label:label!,current:href===path}))}/>;}
