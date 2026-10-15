# F4 第三批：四頁正式畫面 review（2026-10-15）

本批拍攝 `/channels/3715`、`/channels/3715/videos`、`/tags/102/channels`、`/live/channels`，沿用正式 APP `35501a3f269f2818115ea7277c66db765a4e267d`、image `sha256:c2e30339080be1b8679d49277260e48a57ad43b6a700fd8f782054cfae856920`、BUILD_ID `b8g61kyNdOR6Pmo1TWxav`。本批沒有建置、部署或資料庫寫入。

## Capture

自有 production capture tool 在導航前安裝傳輸層 Google 阻擋，瀏覽器原生帶 DNT:1 與 GPC，保存 raw network。每頁 light/dark、1280/390 共 16 張整頁 PNG；每次前 fresh probe 均通過。主索引：`/tmp/babysit/mint-queue/youtube-f4-batch3-20261015T021627Z/production-capture-index.json`，SHA256 `fba07de4866f24931dd3667e91dc4f555bd817f0f80292a6e59489abe9725485`。淺色 probe SHA `d03d253677fd82ab2be687ea5dd55cc4115d4fb197af38cadf51be83438d1167`，深色 probe SHA `f1f2e881c6f71d5d2f05bc22bf325fcaf2ab69a3f67ab5bc37a009f25a954ece`。每頁 200、Google attempts/responses 0、DNT/GPC 保持正確；分段圖與 raw network 為執行證據，未宣稱 reviewer 全部逐張查看。

## Independent visual review

既有非作者 reviewer `/root/f2_visual_sol` 實際開啟 16 張 fullpage PNG，light/dark 四頁均回報 `PASS_SCOPED`，沒有阻擋問題。reviewer 沒有開啟另外 100 張 slices，也沒有獨立核對全批 hash、raw network 或 DNT/GPC；因此本批收據是 owner 對 reviewer 實際回覆的去歧義轉錄，不冒稱 reviewer 已簽署 immutable receipt：`/home/deck/.cache/youtube-ui-review/f2_visual_sol-2026-10-15/production-batch3-scoped-review.json`，SHA256 `a11f1b869d030ca73bd89b245a849cfc2476f45f7f76fe14aa9957b180568a9f`。

reviewer 視覺範圍仍是預設匿名畫面。查詢提交、排序/分頁/篩選互動、focus、登入、loading、error/denied 狀態維持 pending；`routeComplete=false`，本批不是完整 F4 或全站通過。正式驗收記錄：`/tmp/babysit/mint-queue/youtube-f4-batch3-20261015T021627Z/production-acceptance.json`，SHA256 `c5214f39658a774dcb5862a50e8216061238b860f394aac54042d2cc64629065`。

## Freshness and image follow-up

既有排程容器的唯讀 24 小時 bounded log 摘要在 `statistics-runtime-log-followup.json`：容器可讀、7,525 行、無未遮蔽 raw log 保存，也沒有偵測到 `youtube.videos.stats` 完成/失敗事件。這只能表示本次 log window 沒有可用的完成證據，不能推論 job 失敗；沒有執行 job、API、DB 或 writer 變更。既有 source follow-up 已證實 row `mtime`/`ctime` 不能代表每個統計欄位的成功觀測時間，故資料新鮮度仍 pending。

`ECHPW008FvY` 的 YouTube canonical thumbnail 與本站 optimizer 都是 GET 404；原因未知，保留中性 fallback，不推論影片刪除、私人或 optimizer 故障。

## Rollback / runtime

本批只做 production review，沒有新 runtime，因此沿用目前正式 image 與既有回滾點。兩個正式服務在 `services-after.json` 仍 healthy、image 與 BUILD_ID 完全一致。任何後續修正仍須另建 candidate 並保留原正式 image。
