# Gateway 記憶體與查詢優化（2026-10-16）

依 skyhong-SM 主機優化報告（`/home/deck/Backups/optimization-2026-10-16.md`）的方法，對 skyhong-blog 上的
youtube.observe.tw 做 RAM／CPU／IO 量測。主機與 DB 負載都偏低；主要問題是 TS gateway 約每天一次 heap OOM。

## 量測

- web task（Next + gateway）上限 1 GiB，實際 957 MiB，`memory.max` 事件 494 次。
- gateway（`--max-old-space-size=256`）兩次 `FATAL ERROR: Reached heap limit`：UTC 2026-10-15 05:46（運作 7.1 h）、
  2026-10-16 05:24（23.6 h）；gateway 中止後整個 web task 重啟。兩次前後流量平穩，也沒有爬蟲或 sitemap 重建。
- loopback inspector 遙測：heapUsed 一分鐘內 101 → 198 → 127 MB，屬於暫時性尖峰，不是緩慢洩漏。
- 10 分鐘配置抽樣：gateway 配置 15.3 GB（約 25 MB/s），約 85% 來自 `securePublicHtml`（自身拼接 + parse5）。
  用正式頁面實測，一次 `/videos`（677 KB）配置 43.5 MB；其中 18.7 MB 是對每個 integrity 編輯都重建整份文件。
- MariaDB：35 q/s，buffer pool 命中率約 99.999%；暫存表雖有 45% 落盤，但多半由 Aria page cache 吸收，IO 很低。
  0.3 s slow log 共收 30 分鐘（量完已恢復原設定）：37 筆中有 20 筆是未篩選的 `/videos` 總數查詢
  （`COUNT(*) … LEFT JOIN urt_count … WHERE 1=1`，約 1.2 s，掃描整個 urt_video 索引）。
- 爬蟲流量很小（4 天約 195 KB crawler log），不像 tag.observe.tw 那樣主導 DB 讀取。

## 變更（main `c7dbdfa`、`66e940a`、`3367c7b`）

| 變更 | 效果（實測） |
|---|---|
| `securePublicHtml` 依來源順序一次拼接 integrity 編輯；重疊編輯一律拒絕 | 每頁配置 43.5 → 29.5 MB（自身 18.7 → 4.7 MB）；5 個正式頁面的 body 與 CSP 逐位元組相同 |
| 無分類／關鍵字篩選時，影片總數查詢不再 JOIN `urt_count`（u_id 為主鍵） | 總數 691,784 不變；直連 gateway 由 654 ms 降到 9 ms |
| gateway heap 256 → 384 MB；Dokploy web 上限 1G → 1536M | 部署後 515 MiB / 1.5 GiB，`memory.max` 事件 0 |

## 發佈

- Image `sha256:20d555ad1cede81ef57982d619398a562c8d19a43e2235e11353709cc26a5cb6`（arm64）：以正式 image
  `c2e30339…`（APP `35501a3`）為底的薄層，只覆蓋 `api/src/public-html-csp.ts`、`api/src/reports/service.ts`、
  `runtime/launcher.mjs`。這三個檔案在 `35501a3`、當時的 origin/main 與原 image 中逐位元組相同；
  Next 的建置產物與 BUILD_ID 沒有變動，未占用全站建置名額。建置目錄：skyhong-blog `/home/ubuntu/yt-hostopt-3367c7b`。
- 候選容器（唯讀、只綁 loopback、writers 關閉、traefik disabled）與正式版比對 9 個頁面與 3 個 API 查詢：
  全部 200，CSP 含 `strict-dynamic`，inline hash 與 integrity 全部包含在 CSP 中，結果與正式版相同。
- Dokploy compose.update + compose.deploy：UTC 2026-10-16 12:29:46；web 與 account-maintenance 兩個服務都 healthy。
  部署前的 compose 已私有備份於 `platform/.local/dokploy/hostopt-3367c7b-before-20261016T122946Z.private.json`。
- 回滾：`python3 platform/.local/dokploy/release-hostopt-3367c7b.py --execute --rollback`
  （image 回到 `c2e30339…`，web 上限回到 1G）。

之後的 candidate 若從早於 `3367c7b` 的固定 SHA 建置，會失去這三項修正；請以包含這三個 commit 的
SHA 作為基線，並保留 1536M 的 web 上限。

## 未處理（交給 owner）

- parse5 每頁仍需約 25 MB 配置（主要在 RSC 內嵌 script 的 tokenizer）。若要再降，得改動 CSP 安全邊界的
  解析方式，需要獨立的安全審查。
- 其他 1–3 s 的慢查詢：首頁關鍵字排名／keyword candidates 的 JSON_TABLE 查詢，目前都有 deadline 與快取保護。
- skyhong-blog 上與本站無關：tmux 裡從 09-13 開著的 htop/btop 持續占用 CPU；某個 `npm exec tsx src/index.ts`
  （運作 11 天）底下有 17 個 wget 殭屍程序。
