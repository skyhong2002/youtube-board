# F4 第二批：四頁正式 review 與修正（2026-10-15）

本批涵蓋 `/channels`、`/videos`、`/tags/102/videos`、`/videos/kqdc4-YOmPM`。依 tag 的 T-ref 修正手機標題過窄、頻道排序值截斷、篩選區過長、搜尋框擁擠、分類名稱缺失及更新時間語意；桌機保留表格，手機提供完整標題與可展開的頻道指標。缺值仍不同於零，沒有改來源寫入或排程。

## 部署身分

- Owner：d7967e77。
- APP：`35501a3f269f2818115ea7277c66db765a4e267d`；包含 source commits `3f16dce`、`35501a3`，已推送 main。
- Build recipe OPS：`1945fc8980d58d782a595d8e11c67819520f0bbc`；擷取幾何修正 `a7c4487` 另有 source review。
- Image：`sha256:c2e30339080be1b8679d49277260e48a57ad43b6a700fd8f782054cfae856920`，arm64。
- BUILD_ID：`b8g61kyNdOR6Pmo1TWxav`。
- Dokploy 接受部署：UTC2026-10-14T22:38:31；兩個服務完成且 healthy：UTC22:39:14。持久 compose 同步；使用同一份 candidate image，沒有重建或 migration。

## 技術驗證

322 項 web 測試、web typecheck 及原生建置的全部 workspace typecheck 通過。獨立 source review PASS_SOURCE_ONLY，另跑17項 focused tests。無網路、唯讀 native smoke：Node24.21.0、ABI137、glibc2.36、sharp0.35.5，可產生44-byte WebP；Next16.3.8／React19.2.8 與 standalone traced versions 相符。

正式站七個路由200，四頁的匿名／合成隱私Cookie／RSC共12項檢查通過。實際畫面皆用自有 DNT1/GPC 工具，導航前安裝傳輸限制，保存 raw network，沒有送合成分析事件。Candidate與production分開保存審查。最初 `/videos` 擷取因表格已完整放入1118px視窗、工具卻要求正scrollLeft而失敗；原批保留且排除，修正後另目錄重拍並審查，沒有放寬網路／隱私驗收。

整頁 baseline：SM UTC2026-10-13T05:47Z，以 curl DNT:1 只取首頁HTML，各站5次time_total取中位數：tag0.256s／blog3.085s／YT0.289s，門檻2.0／6.17／2.0s。Blog的DYNAMIC time_total包含origin渲染、Cloudflare edge及網路，不是獨立origin渲染時間。目前執行前每站3次取中位數，任何單次curl錯誤或非200仍拒絕；原始開始／結束、exit、bytes、cf-cache-status均留在probe。部署後SM中位數0.055059／2.818461／0.046845s；首次冷首頁GET9.216778s亦如實保留。

## 證據

全部收據位於 `/tmp/babysit/mint-queue/youtube-f4-batch2-20261014T220850Z/`，包括 `build-result.json`、`native-smoke.json`、`candidate-acceptance.json`、`candidate-capture-index.json`、`production-identity.json`、`production-capture-index.json`、`production-http.json`、`production-privacy.json`。最終 scoped acceptance 與完整 hash 對照見同目錄 `production-acceptance.json` 及 `production-deployment-final.json`，ledger 的 `f4SecondBatch20261015` 保留原 baseline issues、排除批、實作及兩階段驗收。

T-ref：`/home/deck/Projects/tag-sm-f1-release/docs/cross-site-consistency.md`（tag ff511870；SHA256 `3d8e72036aab6cc73b3061f1b1d94afb1292d39b4bf86f1a65fc83945632eb91`）。Baseline receipt SHA256 `e53117e985fbb68465262d207b9a9b7ff209f4a26abf3efcbdbf6ddcb5ea1d73`。

## 回滾

目前回滾版為 `sha256:5816d4eec144c5c162ad3954aef4298fa36a5ecfc9476315e1ad9d0a59ecfb91`（APPfe798794）。已驗證 dry-run：

```sh
python3 /tmp/babysit/mint-queue/youtube-f4-batch2-20261014T220850Z/deploy.py --execute --rollback
```

此命令同步還原 Dokploy compose，再部署既有 image。Dokploy 無法操作時可在 skyhong-blog 對兩個服務分別執行 `docker service rollback`；之後仍須同步持久 compose。備份、正式資料及 source worktree 均保留。

## 尚未關閉的事項

- 縮圖 `ECHPW008FvY` 的原始 YouTube URL 與本站 optimizer 均GET404；保留中性佔位，來源不可用原因未知，不能推論影片已刪除／私人或optimizer故障。
- `updatedAt` 來自來源記錄時間，不能證明每項觀看／喜歡／留言統計同時更新。本批釐清顯示，沒有宣稱修復 ingestion freshness；mayor 跨次 coverage 差異亦未證實原因。
- 補充離線 source audit：`youtube:videos:stats` 會保留缺失欄位的前次已知值，正常 schedule 分支更新影片統計時並不更新影片列mtime。影片列時間也未必代表最近一次poll；需進一步核對既有job完成紀錄及逐欄觀測證據，本批沒有執行job。證據：`statistics-freshness-source-followup.json`。
- 其他 query、empty／error／denied、登入、篩選提交、搜尋展開與sticky行為仍 pending；沒有全站或完整F4 PASS。先前版本截圖不沿用到此SHA。
- 下一批待 review：`/channels/3715`、`/channels/3715/videos`、`/tags/102/channels`、`/live/channels`。

## 第二批最終正式畫面審查

非作者 `/root/f2_visual_sol` 獨立 production 審查 PASS_SCOPED，八個 baseline 問題均在本次正式圖中確認解決，沒有繼承 candidate approval。四頁共16個view；172張PNG hash核對、104張實際看圖（16整頁、80原生分段、8互動），其餘68張只核對hash。正式raw network保留1,588筆request與55個ERR_ABORTED；Google attempts/responses皆0，不能宣稱所有請求無錯誤。

獨立收據：`/home/deck/.cache/youtube-ui-review/f2_visual_sol-2026-10-14/production-app35501a3-batch2-20261014T225408Z/review.json`，SHA256 `18e233eaf3779c40c121db8ae75442590377374db988bb4c0393e2555bda1810`。最終驗收 `/tmp/babysit/mint-queue/youtube-f4-batch2-20261014T220850Z/production-acceptance.json`，SHA256 `b2c301f7a56dcc95fd0dbabdd488edac658ee4a8221a0c68a94d8fd9fed73a5d`。最終部署 `/tmp/babysit/mint-queue/youtube-f4-batch2-20261014T220850Z/production-deployment-final.json`，SHA256 `bf9042ceda3cb5fbd64cacb2fd3193c3559045e406a7acc97477fdae8935bb6c`。原部署快照保留不改；candidate與production分開記錄。

T-ref變動註記：原已讀內容SHA3d8e7203…由先前不可變審查收據保存；目前共用檔SHA `ef280fabd036489c7afe1eb8c564b9524eb88251ad4c3b4ed32e3342252c0d68` 只核對hash，內容未重讀且排除於本次審查，沒有宣稱最新T-ref已驗收。正式影片總數683,606／683,612跨次差異照實保留，不能推論資料新鮮度。最後SM三次中位數tag0.053712／blog2.280847／YT0.052418秒皆通過；兩個服務仍healthy。另一份babysit正式瀏覽器驗收尚未收到。
