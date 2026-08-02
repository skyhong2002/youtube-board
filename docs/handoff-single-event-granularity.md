# 交接：單一事件粒度（single-story granularity）

接手 agent 請先讀 `AGENTS.md` 了解環境與 guardrails（測試用 `docker compose exec app php artisan test`；不要意外碰 production DB）。本文件分兩部分：Part A 是接手後繼續完善的方向，Part B 是部署滿半天（≥12 小時）後的驗證程序。

## 背景：剛完成的變更

Commit `97c2f93`「Make AI events single-story granular」（已 push）。系統的核心原則從「主題分群」改為「**一個事件 = 一件具體的事**」：同一場事故、同一次行程、同一項判決才算同一事件；多家媒體報導同一件事才合併。只是主題相近、分類相同、提到同一人物，都必須分開。

具體改動：

- `app/Services/Ingestion/AiDailyPreview.php`、`app/Services/Legacy/AiDailyPromptReport.php`：每日合併 prompt 重寫為單一具體事件定義，禁止「X及Y」「X與Y」複合標題。
- `app/Support/AiDailyContract.php`：`bounds()` 放寬為 all 5–40、其他條件 3–25，數量跟著新聞日走，不再硬湊。
- `app/Services/Ingestion/AiDailyIngestion.php`：structured-output schema 改用 `bounds['min']` 作 minItems，不再強制模型輸出固定事件數。
- `app/Services/Ingestion/AiHourlyPreview.php`：移除「盡量整併最多的影片」，數量公式改為 min 2+⌊v/40⌋、max 6+⌈v/15⌉。
- `app/Services/Legacy/AiDailyReport.php`：fallback 分群 `eventClusters()` 需 ≥2 個強訊號才合併（原本 1 個共用關鍵字就合併）。
- `app/Services/Notifications/TelegramStoryTracker.php`：`isMatch()` 門檻收緊，避免不同事件被融成同一個長期 story。

使用者已明確接受的取捨：事件變多、變小；像「台股行情」這種沒有單一具體事件的盤勢型內容會變少甚至消失。

## Part A — 待完善（依優先序）

1. **Stage A 頻道層分群還是舊規則**：`app/Services/Ingestion/ChannelAiIngestion.php` 的頻道 prompt 和 `app/Support/AiChannelContract.php` 的數量公式（min 3+⌊v/31⌋、max 6+⌈v/29⌉）仍會把單一頻道的不同新聞壓進太少的事件桶。每日合併層不能拆開頻道層已混雜的事件（媒體事件名必須逐字取自輸入）。若 Part B 驗證後仍有混雜事件，這是下一個要改的地方，改法比照每日層：單一具體事件定義 + 放寬上限。
2. **`urt_ai_event` 以事件名稱為 key**：分群粒度改變後，舊的 summary/people 詳情列會對不上新標題。觀察 `ai:event` pipeline 是否正常為新事件補生成；長期可考慮改用穩定 event id。
3. **Telegram 呈現層調整**：事件變細後，`config/services.php` 的 `daily_max_posts=1`、`hourly_max_posts=3` 與 `TelegramDigestBroadcaster::prepare()` 的排序邏輯可能需要重新權衡，讓推播挑到的事件仍有足夠代表性。
4. 任何修改前先跑完整測試（本次交接時 1012 passed / 3 skipped），改完 commit 並 push（push 是預設行為）。

## Part B — 部署滿半天後的驗證

1. **確認變更真的在跑**：確認 Dokploy 部署的 image commit 包含 `97c2f93`（參考 `AGENTS.md` 的部署記錄慣例）。沒部署的話先回報，不要繼續往下判讀。
2. **取新資料**：用 `scripts/remote-ai-tables-dump.php` 匯入最近的 `urt_ai_hour` / `urt_ai_date` / `urt_channel_ai`（唯讀、最小權限）。
3. **量化檢查**：
   - 部署後產生的每個 hourly/daily row，事件數應落在新界線內，且新聞量大時通常比舊資料多。
   - 標題中用「及」「與」串接兩件事的比例應接近零（可直接 grep `result_json`）。
   - `ingestion:health` 無新增 fail。
   - Log 中 `daily_validation` / `ai_payload_item_count_below_minimum` 失敗率沒有因新界線而飆高。
4. **質化抽查**：隨機抽 5 個事件，看其 videoId 對應的影片標題是否真的在講同一件事；再對照 Telegram 頻道實際推播，確認一則 = 一個具體事件，且 `telegram_digest_stories` 沒有把不同事件融成同一個 story。
5. **結論與下一步**：若仍有混雜事件，依混雜來源判斷是 Stage A（頻道層，見 Part A 第 1 點）還是每日合併層的 prompt 需要再收緊，提出具體修改建議後再動手。
