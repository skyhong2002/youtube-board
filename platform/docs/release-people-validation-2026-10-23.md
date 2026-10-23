# Release people-validation 172f6eb（2026-10-23）：人物觀點驗證只換 worker-ai-daily

## 內容

`release/people-validation` = 正式 monitoring 分支 1720243 + main 的三個 commit（只改 `ai/src/event.ts` 與測試）：

- 357749c：人物引用的影片若來源沒提到此人，只拿掉該影片，不整份作廢。
- 9415779：來源沒出現的人（例如只出現在影片標題的評論員）與重複的人，直接略過。
- f2bbc08：AI 回傳的人全部不合格時判定失敗並重試，不發佈空白分析；回傳零人仍有效。

分支 CI：run 39847372056 success（workflow_dispatch）。main 上同內容 CI 39823769525 success。

## Image（overlay，只換一個服務）

只有 `worker-ai-daily` 會用到 `ai.event`，所以只換這個服務，web 與其他 9 個服務不動
（同時段 SEO session 換了 web，見 GSC-20261023 紀錄）。

- base：當時 worker-ai-daily 的 image `sha256:a12b06a1…`（dce5c87），tag 為 `youtube-board-ts:base-aidaily-dce5c87`
  （BuildKit 不接受 image ID 當 FROM）。
- `youtube-board-ts:release-people-172f6eb` = `sha256:feb3fdf36da7d9aa669cfb208a60ffa42af77979457e68bff29d7acfe453eecd`，
  只多一層：COPY 172f6eb 的 `ai/src/event.ts`。建置目錄 `/home/ubuntu/yt-release-people-172f6eb`。
- 核對：image 內 `event.ts` sha256 `90bb1d0a…`（= 172f6eb），`daily-source.ts` 不變（`72615fab…`）。

## 驗收與換版

- 候選：用新 image、ai-daily principal 跑 `ai:days-refresh --from=2026-10-22 --to=2026-10-22 --skip-daily --skip-cache --skip-period --call-limit=0`
  （唯讀、不呼叫 AI）：99 筆 dry-run，沒有錯誤。
- 腳本 `platform/.local/dokploy/release-service-image.py`（新增；dry-run 預設，只改一個服務的 image，其他服務逐一比對不變）。
- 與 SEO session 協調：對方先換 web（09:39:49Z completed），之後才換這邊。
- 09:41:39Z `--execute`（備份 `release-service-image-before-20261023T094139Z.private.json`），09:41:56Z worker-ai-daily completed，healthy、restart 0；
  web 未被重啟。11 個服務 1/1。
- 回復：`release-service-image.py --service=worker-ai-daily --old=sha256:feb3fdf3… --new=sha256:a12b06a1… --execute`。

## 換版後的服務 image

web `3326d8f1…`（SEO）；worker-ai-daily `feb3fdf3…`；其他 8 個 TS 服務 `65038431…`；redis `redis:7.4-alpine`。

## 尚待處理

- 主機 `/tmp/run-aidaily-events-cli.sh` 仍掛載 `/home/ubuntu/event.0-legacy.ts`（9415779 + a996ce3 查詢修正，不含 f2bbc08）。
  回補已結束；之後若要再用這個腳本，應拿掉掛載，直接用 worker-ai-daily 的 image。
- 其他服務仍是 c51bebda（`65038431…`），沒有包含這三個 commit，但它們不跑 `ai.event`。
