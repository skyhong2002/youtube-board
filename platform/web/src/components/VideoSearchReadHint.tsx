/** A bounded read is unavailable, never a proven empty result. No filters are added. */
export function VideoSearchReadHint(){
 return <aside className="my-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400" aria-label="影片搜尋範圍建議">這次搜尋暫時無法完成。全期間的少見詞彙或無符合結果仍可能需要較長時間確認；您可以選擇頻道或發布日期範圍後重試。目前沒有自動套用日期限制，也不能據此判定沒有相關影片。</aside>;
}
