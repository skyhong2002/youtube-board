# YT Mint／ARM64 交接策略

唯一 owner：**d7967e77**。此文件是策略，沒有啟動建置、封裝、capture 或部署。
全站名額順序為 tag → YT → blog；需 babysit 的新交接才能開始。
SM 不新增 build／capture／restore，既有 release、回退、備份與 worktree 全部保留。

## 選定的產物路徑

**在 skyhong-blog 原生 arm64 隔離環境完成編譯和最終映像封裝，Mint 只做瀏覽器 capture。**
這個遠端工作仍占全站唯一建置名額；不是利用遠端主機繞過排隊或資源閘門。
不在 Mint 安裝 Docker/MariaDB、不跨平台重新拼裝 x64 standalone、不使用 Mac 運算。

固定來源為乾淨 committed tree `e137c5f0a4c0184fe5bae8330b410eed74a07063`，
分支 `codex/f2-mint-candidate`。這個 SHA 尚無 BUILD_ID／映像／視覺通過證據。
準備分支上的新 UI 修正須先提交、獨立 source review，再明確組成新的固定後繼 SHA；
不能自動跟隨準備分支 tip，不能把 e137 或舊 654 的證據移用到後繼 SHA。
quality writer／詞庫匯入器另批保存，不藉此開啟 jobs、migration、grant 或 Y2／review flags。

使用 `platform/package-lock.json`，SHA256
`df597842a9b56d4fe32047ee776a53a8c6f18fb3a210720dcb6cf2b8a396d11f`。
原生 ARM target 內執行 `npm ci`，保留 optional native dependencies；
單次 webpack build、Next workers ≤2，核准的 `NEXT_PUBLIC_GA_ID` 在建置時保留，
candidate hostname／DNT／GPC／automation guards 和網路阻擋繼續生效。
Next16.3.8、React／React DOM19.2.8 需依該 committed lockfile 和實際 runtime 核對。

使用同一個已核對、固定 digest 的 linux/arm64 Node24.15.0 Debian/glibc base
產生 build 和 runtime；可用性與實際版本在名額交接後查證，不能僅依可變 tag 宣稱一致。
若現存 image 不符合，需要先記錄真正版本及獨立 review，不能偷偷改版本或借用舊產物。
一份來源／lockfile、一份完整 standalone／static／server chunks／manifests／public／runtime
及其 traced dependencies，全部取自同一輪建置；禁止補上一層舊 chunks 解決缺檔。

## Mint 工具鏈與架構／ABI

coordinator 的 UTC2026-10-13T08:08 readiness：Mint-MBP、user sky、x86_64，
Node24.15.0／npm11.12.1；非互動 shell 要設定：

```sh
export PATH=/home/sky/observe-worker/toolchain/node-v24.15.0-linux-x64/bin:$PATH
```

worker root `/var/lib/observe-worker`，全站鎖 `/run/lock/mint-global-build.lock` 已準備。
每站工作目錄與隔離 API／readiness 尚待 coordinator 指定／接好，
**不得拿正式 API 作 candidate 的替代資料源**。

使用者實測 Mint glibc2.39、SM glibc2.41；兩者 Node24.15.0／module ABI137 相同。
這些資料不能證明 skyhong-blog 的 ARM runtime，也不能把 x64 原生模組變成 arm64。
Mint 只使用自己的 x64 瀏覽器依賴；不向映像傳送其 node_modules、.next 或 native binaries。
正式 target 容器的 Node／ABI／glibc 需分別量測並保留原始收據，Mint 系統不升級。

原生依賴驗證不能只看版本號或標籤：

1. 從最終映像列出實際存在的 `.node` 與其相依 `.so`，
   包括 sharp／libvips；其他套件（例如 better-sqlite3）只在實際 shipped 時驗證，
   不因舉例而新增套件。
2. 對每個 ELF 檢查 AArch64 machine、loader 與相依庫；
   `readelf --version-info` 的 **required `GLIBC_` symbol versions**
   要由實際 target libc 提供；同時檢查需要的 `GLIBCXX_`／`CXXABI_`。
   記錄檔案 hash、需求集合與 target 提供的版本證據。
3. 在最終映像的隔離 arm64 runtime 執行 smoke test：
   `process.platform=linux`、`process.arch=arm64`、Node module ABI137；
   由 gateway 和 Next standalone 的實際模組解析路徑載入 sharp，
   做記憶體中圖片 decode → resize → WebP／AVIF → decode，核對尺寸；
   其他 shipped native 模組也在該 target 載入。這不使用正式 API／DB。
4. 核對 OCI config 為 linux/arm64，`docker image inspect` 的架構和實際 runtime 一致，
   再核對 BUILD_ID、全輸出逐檔 hash、Next／React 解析、manifest 的 chunk references。
   只有 `--platform` 或 image label 不算架構／一致性證明。

## 執行器與全站安全閘門

取得新名額後，先在 Mint 持有全站 flock；原生遠端編譯／封裝期間也持有它。
鎖或協調連線中斷需暫停自己的遠端 executor，不能釋出名額讓兩站同時建置。
`STOP-unconfirmed` 或 remote-unreachable 時，即使 flock 已失去，coordinator 仍保留
全站 admission reservation，直到自己擁有的 executor 確認停止；不能把斷線當名額可用。
跨主機鎖生命週期及 STOP guard 必須先完成獨立 source review；未完成就不啟動。
`nice -n19 ionice -c3` 要作用在**真正的 compiler／packaging executor**；
只 nice／STOP ssh 或 docker CLI 不能控制 daemon 裡的工作。
guard 要能確認 SIGSTOP 到自己擁有的 executor/process group；不 STOP 共用 dockerd、
別人的工作或 tag-backup。既有 generic Dockerfile 不自動證明這個 guard 已存在。

各階段檢查參與主機容量、load、全站健康：開始至少40GiB，低於30GiB 暫停；
load1>12、任一站5xx／逾時／未知狀態，或首頁完整 time_total 超限，停止新階段並暫停自身建置。
固定 baselineUTC2026-10-13T05:47Z，DNT1、只抓完整 HTML、5次中位數：
tag0.256s →2.0s、blog3.085s →6.17s、YT0.289s →2.0s。
blog 的 DYNAMIC time_total 包含 origin 渲染、Cloudflare edge 與網路，非精確 origin 渲染時間。

估算 remote peak8GiB、runtime image0.9–1.3GiB，frontend2–5min、封裝5–15min；
這是規劃預算，不是 Mint／新 candidate 的實測。名額交接時重新量測。
Mint capture 全站最多2個瀏覽器、每批≤90MB、既有與新增合計≤300MB；
啟動前阻擋 GA/GTM，DNT1/GPC、禁止 service worker，保存 bounded sanitized 網路收據。

## 同一份產物的驗收、部署與回退

在 skyhong-blog 啟動無公開 Traefik／OAuth／scheduler 的隔離 arm64 candidate，
沿用 reviewed SELECT-only source 與已授權隔離 state，crawler log 使用隔離目錄。
Mint 透過私有 tunnel 存取該 gateway，先接好隔離 API／readiness，再拍實際畫面。
manifest 必須包含 exact SHA／BUILD_ID／image digest、PNG hash、網路證據與 pre/post gates。
核心 `/`今日／近七日、`/keywords`、支持影片證據、`/channels`、`/videos`、
`/live/current`、`/mayor` 先驗，其他 ledger states 逐頁完成；淺／深、1280／390、
loading／empty／error／互動也需由作者以外 reviewer 實際看圖。
零 GA 未證或 route pending 不能升級成 pass。

只透過既有 Dokploy 權限更新到**同一份已 review 的 arm64 digest**，不再建置。
release 前保存真正運行 digest、compose／Spec 的去秘密差異與回退可用證據。
read-only、cap_drop、no-new-privileges、tmpfs／資源限制、GA guards、
`/var/lib/youtube-board-ts/crawler-logs` persistent binding 全部保留。
不改 CF/WAF、schema、背景 writer、grant 或 scheduler。

最後已知正式基線 `7eb48f4`，digest
`sha256:5b7d9171d9633c132766c65abd934c791787693a72b7f016bcd1408097dedadd`。
發生錯誤經 Dokploy 回到 release 前實際保存的 digest、保留 env／volumes；
不用 `docker service update`、不尋找新 API key。
既有 rollback archive／備份保留，這批無 migration，程式回退不覆蓋 DB。
部署後交 babysit 做正式站实际畫面驗收，之前不稱全部完成。
