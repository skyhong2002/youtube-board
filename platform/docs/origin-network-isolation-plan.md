# 共用主機 origin 與資料庫網路隔離計畫

狀態：**僅供使用者審閱，尚未實施**。本次只讀取必要的非機密設定、DNS，並做四次公開首頁 HEAD；沒有修改 firewall、Cloudflare、Traefik、Docker network、MariaDB 帳號／權限或任何正式資料。日期：2026-10-12，約 10:00 UTC。此文件處理第 6 輪安全審查 #2／#7；實施須另取得明確批准，不能從既有重寫／部署授權推論整台共用主機的變更授權。

建議先對 `youtube.observe.tw` 做 hostname 範圍的 origin 限制，再將有影資料庫搬離共用 overlay，最後收斂遠端 root。**目前不能直接把整機 80／443 改成僅接受 Cloudflare**：六個正式 hostname 直接指向 origin，且共用 ACME 使用 HTTP-01。

## 唯讀盤點與證據範圍

SSH 別名 `skyhong.tw` 連到 `skyhong-blog`，公開 origin 為 `217.142.232.200`。Docker 是 active Swarm。讀取時在主機端過濾 `docker inspect` 與 Traefik YAML，只輸出 hostname、router 名稱、entrypoint、TLS option、網路參與者與 published port；未輸出 env、完整 labels、basic-auth 雜湊、router 路徑規則或秘密。

Cloudflare 判斷使用當時的 DNS A／AAAA 結果是否落於專案已釘選的官方網段；這是 DNS 證據，**沒有讀取 Cloudflare zone 控制台，也不代表所有安全功能已啟用**。

| Traefik hostname | DNS 指向 | 所屬用途 | 全機 CF-only 的影響 |
| --- | --- | --- | --- |
| `youtube.observe.tw` | Cloudflare A／AAAA | TS 公開頁、帳號；保留 Laravel／ops 路由 | 可做此 hostname 的獨立限制 |
| `pma-youtube-board.skyhong.tw` | Cloudflare A／AAAA | 有影 phpMyAdmin | 保留既有登入防護；優先另評估 Tailscale-only |
| `skyhong.tw`、`www.skyhong.tw` | Cloudflare A／AAAA | Ghost | 必須經站主驗證後才能一同限制 |
| `infovore.skyhong.tw` | origin A | infovore／ingest | 會被切斷 |
| `status.skyhong.tw` | origin A | 狀態站 | 會被切斷；監控本身也需保留 |
| `n8n.skyhong.tw` | origin A | n8n | 會被切斷；webhook／第三方回呼另驗證 |
| `rss.skyhong.tw` | origin A | FreshRSS | 會被切斷 |
| `plaud.skyhong.tw` | origin A | 舊址 router | 會被切斷，須保留既有轉址行為 |
| `bridge.skyhong.tw` | origin A | webtunnel／camouflage | 會被切斷，不能假設適合搬進 CDN |
| `dokploy.docker.localhost` | 未查公開 DNS | Dokploy 本機 HTTP router | 不屬於 CF hostname；管理入口另處理 |

四次從本機直連 origin、使用正確 SNI／Host 且正常驗證 TLS 的 `HEAD /` 結果：

| Host | 直接 origin HTTP 狀態 | TLS 驗證 |
| --- | --- | --- |
| `youtube.observe.tw` | 200 | 通過 |
| `pma-youtube-board.skyhong.tw` | 401 | 通過 |
| `skyhong.tw` | 200 | 通過 |
| `bridge.skyhong.tw` | 200 | 通過 |

因此有影目前確實可以繞過 Cloudflare 直接取得公開頁；phpMyAdmin 回 401 表示其基本認證仍生效，**不是未授權資料存取證據**。未對登入／管理功能做攻擊或大量掃描。

入口觀察：

- `dokploy-traefik` 發布 TCP 80、TCP／UDP 443 至 `0.0.0.0` 與 `::`。目前 web／websecure 皆未開啟 `forwardedHeaders.insecure`。
- `letsencrypt` resolver 使用 `httpChallenge.entryPoint=web`；沒有 DNS-01／TLS-ALPN-01 設定。不能以關閉 80、全站 AOP 或全域中介層阻斷 HTTP-01 續期。
- 動態設定未見要求 client certificate 的 TLS option；有影 cutover 檔案只有一個 local-only IP middleware，這不代表公開 router 已被 origin 限制。
- IPv4／IPv6 `DOCKER-USER` 皆沒有規則。IPv4 INPUT 有 80／443 ACCEPT，Docker published-port 另有 DNAT／FORWARD 路徑；僅調 UFW／INPUT 不足以證明 Docker 入口被封。
- Dokploy 3000 有 published port，亦有現存 `DOKPLOY_TS_ONLY` 與 Tailscale 規則；本次未驗證其所有鏈／上游 ACL，不宣稱 3000 公網可用，也不修改它。
- 有影 MariaDB 沒有 published port。主機另有 `mysqld` 綁 `127.0.0.1:3306`，不能把這個不同程序誤當 Swarm 有影 DB 的公網入口。
- 未查雲端 NSG／security list，未做外部 IPv6 origin 連通測試；Docker 的 IPv6 bind 不等於主機已有可達的公網 IPv6。

## 共用網路現況

`dokploy-network`：Swarm overlay、`10.0.1.0/24`、`attachable=true`、`internal=false`。同時包含：

| 類型 | 實際參與者（省略 task 隨機尾碼） |
| --- | --- |
| 有影 | `youtube-board-db-qcja1i`、`youtube-board-web-mwafzd`、`youtube-board-scheduler`、`youtube-board-pma-dxtxrr`、`youtube-board-ts-6oukfq_web`、`youtube-board-ts-6oukfq_account-maintenance` |
| 平台 | `dokploy-traefik`、`dokploy`、`dokploy-postgres`、`dokploy-redis` |
| 其他網站 | `ghost-docker-7fw0la-ghost-proxy-1`、`infovore`、`infovore-ingest`、`n8n`、`freshrss`、`sky-status-dashboard-status-dashboard-1`、`webtunnel_camouflage`、`webtunnel_webtunnel-bridge` |

其餘已觀察網路：Ghost app／DB 在獨立 `172.18.0.0/16` bridge（但 `internal=false`）；status docker-proxy 在獨立 `172.20.0.0/16` bridge（`internal=true`）；Traefik 另連 default bridge。`docker_gwbridge` 與 Swarm `ingress` 是 Docker 系統網路，不應在本次遷移中改建。

DB 不發布 3306 可以阻擋一般公網直連，**不能阻擋共用 overlay 其他容器的網路接觸**。此盤點只證明共享網段，未主動从其他容器連 DB，也未檢查／輸出正式帳號密碼或 authentication strings。

## 階段 A：只限制有影 hostname 的 origin

建議選 A1 或 A2 為第一個可獨立驗收的變更；由使用者審閱後選定。保留現有 HTTP-01、Tailscale 管理與其他 hostname。

### A1：Traefik 有影 router 的 Cloudflare source allowlist

改動最小，但只辨識 Cloudflare 網路來源，不等於指定 zone 的身分。

1. 先備份受保護的動態設定，確認 Dokploy 重新部署不會覆寫規則；列出 `youtube.observe.tw` 所有 router，包括低優先序 Laravel fallback 與未來產生的 router。
2. 用經核對的官方 IPv4／IPv6 網段限制實際 TCP peer；不可直接相信使用者提供的 XFF／CF-Connecting-IP。以測試確認 Traefik 所見 peer 及 ipAllowList 的選址策略，不假設 Fastify 的設定可以直接套用。
3. 所有有影 HTTPS router 都套用相同限制，或使用經驗證的 hostname ingress 統一限制。低優先序 fallback、另一個 Host alias、SNI/Host 不一致都不能繞過。HTTP 對應 router 也需處理，但 ACME 內建 challenge 路由必須繼續可達。
4. Tailscale 管理若需直連同一 hostname，只允許經實測的 tailscale ingress／明確管理來源；不能把整個 Docker overlay、RFC1918 或可偽造 header 加成例外。公開健康檢查改走 CF；本機容器健康檢查繼續走內部端點。
5. 驗收：正常 CF 請求／OAuth callback／RSS／登入可用；外部直連 origin + 正確 Host/SNI、偽造 forwarded headers 皆拒絕；其他 hostname 與續期不受影響。

### A2：只對有影 SNI 啟用 Authenticated Origin Pulls（AOP）

防護較強；优先考慮可識別本帳戶／hostname 的自訂 client certificate，先確認方案支援。Cloudflare 共用 AOP certificate 只證明來自 Cloudflare，不能當作本 zone 的唯一授權。Origin CA 是伺服器憑證，與 AOP client certificate 不同。

1. 先確認 Cloudflare 對 `youtube.observe.tw` 的 SSL 模式、AOP 功能／證書支援與 certificate rotation 流程；秘密／私鑰只放受保護設定，不進 Git／packet。
2. 先讓 Cloudflare 開始送 client certificate，再於 origin 的有影專用 TLS option 要求並驗證它。先以不承接正式流量的配置／測試入口驗證，不能直接全域 `RequireAndVerifyClientCert`。
3. Traefik TLS option 由 SNI 選擇；同一 hostname 所有 routers 必須一致，不能用 HTTP path 區分 mTLS。驗證 SNI/Host 不一致及 default TLS option，不讓其它 router 搭便車，也避免同 host option 衝突回落 default。
4. AOP 會阻斷無 client certificate 的 Tailscale直連該 SNI；管理可走 CF，或使用獨立、僅 tailnet 可達的管理 hostname／entrypoint。不要為了管理例外取消公開有影 hostname 的 client verification。
5. HTTP-01 仍在 80 上獨立保留；443 的其他非 CF hostname 不變。驗收除 A1 項目外，必須有無 client cert／錯 client cert 均被拒絕，以及正常 CF 驗證成功的證据。

A1／A2 回滾：保留雙管理連線與不依賴公開網站的 SSH／Tailscale／雲端 console。只還原本次有影 router／TLS option；AOP 要先解除 origin 強制，再停 Cloudflare 送 cert，避免持續 525。公開登入、回呼、CF可用性或非有影站失敗即回滾。不得用關閉 TLS 驗證、開放全域來源作臨時修復。

### 暫不採用：整台主機只允許 CF 入站 80／443

六個 DNS-only 站目前共用同一 IP／port；L3/L4 firewall 無法依 Host／SNI 留例外。因此必須先替非 CF 網站安排獨立 public IP／listener／host，或逐站批准其遷移方式，才能談全機封鎖。webtunnel 的協定／營運需求尤其不能自行改成 CDN。

若未來採用：先取得完整非 CF／ACME／監控／tailnet 清單，決定 DNS-01 或可證明可用的 HTTP-01 續期，處理 IPv4、IPv6、TCP80/443 及目前發布的 UDP443。依 Docker 實際 iptables／nftables backend，兼顧 INPUT 與 DNAT 後 FORWARD／DOCKER-USER，不全表 flush，不覆蓋 Tailscale／Swarm 規則。建立精確、有期限且已測試的自動回滾；以外部節點驗證后才持久化。CF range 更新要有驗證、差異審查及 last-known-good，下載失敗不可清空 allowlist。這部分須另提可審閱的規則 diff，不在本文件直接執行。

## 階段 B：有影專用 overlay

目標拓撲：

- `youtube-edge`：只連 Traefik、有影 web／必要的既有 Laravel HTTP入口；需要時才連 pma。Traefik 仍能服務其他站，但不能直接連 `youtube-data`。
- `youtube-data`：獨立明確 CIDR、優先 internal/non-attachable overlay，只連有影 MariaDB、實際需 DB 的 TS web／account-maintenance／批准 workers、仍負責寫入的 Laravel scheduler／web、核准的維護端。沒有 published3306。
- 需要 Google／YouTube／CLI Proxy／tag 等外連的 process 使用獨立 egress 路徑；不能把 DB 加回共用 network 來恢復外連。獨立 overlay 不隔離 Docker daemon／宿主機 root，受信任雙網路 app 仍是風險邊界。

子網必須先與主機、所有 Docker network、Tailscale及其他 Swarm node路由比對，本次不任意指定未驗證的 CIDR。若採 encrypted overlay，先驗證效能、MTU、節點支援，再獨立批准，不與首次隔離一起改多個維度。

依賴與順序：

1. 確認最新一致 mixed-engine 備份、offhost copy 與隔離 restore；保存目前 service/Dokploy 宣告和 nonsecret network配置。不得以本計畫取代 writer handoff；既有 Laravel 寫入 ownership不變。
2. 在隔離複本演練新 CIDR、新 service DNS／alias、最小權限帳號來源 host及 connectDatabase grant assertions。現有 `10.0.1.0/255.255.255.0` 帳號限制不能直接沿用到新網；避免 `%` 臨時放行。依新網段增加同權限的 scoped principal，驗證後才移除舊 host grant。
3. 將 network與service宣告寫入 Dokploy 持久配置；只改 live service會在下次 redeploy丟失。備妥明確 network選擇，避免 Traefik在雙網路 service選错 backend IP；檢查 healthcheck、DNS、VIP、rollback image、worker secret references。
4. DB 暫時雙網路並不算隔離完成。新增網路會使 Swarm task重建；**單副本 MariaDB不能讓 start-first兩個mysqld同時掛同一volume**。先演練明確 stop-first／維護窗口及writer drain，不能把它當零停機設定更動。保留原volume與schema，不作資料搬遷／版本升級。
5. 逐一遷移clients，實測 SELECT、TS私有帳號功能、writer preview／健康、AI gateway及備份還原入口。不得趁機啟用新writer。account-maintenance不需要HTTP ingress，僅保留必要data／egress；pma如需保留，明確批准其雙網與認證。
6. 全部clients確認走新data路徑後，移除 DB 的 `dokploy-network`、移除clients不必要的共用network，驗證從其他網站network無DB路由／連線、Traefik不在data網、DB仍沒有published port。測試用臨時維護端要列入建立／刪除批准，不自行連入別人的app測試。
7. 重部署一次確認設定持久；驗證sessions、follows、公開報表、media cache、備份、scheduler仍正常；觀察連線錯誤與DB row/engine inventory。只有完成以上才標記 network isolation完成。

B回滾：保留舊scoped帳號至整個窗口驗收；依保存的service宣告復原 network與DNS設定，按相同單writer／單mysqld規則重建，絕不啟動第二個共享volume的DB。回滾只恢復路由／secret references，不能回滾資料快照覆蓋新寫入。若需要重接共用network，明確記錄隔離已撤銷及暴露窗口，不能宣稱仍完成隔離。

## 階段 C：`root@%`／遠端管理權限收斂

本次沒有查詢正式 `mysql.user` 或匯出 GRANT，因此 `root@%` 的目前存在、認證plugin及實際使用者，仍須下一個**批准的唯讀 DB inventory**確認；不把審查指出的風險當成本次重新驗證的事實。與網路隔離分批做，避免同時失去DB管理和應用連線。

1. 僅列 User、Host、plugin、授權類型與必要連線來源，不取authentication_string／password hash。不輸出完整env、`SHOW CREATE USER`或含憑證的指令。核對Dokploy資料庫管理、備份／restore、pma、遷移、worker bootstrap與監控是否使用遠端root；只查設定引用／帳號名，不抓密碼。
2. 先在隔離restore驗證 container-local socket／`root@localhost`的break-glass路徑；至少兩條有效管理路徑，含主機SSH/Tailscale加container-local管理。不能假設改 image 的初始化env會更改現有volume帳號。
3. 為備份／維護建立分開的最小必要權限、限定新data網／明確管理來源帳號；mixed-engine一致備份所需鎖權限須實測，不能無證據收成只讀導致備份悄悄不一致。使用者批准後以受保護的runtime secrets切換；不影響report/state／workflow權限隔離。
4. 排定觀察窗，驗證正常備份及隔離restore、Dokploy必要功能、schema工具、writer日常運作均不再依賴root@%；再按批准順序先停用／鎖定或收斂精確舊帳號，最後移除。MariaDB版本與ACCOUNT LOCK語意須先演練，不以連續猜指令處理正式庫。
5. 驗證遠端root拒絕、local管理可用、應用users無新增權限；新grant的Host匹配以實際CURRENT_USER確認。不得為了通過測試擴回 `%`。

C回滾：在變更前保存加密且限制存取的必要帳號／授權還原材料（不可放Git／review／聊天），驗證local管理可復原。需要時只復原被改動的管理帳號及其secret reference；若暫時恢復廣泛來源，明確列安全退回狀態及截止時間，持續保留network隔離。不能以重建database或還原資料dump來撤销帳號變更。

## 提交使用者審閱的批准單位

| 批准單位 | 建議範圍 | 前置驗收 | 回滾依據 |
| --- | --- | --- | --- |
| A1或A2 | 僅有影hostname；不改其他站／全機firewall | 完整router清單、ACME/CF/client-IP或AOP演練、可用管理路徑 | 該hostname設定備份／精確diff |
| B | 有影edge/data/egress與指定服務；single-DB維護窗口 | 隔離restore演練、scope grants、備份、所有client及egress清單 | 原service宣告、原volume、舊scopedgrants |
| C | 明確列出的管理principal／依賴者 | root依赖唯讀盤點、local break-glass、備份與restore成功 | 受保護的帳號授權還原材料 |

以上三項都需在實施前提供具體變更diff、影響服務、驗收與回滾步驟，由使用者批准。此文件本身不執行任何變更；全機CF-only仍不在建議的第一批範圍內。
