'use client';
import {usePathname} from 'next/navigation';
import SectionTabs from '@/components/SectionTabs';
// 事件與頻道審核 (/admin/editorial) is hidden on 2026-10-18: manual event curation is not used
// and production writes are off. Its code stays; next.config.ts redirects the path to /admin.
const tabs=[['/admin','頻道'],['/admin/keywords','關鍵字覆核'],['/admin/users','帳號']];
export default function AdminTabs(){const path=usePathname().replace(/\/$/,'');return <SectionTabs label="管理後台" className="mt-4" tabs={tabs.map(([href,label])=>({href:href!,label:label!,current:href===path}))}/>;}
