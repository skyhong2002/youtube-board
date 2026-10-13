# F2 TS 自有狀態備份與還原驗證

驗證完成：2026-10-12 19:40:54 UTC。這一份是 TS 自有狀態與安全結構備份，不是新的 youtube_board 來源資料全量備份。既有來源一致性備份完整保留，見 production-prewriter-backup-2026-10-12.md。

- 主機檔案：`/home/ubuntu/backups/youtube-ts-f2-20261012T191504Z/snapshot.tar`。
- 異地主機副本：`/home/deck/Projects/youtube-board/platform/.local/dokploy/f2-backup-tools/offhost/snapshot.tar`。
- 大小：36,904,960 bytes；SHA-256：`a87b4986242da8addacdb2544984db4dcb3d37cafb6de0b081f5db3bc9cffaa3`。
- 36 張 TS 表、467,005 列：還原後逐表筆數與 dump 內容的 multiset SHA 全部相等。這不是另一個時點直接 SELECT 正式表筆數的比較。
- 5 組 scoped 帳號與授權的 authentication／grant 定義完全一致；48 個 view 可解析，10 個稽核 trigger 定義一致，並實際拒絕不允許的 mutation；探測列回滾。正式帳號未變更。
- 原始正式 MariaDB arm64 與隔離還原 amd64 都是 11.4.13-MariaDB-ubu2404，官方 multi-arch manifest 對應已驗證。隔離 clone 無網路／公開 port，限制 1 CPU、1 GiB，nice19／ionice idle；匯入時 clone-only flush2、512 MiB buffer，驗證前讀回 flush1。正式設定未變更。
- 隔離 clone 驗證後移除。本次所有 archive、失敗紀錄、診斷與先前備份都保留。
- 前兩次失敗原因為 MariaDB JSON user variable 數字型別與 clone durability reset 誤走 read-only helper；均 fail closed，修正後先跑 schema-only 真實測試再完成全量驗證。34 項備份 guard＋5 項跨架構 release 測試通過。

私有驗證收據：`platform/.local/dokploy/f2-backup-tools/f2-backup-handoff-receipt.json`（原工作樹）。完整 restore proof SHA-256：`30eb3bc0c7202f8d47e5dfd964347aa9053bad6ed7a4bfb8328fffb86dc1ff14`。工具與 review packet 不包含於本發布；密碼、帳號 authentication 字串與 `.env` 不放入文件。

此證據不會自動開啟 writer。公開頁第一批仍只讀來源；第二批的候選 stage、execute、activation 必須通過獨立審查與操作 gate，保留舊版本 current 指標回退路徑。
