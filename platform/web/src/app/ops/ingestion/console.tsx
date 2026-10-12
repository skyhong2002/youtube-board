'use client';
import { useState } from 'react';
import TableScroller from '@/components/TableScroller';
interface Inventory {jobs:{key:string;implementation:string;execution:string;schedule:string|null}[];policy:{enabled?:boolean;productionEnabled?:boolean;schedulerEnabled?:boolean;allowlist?:string[];typescriptOwners?:string[]};}
interface History {source:string|null;scope:string;rows:{id:string|null;status:string;updatedAt:string|null}[];hasMore:boolean;note:string;relatedWorkflows?:string[];}

export default function IngestionConsole() {
  const [token, setToken] = useState(''), [jobs, setJobs] = useState<string[]>([]), [job, setJob] = useState(''), [runId, setRunId] = useState('');
  const [queuedId, setQueuedId] = useState('');
  const [inventory,setInventory]=useState<Inventory|null>(null),[history,setHistory]=useState<History|null>(null);
  const [options, setOptions] = useState('{}'), [checked, setChecked] = useState(''), [result, setResult] = useState(''), [busy, setBusy] = useState(false);
  function payload() { return JSON.stringify({ workflow: job, id: runId, input: { options: JSON.parse(options) } }); }
  async function request(path: string, body?: string) {
    const response = await fetch(`/api/ops/${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body } : {}), cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}：${data.error?.code || '請求失敗'}`);
    return data;
  }
  async function run(action: 'inspect' | 'preview' | 'enqueue') {
    setBusy(true); setResult('');
    try {
      if (action === 'inspect') {
        const [data,inspection] = await Promise.all([request('workflows'),request('ingestion')]); setJobs(data.workflows);setInventory(inspection); setResult('工作清單與授權設定已載入；實際排程狀態尚未檢查，不會建立定期排程。');
      } else {
        const body = payload();
        if (action === 'enqueue' && checked !== body) throw new Error('參數已變更，請重新檢查。');
        const data = await request(`workflows/${action === 'preview' ? 'preview' : 'run'}`, body);
        setResult(JSON.stringify(data, null, 2));
        if (action === 'enqueue' && typeof data.id === 'string') setQueuedId(data.id);
        if (action === 'preview') setChecked(body); else setChecked('');
      }
    } catch (error) { setResult(error instanceof Error ? error.message : '請求失敗'); setChecked(''); }
    finally { setBusy(false); }
  }
  function invalidate(change: () => void) { change(); setChecked(''); setQueuedId('');setHistory(null); }
  return <section className="panel" style={{ padding: 24 }}>
    <label>管理憑證<input disabled={busy} type="password" autoComplete="off" value={token} onChange={e => invalidate(() => (setToken(e.target.value),setInventory(null),setJobs([]),setResult('')))} /></label>
    <p className="muted">憑證僅保存在目前頁面的記憶體，不儲存於瀏覽器。正式環境仍須設定工作授權。</p>
    <button className="button" disabled={busy || !token} onClick={() => run('inspect')}>載入工作清單</button>
    <div style={{ display: 'grid', gap: 16, marginTop: 24 }}>
      <label>工作<select disabled={busy} value={job} onChange={e => invalidate(() => { setJob(e.target.value); setRunId(`ops-${crypto.randomUUID()}`); setOptions('{}'); })}><option value="">請選擇</option>{jobs.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>本次執行編號<input disabled={busy} maxLength={100} value={runId} onChange={e => invalidate(() => setRunId(e.target.value))} /></label>
      <label>工作參數（JSON）<textarea disabled={busy} rows={9} value={options} onChange={e => invalidate(() => setOptions(e.target.value))} spellCheck={false} /></label>
      <p className="muted">例如影片統計可填 {`{"limit":25}`}。AI 工作須明確填入台北時間 from、to 與適用條件。檢查參數不會呼叫來源 API 或更新資料。</p>
      <div style={{ display: 'flex', gap: 12 }}><button className="button" disabled={busy || !token || !job || !runId} onClick={() => run('preview')}>檢查參數</button><button className="button" disabled={busy || !checked} onClick={() => run('enqueue')}>加入背景佇列</button><button className="button" disabled={busy} onClick={() => { setToken(''); setChecked(''); setQueuedId('');setInventory(null);setHistory(null);setJobs([]); setResult('管理憑證已清除。'); }}>清除憑證</button></div>
    </div>
    {inventory && <section aria-label="工作授權與實作狀態" style={{marginTop:24}}>
      <h2>工作授權與實作狀態</h2>
      <p>資料寫入：{inventory.policy.enabled?'開啟':'未開啟或未設定'}；正式環境寫入：{inventory.policy.productionEnabled?'開啟':'未開啟'}；排程閘門：{inventory.policy.schedulerEnabled?'開啟':'未開啟'}。</p>
      <p className="muted">下表時間為舊版排程參考；目前 scheduler 的下次執行時間、provider 連線與剩餘 quota 均未檢查。讀取本頁不發出來源 API 請求。</p>
      <TableScroller><table><thead><tr><th>工作</th><th>實作</th><th>入口</th><th>TS 擁有</th><th>正式 allowlist</th><th>舊版排程參考</th></tr></thead><tbody>{inventory.jobs.map(item=><tr key={item.key}><td>{item.key}</td><td>{item.implementation}</td><td>{item.execution}</td><td>{inventory.policy.typescriptOwners?.includes(item.key)?'是':'否'}</td><td>{inventory.policy.allowlist?.includes(item.key)?'是':'否'}</td><td>{item.schedule||'—'}</td></tr>)}</tbody></table></TableScroller>
    </section>}
    <section aria-label="持久化工作紀錄" style={{marginTop:24}}>
      <h2>持久化工作紀錄</h2><p className="muted">查閱上方選定工作的最近 25 筆紀錄；不顯示來源內容、提示詞或 provider 原始錯誤。這與短期保留的佇列狀態分開。</p>
      <button className="button" disabled={busy||!token||!job} onClick={async()=>{setBusy(true);setHistory(null);try{setHistory(await request('ingestion/history?'+new URLSearchParams({workflow:job})));}catch(error){setResult(error instanceof Error?error.message:'紀錄讀取失敗');}finally{setBusy(false);}}}>讀取工作紀錄</button>
      {history&&<><p>{history.note}</p>{history.source&&<p className="muted">來源：{history.source}</p>}{history.relatedWorkflows&&<p>子工作：{history.relatedWorkflows.join('、')}</p>}{history.rows.length?<TableScroller><table><thead><tr><th>執行編號</th><th>狀態</th><th>紀錄時間</th></tr></thead><tbody>{history.rows.map((row,i)=><tr key={row.id??i}><td style={{overflowWrap:'anywhere'}}>{row.id||'無法辨識'}</td><td>{row.status}</td><td>{row.updatedAt?new Date(row.updatedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'未記錄'}</td></tr>)}</tbody></table></TableScroller>:<p>目前沒有可列出的紀錄；這不代表工作從未執行。</p>}{history.hasMore&&<p>另有更早紀錄。完整稽核請依工作手冊查閱持久化紀錄。</p>}</>}
    </section>
    {queuedId && <button className="button" disabled={busy || !token} onClick={async () => { setBusy(true); try { setResult(JSON.stringify(await request(`workflows/jobs/${queuedId}`), null, 2)); } catch (error) { setResult(error instanceof Error ? error.message : '狀態查詢失敗'); } finally { setBusy(false); } }}>更新佇列狀態</button>}
    {result && <pre role="status" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 24 }}>{result}</pre>}
  </section>;
}
