import ReaderGate from '@/app/my/ReaderGate';
import Users from './Users';
export const dynamic='force-dynamic';
export const metadata={title:'管理角色',robots:{index:false,follow:false}};
export default function Page(){return <section className="mx-auto max-w-4xl"><h1 className="text-2xl font-semibold">管理角色</h1><ReaderGate next="/manage/users" admin><Users/></ReaderGate></section>;}
