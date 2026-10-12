# Google 登入與讀者功能介面

此階段來源為 tag.analysis.tw commit `afe0a653` 的 auth/store、reader routes、session 和登入/帳號元件（MIT）。只有使用者明列的追蹤、收藏、私人 RSS 與管理角色移植；不自動啟用閱讀紀錄或個人 API key。

唯一正式 origin 是 `https://youtube.observe.tw`，callback由單一 helper 產生 `/auth/google/callback`。本機 origin由 AUTH_PUBLIC_ORIGIN指定。Fastify owns下列精確路由；auth core不用prefix wildcard hook，reader模組只owns明列的/me/*。開發 Next只代理固定/auth/*至內部API；正式gateway直接處理，不轉給Next。認證資料不進公開報表SSR。

| 端點 | 契約 |
| --- | --- |
| GET /auth/google?next=... | 302至Google；next只准本站單一斜線相對路徑，拒絕反斜線、控制字元、跨站與/auth迴圈，fallback /my |
| GET /auth/google/callback | 精確路徑；成功303至flow儲存的next，失敗303 /login?error=state/cancelled/invalid/failed；不接受callback query指定redirect |
| GET /auth/me | shared/account-contracts.ts AccountSession，disabled回enabled:false,user:null,csrfToken:null；不快取 |
| POST /auth/logout | 同源 Origin、x-csrf-token，刪除session後204；UI清除帳號狀態後返回/ |
| GET /auth/users、PUT /auth/users/:id/role | admin專用；修改需同源/CSRF，role admin或reader，禁止自己修改/設定白名單管理員修改，寫audit |
| GET/PUT /auth/me/follows | PUT {kind:channel\|tag\|event,target:string,follow:boolean}；GET/PUT回{follows:AccountFollow[],max:200} |
| GET/PUT /auth/me/saves | PUT {kind:video\|event,target:string,saved:boolean,note?:string}；回{saves:AccountSave[],max:500}。note最多500字，拒絕控制字元（允許換行/tab）；移除不要求來源仍存在 |
| GET /auth/me/feed | AccountFeed；最多150項，近7日，updated/published降冪與kind/target穩定tie break；影片和事件保持不同kind |
| GET /auth/me/feed-token | {active:boolean,createdAt:string\|null}，不回傳既有token |
| POST /auth/me/feed-token | {url:string,createdAt:string}，新的私人URL只回傳一次，舊URL立即失效 |
| DELETE /auth/me/feed-token | {active:false} |
| GET /feeds/u/:token.xml | 私人RSS，no-store/noindex/no-referrer；不存在、失效、停用帳號皆404 |

所有私人寫入需要同源Origin與session CSRF；沒有CORS header。401 SIGN_IN_REQUIRED、403 ADMIN_REQUIRED/CSRF_REJECTED、503 AUTH_DISABLED/ACCOUNT_UNAVAILABLE，JSON形狀統一{error:{code:string}}。Reader input違規400 INVALID_REQUEST/INVALID_TARGET/INVALID_CHANNEL/INVALID_VIDEO/INVALID_EVENT/INVALID_TAG/INVALID_NOTE，目標消失404 TARGET_UNAVAILABLE，容量409 FOLLOW_LIMIT/SAVE_LIMIT，429 RATE_LIMITED。Client未知code顯示一般錯誤，不能echo任意provider/SQL文字。停用帳號session失效回401。012成功但013未套用時登入可用、reader 503 ACCOUNT_UNAVAILABLE，公開頁不受影響。

共用型別在shared/account-contracts.ts。時間全部ISO8601；SQL身份欄位BIGINT但JSON userId僅容許正safe integer，超出failclosed。Feed coverage包含vocabularyVersion、available/vocabulary-unavailable/changed、limit；查無維護詞彙時不把substring當tag證據。失效follow/save保留但available:false且可移除。

/manage認證：有Authorization時只驗service Bearer，失敗不降級到session；session admin需Origin/CSRF，actor只由AuthRuntime產生user:<id>。Bearer actor加service:前綴，不可冒用user。Preview digest綁actor，所有既有execute env gates/version/writer lock/transaction保留。CLI的既有preview契約不變。

分工：ai_extended只api/src/auth/*、migration012、auth tests；root owns reader/*、migration013、shared契約、api/index.ts、runtime/server.ts、Next authproxy、editorial authadapter、envtemplates及交接；source_jobs owns web session/login/my/contextbuttons/header/manage UI；cache_jobs完成直播切片後可唯讀整合審查。互不改對方檔案，沒有子agent再分派，最多root+3agent。DB測試以既有獨立lane串行協調。

母站原始碼的unsigned flow cookie、明文私人RSS token與僅TLS來源解碼ID token不沿用：本版使用一次性伺服器flow、RS256/JWKS驗證、RSS token SHA256。這些是安全實作差異，不改使用者操作流程。角色allowlist綁首次verified Google sub，Email不合併帳號。

正式切換仍需Google Console登錄https://youtube.observe.tw/auth/google/callback及真人帳號驗收。本機測試用provider doubles，不能宣稱Google真人登入已完成；不因OAuth而變更Laravel或Dokploy。

代理設定：正式啟用前設定AUTH_TRUSTED_PROXY_CIDRS為已確認的Traefik ingress IP/CIDR；預設不信任轉送地址，禁止0.0.0.0/0等全域信任。啟用後驗證兩個不同client的request.ip與限流互相獨立。Next開發橋接不接受瀏覽器提供的X-Forwarded-For，因此其登入起點在開發API共享每10分鐘20次限制；這不是正式使用者限流設定。Google callback、私有RSS與auth路徑不記Next開發request URL，gateway logger維持停用。
