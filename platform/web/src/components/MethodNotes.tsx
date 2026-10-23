import Link from 'next/link';
import {DESCRIPTION_TEMPLATE_NOTE,DISPLAY_EXCLUSION_NOTE,INSUFFICIENT,MATCH_CAVEAT,NO_VIEWS,TAG_SOURCE_ATTRIBUTION} from '@/lib/keyword-ranking';
import {MASTHEAD_WORDS} from '@/lib/masthead-cloud';
import {inlineLink,methodHeading,methodList,methodTerm} from './method/styles';
import {CANDIDATE_LIST_VERSION} from '../../../shared/city-definitions';
import {COMMENTS_PUBLISHED} from '@/lib/comments-launch';

// 資料來源與計算方式, one block per part of the site, as tag.observe.tw MethodNotes.
// /about shows them all; PageMethod under each page shows only the blocks for that
// page (ReportMethod picks them by path), then the page's own notes.

export {methodHeading} from './method/styles';

/** A term/definition grid; `[term, definition]` rows, as tag.observe.tw's method <dl>s. */
export function MethodTerms({rows}:{rows:ReadonlyArray<readonly [string,React.ReactNode]>}){
 return <dl className={methodList}>{rows.map(([term,body])=><div key={term} className="contents"><dt className={methodTerm}>{term}</dt><dd>{body}</dd></div>)}</dl>;
}

/** Notes written as 「標籤：說明」 read as a term list; anything else stays a paragraph. */
export function MethodNoteList({notes}:{notes:readonly string[]}){
 const rows:Array<[string,string]>=[],rest:string[]=[];
 for(const note of notes){const m=/^([^：。，；\s]{1,6})：(.+)$/s.exec(note);if(m)rows.push([m[1]!,m[2]!]);else rest.push(note);}
 return <>{rest.map((note,i)=><p key={i}>{note}</p>)}{rows.length>0&&<MethodTerms rows={rows}/>}</>;
}

/** The page's own notes (API notes, data warnings, dynamic scope), after its blocks. */
export function PageNotes({title='本頁資料範圍',notes}:{title?:string;notes:readonly string[]}){
 const list=[...new Set(notes.map(n=>n.trim()).filter(Boolean))];
 if(!list.length)return null;
 return <><h3 className={methodHeading}>{title}</h3><MethodNoteList notes={list}/></>;
}

export function SourceMethod(){
 return <>
  <h3 className={methodHeading}>資料來源</h3>
  <p>本站以納入名單的 YouTube 頻道與影片為範圍（名單見<Link href="/channels" className={inlineLink}>頻道觀測</Link>），數據來自 YouTube 公開資料與定時觀測：直播約每分鐘輪詢一次，頻道統計、新影片與影片統計則分批輪流更新，所以同一頁的數字不一定在同一時間取得。不涵蓋全 YouTube；缺漏、尚未收錄或資料服務中斷都不等於零，尚未取得的數值顯示「—」。</p>
  <p>頁面使用台北時間（UTC+8）。「更新於」是來源已記錄的觀測時間；來源沒有記錄時顯示「未記錄」，不以開啟網頁的時間代替。</p>
  <p>共同標籤詞彙的標籤來源：新文易數（tag.observe.tw），保留來源、版本與比對依據；本站的頻道分類沿用有影儀表板的來源組織方式，與內容標籤是不同維度。影片數、觀看數與直播同時在線人數分開計算，不代表 YouTube 全站流量，也不表示因果關係。</p>
 </>;
}

export function ChannelMethod(){
 return <>
  <h3 className={methodHeading}>頻道觀測的指標</h3>
  <p>列表與頻道頁的數字是各頻道最近一次取得的公開統計；頁首「更新於」是本頁最新一筆資料的時間，不代表每個頻道都在那時更新。</p>
  <MethodTerms rows={[
   ['累計數字','訂閱人數、累計觀看與累計影片取自 YouTube 頻道公開統計；訂閱人數由 YouTube 提供概數。'],
   ['期間增量','近七日／近月增量取期間內可用的觀測相減，不是日曆週或月。YouTube 修正統計或影片下架時增量可能為負；缺值不補零，顯示「—」。'],
   ['模型估計','近七日／近月觀看估計來自歷史觀測模型，不是已發生的觀看數。近月估計差距＝近月估計－近月觀測增量。'],
   ['成長指標','（週增量 − 月增量 ÷ 4）÷ 月增量 × 25。平均每片週觀看＝週觀看增量 ÷ 週影片增量（取整數），不是個別影片的觀看平均。'],
   ['排行門檻','可依累計觀看或訂閱人數設門檻；分類排名清空門檻時使用 0，未記錄門檻數值的頻道不列入；OR 分類條件的門檻依累計觀看篩選。'],
   ['頻道分析','頻道頁的每日重點、議題、人物與觀點來自已儲存的 AI 分析，瀏覽不會產生新分析；描述與模型分數需搭配原始影片查證，各面向的分析期間可能不同，實際期間列在「各分析的實際期間與來源」。'],
   ['封存','封存是本站頻道紀錄的狀態，不代表 YouTube 帳號狀態；封存頻道保留歷史觀測與分析。'],
  ]}/>
 </>;
}

export function VideoMethod(){
 return <>
  <h3 className={methodHeading}>影片的數字</h3>
  <MethodTerms rows={[
   ['公開統計','觀看、喜歡與留言總數是取得當時的 YouTube 公開統計，不是即時數值；各項統計的觀測時間可能不同。「資料最後記錄」是影片資料的記錄時間，不代表觀看、喜歡或留言都在那時重新觀測。'],
   ['觀看歷史','圖上每個點是實際儲存的觀測，連線只為方便閱讀，不代表中間時間的測量值；沒有歷史觀測時不建立時間序列。'],
   ...COMMENTS_PUBLISHED?[['留言','「YouTube 留言總數」是來源公開統計；「本站留言收錄」只計本站保存並成功解析的留言與回覆，兩者不相等，也不推算未收錄的留言。頻道影片列表在完整收錄時顯示本機留言數，否則顯示 YouTube 留言觀測，排序仍依 YouTube 原始統計；作者、回覆與留言獲讚只呈現完整批次。'] as [string,string]]:[],
   ['喜歡占互動','喜歡 ÷（喜歡＋不喜歡＋顯示留言），任一來源缺值時不估算。'],
   ['字幕','只記錄來源是否提供字幕，尚未擷取逐字稿，因此字幕不列入標籤比對。'],
   ['觀測分析','直播逐時／逐日最高同時在線取自所讀直播紀錄；'+(COMMENTS_PUBLISHED?'留言時間分布與帳號排名只涵蓋可解析的留言。':'')+'讀取上限、略過與解析失敗的筆數列在「資料涵蓋範圍與解析限制」。'],
  ]}/>
 </>;
}

export function LiveMethod(){
 return <>
  <h3 className={methodHeading}>直播觀測</h3>
  <p>直播約每分鐘輪詢一次納入名單的頻道。沒有觀測結果不代表 YouTube 上沒有直播。</p>
  <MethodTerms rows={[
   ['同時在線','最近一次取得的同時在線人數快照，不是累計觀看。'],
   ['排行範圍','主選單的「直播」沿用舊站直播排行榜，預設只列社論、政治人物、電視台、新聞、政黨、廣播頻道；「全台灣」排除中國官方、簡體、香港、非台灣、日本、馬來西亞頻道，「個人社論」列社論頻道但排除政治人物、電視節目、中國政論、電視台、新聞、簡體、香港、廣播頻道，「全部頻道」不限分類。「正直播排行(排除帶狀)」只列 24 小時內開播的直播，排除長時間連續播出的帶狀直播。'],
   ['開播時間','YouTube 回報的實際開播時間；尚未取得時顯示影片發布時間。'],
   ['最近趨勢','今日最近 24 筆同時在線取樣，只顯示走勢，不標示數值。'],
   ['在線加總','多場直播的在線人數直接相加、未去重，同一位觀眾可能重複計入。'],
   ['峰值','以來源峰值與有效取樣取最大值；沒有取樣的時段，真正的峰值可能更高。'],
   ['部分取樣','部分直播日誌超出讀取上限、格式無法解析或在讀取時更新；峰值只涵蓋可用取樣，缺少取樣的時段不代表沒有觀眾。可縮小期間或分類重新查看。'],
   ['名單','直播名單持續更新，分頁的總數可能短暫不同步。'],
   ['四窗直播','播放清單沿用已審核的設定，不代表連結目前仍在直播；能否播放由 YouTube 決定。'],
  ]}/>
 </>;
}

export function AiMethod(){
 return <>
  <h3 className={methodHeading}>AI 議題</h3>
  <p>AI 輸出用來整理資料，不代表事實查核或編輯結論；瀏覽頁面只讀取已儲存的分析，不會呼叫模型或產生新內容。</p>
  <MethodTerms rows={[
   ['每日議題','彙整納入名單頻道的影片；部分日期以既有頻道摘要的共同訊號重新分組（標示「來源訊號分組」）。排序採影片數與來源頻道數的組合分數，不是新聞熱度或民意比例，也不能直接與新聞網站的熱度比較。'],
   ['影片引用','「筆影片引用」可跨議題重複，不等於不重複影片數；來源訊號分組的「支引用影片」已去重。'],
   ['媒體事件','每個議題下列出各頻道的來源事件與引用影片則數；議題頁可查看來源紀錄與影片證據。同名關鍵字不一定屬於同一個事件，來源分組也不代表已證實為同一事件。'],
   ['議題統計','關鍵字與人物取各來源事件中出現次數最多的五個。泛綠／泛藍依頻道分類標籤計算；台灣／中國角度與民進黨／國民黨觀點是頻道摘要中模型標記的欄位。三者都以引用影片則數加總，不是去重影片數。'],
   ['涵蓋範圍','「原始收錄」是來源頻道當日發布的本地影片數；「AI 來源」是頻道摘要引用的影片數（全部條件下不計只引用一支影片的事件）；「每日彙整」是各議題引用影片數的加總。代表影片取各來源事件的第一支引用影片，最多三支。'],
   ['事實與觀點','「事實」與支持、反對、其他觀點的分類是模型的判斷，仍需回到影片查證。'],
   ['來源快照','生成時的來源標題保留在分析來源快照；「目前本地影片資料」是現在儲存的影片資料，兩者可能不同。來源版本不符、尚未發布或格式無法解析的分析暫不呈現。'],
   ['提示詞預覽','使用與 AI 任務相同的規劃器，只讀取來源並組合提示詞，不呼叫模型或寫入資料；顯示的是當下來源，不是過去生成時的快照。'],
  ]}/>
 </>;
}

export function TagMethod(){
 return <>
  <h3 className={methodHeading}>頻道分類</h3>
  <p>頻道分類用來組織觀測來源，沿用有影儀表板的分類，與新聞的共同標籤詞彙分開維護。</p>
  <MethodTerms rows={[
   ['重疊','一個頻道可以同時屬於多個分類，觀看增量不宜跨分類相加，也不是全站觀看總量。'],
   ['近七日增量','分類的近七日觀看增量是分類內各頻道近七日增量的加總；平均與中位數以頻道為單位。預設只計近七日增量至少 10 次的頻道（分類列表可調整門檻）。'],
   ['分類報表','每日、趨勢、文字雲等分類報表沿用既有快取；觀看是影片的累計觀測，不是每日新增觀看，缺日與缺欄位不補零。各報表的期間與快取狀態列在本頁資料範圍。'],
  ]}/>
 </>;
}

export function CloudMethod(){
 return <>
  <h3 className={methodHeading}>關鍵詞分布</h3>
  <MethodTerms rows={[
   ['文字雲','依相對權重排列：短期權重減去依兩期天數比例換算的長期權重（公式與分母列在本頁資料範圍），只留大於 0 的詞，突顯近期比平常更常出現的詞；短長期無法比較時不畫文字雲。畫出前 60 個詞，字級依權重的平方根在 13～30px 之間縮放，最重的詞另以粗體與顏色標示，只適合比較同一張圖裡的詞；權重數字見滑鼠提示，其餘的詞收在「顯示其餘」。'],
   ['短期／長期原始權重','各期間快取裡的原始權重，未扣除長期基準，所以排序和文字雲不同：長期一直常見的詞在原始權重仍排在前面，文字雲只留近期升高的詞。各表先列前 30 筆，其餘按「顯示全部」。'],
   ['停用詞','文字雲與原始權重都已排除停用詞；權重的計算方式與期間列在本頁資料範圍。'],
  ]}/>
 </>;
}

/** The home page's own blocks, as tag.observe.tw HomeMethod. */
export function HomeMethod(){
 return <>
  <h3 className={methodHeading}>首頁</h3>
  <MethodTerms rows={[
   ['文字雲',`字級依所選期間的熱度，沒有加權熱度時依已比對影片數；最多 ${MASTHEAD_WORDS} 個詞，版面放不下的小詞省略。`],
   ['文字雲圖片','新文易數（tag.observe.tw）已收錄人物素描或標誌的詞，以圖片加小字名稱呈現：人物沿用新文易數的白底素描，前三名用紅色線條、其餘用深色線條；標誌跟著該詞的顏色；圖片由本站轉送，瀏覽器不直接連線新文易數。原圖作者與授權見各關鍵字頁；圖片暫時無法取得時改回文字。'],
   ['熱門標籤','與熱門標籤排行相同的列、順序與指標；沒有比對資料不代表沒有相關影片。'],
   ['焦點議題','AI 整理與來源訊號分組是探索線索，請開啟議題頁核對引用；「筆影片引用」不等於不重複影片數，來源訊號分組的引用影片已去重。'],
   ['頻道動態','近七日觀看增量最高的頻道。'],
   ['即時直播','目前在線是最近一次取得的快照，今日峰值是今日各次取樣中實測的最大值；「部分取樣」表示日誌不完整。'],
   ['分類觀測','近七日觀看增量只計增量至少 10 次的頻道；同一頻道可計入多個分類，不是全站觀看總量。'],
   ['觀測範圍','在線加總未去重。直播目前在線、每日取樣峰值、累計觀看與近七日增量是不同度量，不應混用；未記錄的數值顯示「—」。'],
  ]}/>
 </>;
}

/** /keywords and the home ranking; the page itself adds each window's range and counts. */
export function KeywordRankingMethod(){
 return <>
  <h3 className={methodHeading}>熱門標籤排行</h3>
  <p>YouTube 影片標題與說明中出現的新聞標籤，依頻道加權熱度排序；可切換過去 24 小時與近七日。</p>
  <MethodTerms rows={[
   ['詞池','先選取新文易數同一期間、至少兩家媒體各兩篇不同文章的合格詞，再依 YouTube 頻道加權熱度排序；新聞文章數不充當影片數。'],
   ['比對','以共同詞彙比對影片標題與說明的文字，不是 AI 判讀；字幕尚未取得，不列入比對。尚未收錄或尚未比對的影片不在排行內。'],
   ['熱度','標題命中的影片計 3、僅說明命中的影片計 1；同一頻道的影片依序乘以 1、0.5、0.25……遞減（標題命中的影片先計），再加總各頻道。單一頻道大量上片不會無限推高熱度。資料服務沒有提供加權熱度的期間，依已比對影片數排序。'],
   ['升溫',`本期熱度減去前一段等長期間的熱度。兩段期間各有 95% 以上的影片完成比對時才計算，否則顯示「${INSUFFICIENT}」，不以 0 代替；少數尚未比對或文字已變動的影片不計入。走勢為每日熱度，比對未達 95% 的日期留白。`],
   ['觀看',`影片目前的累計觀看合計，不是期間增量。仍有影片缺值時顯示「≥已知小計」和缺值支數，這是合計下界；全部缺值時顯示「${NO_VIEWS}」，缺值不補 0。`],
   ['寫法','僅英文大小寫不同的標籤合併為一列，原始寫法保留在詞彙池。'],
  ]}/>
 </>;
}

export function KeywordMethod(){
 return <>
  <h3 className={methodHeading}>共同標籤</h3>
  <p>{TAG_SOURCE_ATTRIBUTION}。共同標籤以文字比對影片標題與說明，不是 AI 判讀；命中不代表事件歸屬或立場，與頻道分類分開。{MATCH_CAVEAT}字幕尚未取得，不列入比對。</p>
  <MethodTerms rows={[
   ['比對範圍','僅列出目前詞彙版本與影片標題、說明仍相符的比對結果；待比對或來源文字已變動的影片不列入，數量見「收錄與比對範圍」。'],
   ['期間','「往前 N 日」包含今天與前 N 天，共 N+1 個台北日曆日（往前 7 日為 8 個日曆日）；指定起訖日期時以實際起訖日為準。日數、日期與小時條件同時套用。'],
   ['命中片段','每支影片最多顯示 3 段，標示來自標題、說明或字幕；沒有片段時顯示「沒有命中片段」，來源文字缺漏時顯示「來源文字未提供」，不另行補寫。完整比對依據在影片頁的「共同標籤與比對依據」。'],
   ['顯示排除',DISPLAY_EXCLUSION_NOTE.replace(/^顯示排除：/,'')],
   ['說明欄樣板',DESCRIPTION_TEMPLATE_NOTE.replace(/^說明欄樣板：/,'')],
   ['示例','列表與片段只是符合條件的影片例子，不能用來推算整體比例或全站失真程度；有效比對的影片比例只代表比對完成度。'],
   ['觀看',`累計觀看是取得當時的公開觀測值，不是期間增量；${NO_VIEWS}的影片不當作 0。`],
  ]}/>
 </>;
}

export function VocabularyMethod(){
 return <>
  <h3 className={methodHeading}>共同標籤詞彙池</h3>
  <p>{TAG_SOURCE_ATTRIBUTION}。來源包含媒體原生標籤與規則補標，不能把每個詞都視為媒體親自標註；同步範圍、版本與比對證據隨資料顯示。</p>
  <MethodTerms rows={[
   ['排行顯示','說明這個詞能否列入熱門標籤排行。不列入的原因包括：新聞分類詞或上游排除詞、上游判定的雜訊標籤、純數字或日期、長度不在 2–30 字、不含文字或數字，以及 YouTube 平台或宣傳用語。規則沿用 tag.observe.tw 的標籤顯示規則；被排除的詞仍完整保留在詞彙池，比對證據也不刪除。'],
   ['說明欄樣板',DESCRIPTION_TEMPLATE_NOTE.replace(/^說明欄樣板：/,'')],
  ]}/>
 </>;
}

export function GroupMethod(){
 return <>
  <h3 className={methodHeading}>頻道群組</h3>
  <p>頻道群組沿用既有的群組設定（例如新聞集團、兩岸立場），群組之間可能重疊，不能相加當作全站總計；列序沿用既有設定。</p>
  <MethodTerms rows={[
   ['分桶','各日依影片發布日分桶；觀看是目前的累計觀測，不是期間新增觀看。'],
   ['七日趨勢','每一點是當日及前六日已記錄值的加總；缺日或缺欄位不補零，有值但不足七日仍是部分觀測，涵蓋日數另列。'],
   ['中位數','只納入有記錄的日值，缺日不補零，因此可能與舊版補零的中位數不同；加總也只涵蓋已知值。'],
  ]}/>
 </>;
}

/** 選戰: the share card, trend and raw counts on /mayor and each city. */
export function MayorMethod(){
 return <>
  <h3 className={methodHeading}>地方選戰觀測</h3>
  <p>人物名單為中選會 {CANDIDATE_LIST_VERSION} 審定的縣市長候選人，同名者的提及無法區分。聲量是四類頻道的七日原始提及量，分類可重疊；不是支持度、民調或不重複觀眾，也不套用政治立場權重。</p>
  <MethodTerms rows={[
   ['聲量占比','每個日期彙整當日及前 6 日。只有當日所有候選人都有數值、且合計大於 0 時，同日占比合計才是 100%；任一候選人缺值時該日顯示 n/a，不以其餘候選人換算；全部為 0 時占比為 0%。卡片顯示期間內最新一天的占比與原始量。'],
   ['原始量','趨勢圖預設顯示「原始量」。每個日期的值是所選指標在當日及前 6 日、四個分類的合計（七日移動合計，分類可重疊），也就是觀測資料表的數字；曲線形狀與七日移動平均相同，數值是平均的 7 倍。占比則是這個值除以名單所有人物的合計。'],
   ['分類日桶','每個日期的七日範圍應有 28 個分類日桶（4 個分類 × 7 日）；全部完整時圖上不另外標示。未滿 28 或涵蓋未知的日期在圖上以虛線與空心點標示並註明涵蓋數；缺少的桶不補零，也不代表聲量下降。'],
  ]}/>
  {/* 指標說明 ⓘ next to the metric chips links here; the fragment target opens the closed block. */}
  <div id="mayor-metrics" className="scroll-mt-32"><MethodTerms rows={[
   ['觀看引用','當日發布、標題或描述提到該人物的影片，其目前累計觀看數的合計（快取重建當下的快照，不是當日新增觀看）。'],
   ['影片引用','當日發布、標題或描述提到該人物的影片部數。'],
   ['重要度','沿用舊站公式的相對分數：標題（加倍計）與描述中提到的次數，乘上依姓名字數的權重，再除以該詞在詞彙表中的歷史峰值（未收錄時以 1 計）。只適合同一頁內比較，數值本身沒有單位。'],
  ]}/></div>
 </>;
}

export function CommentMethod(){
 return <>
  <h3 className={methodHeading}>留言觀測</h3>
  <p>只顯示本站已擷取並成功解析的公開留言與回覆，不等同 YouTube 公開留言總數；未收錄不代表沒有留言。同一個人可能有多個帳號，本站不推定真實身分。</p>
 </>;
}

export function EventsMethod(){
 return <>
  <h3 className={methodHeading}>事件時間軸</h3>
  <p>跨日、跨來源的事件關聯經編輯審核，保留命名、合併與拆分的歷程；同名來源不會自動合併，同名也不代表相同事件。新聞與 YouTube 的指標分別呈現，不合併計算。單一事件頁的編輯異動紀錄列出最近 100 次異動，包含合併前事件的紀錄。</p>
 </>;
}

export function CompareTitlesMethod(){
 return <>
  <h3 className={methodHeading}>影片標題用語比較</h3>
  <p>並排兩支已收錄影片的標題，標記依字元順序找到的共有部分；未標記的部分是各標題自己的措辭。文字相同不等於報導同一事件，也不能據此推論抄襲、協同行動或因果關係。標題超過比較長度上限時呈現完整原文，不做標記。</p>
 </>;
}

export function BoardsMethod(){
 return <>
  <h3 className={methodHeading}>自訂看板</h3>
  <p>看板把頻道、頻道分類、日期、共同標籤與文字搜尋組成一個影片觀測頁，可以訂閱 RSS。看板收藏儲存在目前的瀏覽器，清除瀏覽器儲存空間會移除本機收藏；網址會包含所選的篩選條件，複製網址即可分享。</p>
 </>;
}
