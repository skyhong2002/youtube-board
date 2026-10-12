import IngestionConsole from './console';
export const metadata = { title: '資料工作管理' };
export default function IngestionPage() {
  return <><h1>資料工作管理</h1><p className="muted">查看可執行工作、檢查參數並加入背景佇列。執行結果請核對工作紀錄；加入佇列不代表資料已更新。</p><IngestionConsole /></>;
}
