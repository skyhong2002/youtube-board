'use client';
import {usePathname} from 'next/navigation';
import SectionTabs from '@/components/SectionTabs';
const tabs=[['/admin','頻道'],['/admin/editorial','事件與頻道審核'],['/admin/keywords','關鍵字覆核'],['/admin/users','帳號']];
export default function AdminTabs(){const path=usePathname().replace(/\/$/,'');return <SectionTabs label="管理後台" className="mt-4" tabs={tabs.map(([href,label])=>({href:href!,label:label!,current:href===path}))}/>;}
