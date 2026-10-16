import ReaderGate from '../ReaderGate';
import ApiKeys from './ApiKeys';
import Settings from './Settings';
export default function Page(){return <ReaderGate next="/my/settings"><div className="space-y-10"><Settings/><ApiKeys/></div></ReaderGate>;}
