# 有影儀表板帳號功能交接

本機已實作 Google 登入、頻道／共同標籤／事件追蹤、影片／事件收藏、私人 RSS、管理員角色與逐人稽核。來源基準為新文易數 `afe0a653`；介面契約見 [accounts-contract.md](accounts-contract.md)。目前正式網域仍由 Laravel 服務，這份文件不代表已啟用正式登入。

## 設定與資料

- 憑證僅從 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`AUTH_SESSION_SECRET` 讀取。session secret 至少 32 bytes，透過秘密管理產生與保管；不放在 Git、測試輸出、review packet 或瀏覽器 bundle。
- `AUTH_PUBLIC_ORIGIN` 是唯一 callback origin 設定；helper 固定追加 `/auth/google/callback`。正式 callback 為 `https://youtube.observe.tw/auth/google/callback`。不得從 Host、轉送標頭或 query 決定 callback。
- `APP_ENV=production` 固定使用上述正式 origin；`APP_ENV=preview` 必須明列不同於正式站的 HTTPS origin；`APP_ENV=local` 必須明列 loopback origin。未知環境值拒絕啟用登入；production build 仍可在明列的 preview/local 模式驗證。預覽應使用獨立 Google client、session secret、資料庫與管理員名單。
- `AUTH_ADMIN_EMAILS` 是精確 email 白名單。首次經 Google 驗證後綁定 Google sub，email 日後被其他帳號使用不會繼承管理員。管理員可在 `/manage/users` 授予／撤銷其他讀者的角色；不可自行降權或覆寫設定白名單身分。
- 經審查套用 `012_accounts.sql` 與 `013_reader_accounts.sql`；啟動不自動建表。所有 `ts_auth_*`、`ts_reader_*` 表在有影儀表板自己的 MariaDB，與新文易數分離。角色稽核禁止 UPDATE／DELETE；session 僅存衍生 digest，私人 RSS 僅存 SHA256。
- Web 使用的 `DATABASE_URL` 必須對來源報表表只有所需 SELECT 權限，並對新帳號／讀者表有必要的 DML 權限。不要因登入而給 Web 來源擷取寫入權限。管理編輯的既有獨立連線、ownership 和 execute gates 仍須另行授權。
- `AUTH_TRUSTED_PROXY_CIDRS` 僅列實際確認的入口 proxy IP/CIDR；預設不信任 X-Forwarded-For。入口需清理不可信轉送標頭，並驗證不同客戶端的限流不會共用同一 IP。Next 開發代理刻意不信任瀏覽器轉送地址。

憑證未設定、部分設定或登入資料表未備妥時，`/auth/me` 回 `enabled:false`，公開頁面照常可用。登入表存在而讀者表未備妥時，只有讀者功能回 503。頁面不能以 200 或按鈕存在當成登入已通過驗收。

Web 帳號的必要權限矩陣如下；所有表均不需要 `TRIGGER`、`ALTER`、`DROP`、`CREATE` 或 `GRANT OPTION`。Migration 由獨立操作帳號執行。部署操作帳號應核對 012/013 的實際欄位、索引、引擎及稽核 trigger 定義；runtime 只讀必要 metadata。

| 表 | Web 權限 |
| --- | --- |
| 報表來源表 | SELECT |
| ts_auth_users | SELECT, INSERT, UPDATE |
| ts_auth_admin_bindings | SELECT, INSERT |
| ts_auth_sessions、ts_auth_flows | SELECT, INSERT, DELETE |
| ts_auth_role_audit | SELECT, INSERT |
| ts_reader_follows | SELECT, INSERT, DELETE |
| ts_reader_saves、ts_reader_feed_tokens | SELECT, INSERT, UPDATE, DELETE |

稽核表同時由資料庫 grant 與拒絕 UPDATE／DELETE 的 trigger 保護。權限演練只能在隔離資料庫執行：使用實際 Web 權限建立登入／角色稽核，確認修改稽核和 DDL 被拒絕；不向正式稽核資料發測試異動。

## 切換前驗收

### 已完成：HTTPS 預覽真人 OAuth 登入（2026-10-12，台北日期）

使用者經 babysit 審查者回報，已在 Google Console 加入
`https://skyhong-sm.tailf76d1d.ts.net:12443/auth/google/callback`，並在手機
Brave、連線 Tailscale 的環境下，以本人 Google 帳號成功登入。
導覽列顯示頭像，`/my`「我的有影儀表板」可開啟，包含我的動態、追蹤清單、
收藏、設定與正常空狀態；選定的 family＋迷你舊站標誌也正確顯示。
這項真人登入驗證已完成，證據來源是使用者實際操作回報；不記錄帳號識別資訊。

目前為本機封裝映像經 Tailscale Serve 提供的 HTTPS 預覽，`APP_ENV=preview`，
使用有影儀表板自己的資料庫與獨立 session secret。Google client 依使用者
明確指示複用其他本機專案的設定，沒有複製母站 session 或管理員名單。
服務端另已驗證 HTTPS 憑證、登入302、PKCE/state/nonce、Secure/HttpOnly/
SameSite cookie、取消回呼與重播拒絕；未將這些檢查冒充真人登出或資料寫入驗收。

真人追蹤／收藏增刪、私人 RSS、登出／重新載入與管理員操作尚未收到結果，
保留為完整讀者／管理流程的待驗項。**正式切換前，Google Console 仍須包含
`https://youtube.observe.tw/auth/google/callback`**；預覽登入成功不代表正式
client／secret／DB／入口組合已驗收。正式網站仍由 Laravel 提供。

### 完整驗收清單

1. 使用隔離資料庫與設定好的本機／預覽 origin 驗證。Google Cloud Console 的授權 redirect URI 需精確包含該 callback，並預先加入正式 `https://youtube.observe.tw/auth/google/callback`。不能為測試而修改正式 Laravel 路由或 Dokploy。
2. 已有自動測試以 provider doubles 驗證起始 302、PKCE/state/nonce、取消與失敗 callback、session 輪替／到期、登出、角色撤銷、跨使用者隔離、CSRF、私人 RSS 輪替與撤銷。這些不是 Google 真人帳號驗證。
3. 由使用者在預覽環境用真人 Google 帳號驗證一次：同意／取消登入、返回原頁、重新載入仍登入、登出、追蹤與收藏、私人 RSS，以及白名單管理員身分。記錄結果，不記錄 code、state、cookie、id_token、RSS 私人網址或個人 email。
4. `/manage/editorial` 預設 Google 管理員；預覽與執行稽核身分為 `user:<id>`。服務權杖替代模式為 `service:<設定名稱>`，錯誤／空 Authorization 不得退回 cookie 身分。不同操作者不能使用彼此的預覽或 request ID。
5. 保持正式工作 ownership、擷取、AI、Telegram 和部署 relay 關閉／不變；OAuth 不授權切換任何背景工作。依 [runtime handoff](../runtime/README.md) 完成備份、資料庫還原演練與正式切換審核。

公開切換前，以隔離驗收入口檢查正式設定能啟用 auth、012/013 已完整套用且 callback 字串精確；不得在該入口發起會導向仍屬 Laravel 的正式 Google callback。預覽真人測試只能驗證預覽組合。正式路由經授權切換後，必須立即由真人驗證正式 client／secret／DB 組合：`/auth/me enabled:true`、登入／登出、白名單管理員綁定、追蹤收藏及私人 RSS 無 503。`/runtime/ready` 通過不代替這項驗收。

正式驗收窗口建議最多 10 分鐘，且背景寫入維持關閉：若發現越權、callback 指向錯誤 origin 或私人回應被快取，立即隔離帳號路由並回退；若登入、角色或讀者功能在窗口內仍未通過，回退到已核准的前一版本並記錄失敗。實際窗口與執行者必須列入切換審核。入口層需在兩個不同來源 IP 下驗證獨立限流；Cloudflare／Traefik／Swarm 的實際轉送鏈未檢查，不推定單一 IP 或 overlay CIDR 必然正確，也不為此自行改網路設定。

## 失效與回退

撤銷管理員角色會在下一次 request 生效；停用使用者會使 session 和私人 RSS 失效。輪替 session secret 會使既有 session 與進行中 flow 失效。私人 RSS 外洩時由讀者建立新網址或停用，舊網址立即失效；網址只顯示一次。

角色授權不是階層繼承：撤銷某位管理員不會連鎖撤銷其先前授予其他人的角色。授權型管理員可管理其他授權型管理員，但不可修改自己或設定白名單管理員；所有異動保留稽核。

回退至 Laravel 前停止／排空 TS 寫入工作，保留 additive 帳號資料表及稽核資料；不要刪表或共享新文易數 session。Laravel 不會讀取 TS 帳號功能，應向使用者清楚標示暫停。待 TS 恢復後再重新驗證登入與讀者資料。

回退前須預備入口維護規則，讓 `/auth/*`、`/feeds/u/*`、`/api/ops/editorial*` 暫回明確的 503、`Cache-Control: private, no-store`，且敏感 URL 遮蔽仍生效；不要讓舊 Laravel 未定義的處理方式承接這些私有路由。這是待審的切換操作，現在不修改 Laravel 或入口設定。

再次啟用 TS 預設輪替 `AUTH_SESSION_SECRET`，使舊 session 與進行中的 OAuth flow 失效；重新核對白名單、授權型管理員及停用名單後才接受登入。保留 follow/save 資料。私人 RSS 使用獨立雜湊 token，不隨 session secret 輪替；已撤銷或停用帳號仍拒絕，其餘網址在重新驗收後恢復。若事故涉及 RSS token 外洩，另經審查撤銷受影響 token，不用輪替 session secret 冒充 RSS 撤銷。

應另於實際入口 proxy、CDN 與外部錯誤收集系統設定敏感 URL 遮蔽；應用程式禁記 auth callback 與私人 RSS URL，不能代替入口層的設定。OAuth/session/private RSS 不應被 CDN 快取。
