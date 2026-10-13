# YT Mint／ARM64 runtime 接線紀錄

唯一 owner：`d7967e77`。本文件記錄準備與實測；不授予建置名額，也不代表 UI 通過。

## 固定來源與隔離

APP 固定 `70529cff13b6b7f5b3e0571a229e2b61660f9df4`，分支
`codex/f2-mint-candidate`。OPS 的已審基底是
`b4d85dea62ed4e98bece691236ef15fe6e881234`；本批新的接線工具須經獨立審查、
提交後，在 owner 佇列另固定 successor OPS_SHA。OPS source 不是 APP build input，
不啟用 preparation 分支裡的 vocabulary、writer 或 scheduler。

Mint 上 APP 原始碼使用新的私有目錄
`/var/lib/observe-worker/youtube/sources/app-70529cff`，不改 tag 目錄。
隔離資料庫預定 `/var/lib/observe-worker/youtube/private/fixture-db`，只用
`127.0.0.1:23306` 與私有 Unix socket。API 預定 `127.0.0.1:23800`。
MariaDB 工具是 `/home/sky/observe-worker/db-tools/root/usr/sbin/mariadbd`
與同 root 的 `usr/bin/mariadb`、`mariadb-install-db`，實際版本仍須由啟動後
`VERSION()` 回填。已知工具版本 10.11.14，不冒稱正式 MariaDB 11.4。

另做了 `mariadbd --version` 唯讀核對，實際輸出是
`10.11.14-MariaDB-0ubuntu0.24.04.1`，並保存 binary hash。
receipt `.../mint-runtime-2026-10-13/mariadb-tools-095522Z.json`，SHA256
`56bbc428c80adb56e96b4b5ab7457d0f4f399629d608ef776fa5230e4730e550`。
這不是 DB startup、SQL VERSION() 或 schema 相容證據。

fixture 只從 exact APP 的 baseline／adoption SQL 與合成 seed 建立。
不搬正式 DB、個資、OAuth、API key 或帳號資料。資料集標示 `fixture`；
只啟動公開報表 API，不啟動 jobs、OAuth、ops、reader account 或 production gateway。
readiness 必須驗 SQL 身分、schema、合成資料與實際 HTTP 回應；缺少正常排名／
命中證據不能以 `/ready` 200 代替。schema 相容與 F2 fixtures 目前未驗證。

## 真正跨機唯讀 probe

UTC `2026-10-13T09:46:01.970Z`，由 Mint 經 pinned SSH 到 SM，執行既有
tag 已審的固定唯讀 script。已先核對 adapter SHA256
`7f6112ccd49090915680e03cec11552c9bb3b804eb50d3b5c0d60b3af6fae6e0`
與私有 known-host pin
`2ba9836fac4b4ee050765b6df4131adf0b0c0a349d82d9bb8a65af4504d56ef3`。
SSH 使用 StrictHostKeyChecking=yes、BatchMode、固定主機、無 proxy 或 forwarding。
上述 transport 選項來自 owner 的實際工具呼叫；這份 JSON 未保存 argv／原始
process transcript，獨立核對只能確認 receipt 的來源 pin、機器身分與實測數字，
不能由 JSON 單獨證明 SSH invocation。保留這個證據限制，不補造原始紀錄。

receipt：
`/home/deck/.cache/youtube-ui-review/mint-runtime-2026-10-13/cross-host-readonly-094601Z.json`，
SHA256 `00dc38d20655c5060cdd52ee62956011dd4de2caefcbdbeb04f71f8f75abf0fe`。
SM load1 3.311、剩餘約 64.1 GiB、當下未觀察到本機建置。
tag／blog／YT 首頁皆 200，完整 HTML time_total 為
0.448442／4.332246／0.202955 秒。Mint load1 0.28、剩餘約 151.3 GiB。
這是當時實測，不能當成之後的 fresh admission。

較早一次鎖盤點看到 tag 的 flock holder；09:46 的唯讀 probe 當下未看到 holder。
**空鎖不是 tag→YT 名額交接**。未取得交接、readiness 與真正 guard admission 前，
不啟動 YT DB／API、建置或 capture。不可手動改 capabilities 的 false。

## skyhong-blog 唯讀容量盤點

receipt：
`/home/deck/.cache/youtube-ui-review/mint-runtime-2026-10-13/arm64-capacity-094636Z.json`，
SHA256 `1e40b8f11c7e2e83df973db2e4c7c3c671d1d0a40a843ec3faf3387a8b556721`。

- 架構 aarch64；`/home` 與 `/var/lib/docker` 回報相同容量數字，available 98,995,425,280 bytes（約 92.2 GiB）。receipt 未保存 filesystem identity，不能相加推定為兩份獨立容量。
- RAM 12,506,804,224 bytes；MemAvailable 5,480,845,312 bytes（約 5.1 GiB）。
- Docker 29.7.2，Server Arch arm64，storage driver overlay2。
- buildx v0.36.1；列出 18 個既有 image，只讀 metadata，沒有 build、pull、prune 或啟動 builder。

實際新 image、BUILD_ID、原生 ELF／ABI 與 same-artifact review 尚未產生。
原生編譯及封裝只在 skyhong-blog；Mint 的 x64 套件不進 arm64 image。
預留 8 GiB peak 的策略估計，執行前仍須重新檢查兩機容量。

## 跨 host admission 與回滾

全站只准 1 個建置，Mint 共用 flock 必須由 guard 持有整段 remote lifecycle；
只拿到本機 lock 不證明全站 slot。實際 coordinator 交接、exact OPS／APP／runtime
receipt、Mint／SM／skyhong-blog fresh probes、隔離 API readiness 都不可缺少。
失去連線或 lease 時，不能把 remote compiler／BuildKit 視為已停止，不能釋放保留
名額或自行續跑。先完成 executor 的 STOP／terminal 實證，才能啟用遠端 build。

各站 time_total 上限 tag 2.0／blog 6.17／YT 2.0 秒；baseline UTC
2026-10-13T05:47:30–05:48:30Z，DNT:1、Accept:text/html、5 次首頁 HTML
curl time_total 中位數 0.256／3.085／0.289 秒。blog 的數字包含來源渲染、edge
與網路，並非精確 origin 渲染時間。load1≤12、任一 5xx／unknown／timeout 失敗關閉；
磁碟≥40 GiB 才開始，低於30 GiB暫停自己的工作。nice19／ionice-c3、Next≤2。
capture 全站≤2 browsers，DNT1、啟動前 GA／GTM 阻擋、保存實際網路紀錄。

APP runtime／OPS runtime identity、BUILD_ID、image digest、實際 UI review 均 pending。
正式維持既有 `7eb48f4`，只由 owner 用 Dokploy 切換同一份已審 arm64 digest；
回滾用保存的原 digest，保留 volume、no-new-privileges、read-only、GA guards 與
crawler log binding。既有 image／release／backup／worktree 不清理。
