# YT 原生 ARM executor 的離線待辦

唯一 owner：d7967e77。APP source 固定為 `70529cff13b6b7f5b3e0571a229e2b61660f9df4`，
它的 source/tree-boundary review 已通過；這不是 runtime、capture 或部署批准。
OPS runtime SHA/digest、APP BUILD_ID/digest、Mint 的每站工作目錄與隔離 API/readiness 仍未證。
SM 不新增 build/capture/restore；不改 Cloudflare/WAF，不新增帳號/grant，不清理既有檔案。
只沿用既有 reviewer instance。Mint 鎖釋放不是 readiness。

## 已核對的能力與限制

`platform/tools/guarded-next-build.py` 只監督同機自己建立的 Next session/process group；
120秒名額收據、local flock、程序盤點、nice19/ionicec3、磁碟/load/完整首頁相對閘門已存在。
它明確不控制 remote compiler 或 Docker/BuildKit daemon。這個範圍不能因文件採用 ARM 策略而擴大。

既有 reviewer 的唯讀 audit 路徑：
`/home/deck/.cache/youtube-ui-review/remote_build-2026-10-13/guard-prerequisite-audit-20261013T091022Z/review.json`，
SHA256 `30efa5c88a533de0f6f23bb884ddd9ad919a8b7c54248a628a61e179f4dd7643`，
UTC `2026-10-13T09:10:22.118225Z`。16項原有mock通過；未執行main、sample、SSH或probe。
原檔model欄位為「GPT-6 (Codex; inherited parent model, exact serving identifier not exposed)」；
保留這個限制，不把它當作GPT-6.1 Sol UI驗收或runtime證據。

## 必須完成的五個 gate

1. **真實 executor。** 在skyhong-blog的原生arm64隔離環境監督compiler與packaging本體，
   nice/ionice作用於它們；固定自己的job/session/containment身分。STOP ssh或docker CLI不代表daemon工作停止。
   不對共用dockerd、backup或其他job送訊號。
2. **跨機 admission。** Mint的全站flock需要有跨機lease與coordinator持久化reservation。
   `admitted → running → stop-requested → stop-confirmed → releasable`；
   lock/lease/連線/guardian丟失、未知或STOP-unconfirmed保留reservation，不能把斷線或flock釋放當新名額。
3. **物理停止證據。** 訊號送達不等於所有surviving owned members停止。
   必須有上限地回讀Linux狀態、辨別T/t、退出/empty、仍執行、身份變動與讀取失敗。
   local wrapper的這個缺口正另批修正並測試；它仍不能代替真實remote/daemon adapter。
4. **exact OPS/APP與隔離readiness。** 版本化收據必須綁定APP70529、獨立reviewed OPS SHA、
   owner/job generation、source/lockfile hash、arm64 base digest以及同一對OPS/APP的隔離readiness回應。
   null、錯配、過期或準備分支tip替代一律拒絕。不能推定OPS身分，不能用正式API替代。
5. **參與主機與產物。** Mint和arm64 executor都需要有時限的磁碟/load/health收據；
   runtime需ELF AArch64、Node ABI、required GLIBC_/GLIBCXX_/CXXABI_與native-module smoke證據，
   以及單一BUILD_ID的standalone/chunks/manifests/hash、pinned digest與security/volume對照。
   這些仍是待驗證契約，不能填入估算或舊產物證據。

## 執行前不得省略

新全站名額交接順序tag → YT → blog；同時一個建置、兩個瀏覽器，Next≤2workers。
開始≥40GiB、執行低於30GiB暫停；load1>12、5xx/timeout/unknown、
完整首頁tag/YT>2s、blog>6.17s都拒絕新階段並暫停自己已啟動的executor。
需依實際executor界線實作並獨立source review，不能只停止發命令的client。
無法確認停止時要明示STOP-unconfirmed並保留admission；不宣稱已物理停止。

Mint capture必須先有exact SHA/BUILD_ID/digest、隔離資料與狀態、DNT1/GPC、
啟動前GA/GTM網路阻擋、bounded去識別網路收據與累計容量盤點。
目前2060個planning packages全executionAllowed=false；376個新UI狀態pending，完整route通過0。
同一份產物review後才經Dokploy部署，保留舊digest、env/volumes與可回退收據。

這份文件只把離線audit轉成執行待辦；不宣稱有remote executor實作、host capacity、
OPS readiness、build slot或deployment approval。新增local STOP修正須另取得獨立source/test receipt，未取得前仍pending，
不修改已審查APP候選70529的committed bytes。
