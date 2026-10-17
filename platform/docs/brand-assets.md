# 有影儀表板品牌延續

正式名稱延續舊站 youtube.board.tw 的「有影儀表板」。頁面標題使用「頁面名 - 有影儀表板」，metadata／OG／RSS／manifest／頁首頁尾一致。主題維持 YouTube 紅 #FF0000；內文連結使用較深紅、深色模式使用較淺紅。

2026-10-17 使用者改定為只用一套舊站方向，取代先前的「新文易數同家族・舊站印記」與三款候選並陳：

- 紅色印記：舊站 urtube.png 的播放箭頭穿過直立橢圓環，向量重繪，深淺色都用 #FF0000。
- 方形標誌（首頁文字雲中央）：大紅色印記在上、宋體「有影儀表板」一行在下，在 512 方格內垂直置中。首頁文字雲的避讓遮罩 `LOGO_MASK`（web/src/lib/masthead-cloud.ts）是由這個檔案點陣化得出的墨跡格，改版面時要一起重算。
- 橫式字標（導覽、頁尾）：「有影」、紅色印記、「儀表板」排成一行，印記約為文字墨高的 1.2 倍。導覽用 h-8、頁尾用 h-11。
- 圖示（favicon、Apple、manifest、maskable）：只放紅色印記。OG 分享圖為印記、紅色分隔線、名稱與標語。

舊的 /brand/family、/brand/legacy、/brand/original 路徑以 308 轉到 /brand/ 下同名檔案（web/next.config.ts），已分享出去的 OG 圖與已安裝的圖示不會斷。

產出檔案都在 web/public/brand/：深淺色 logo、wordmark、16／32／48／180／192／512px 圖示 SVG 與 PNG、三尺寸 ICO、實色無透明角的 Apple 180px、自適應安全區 SVG 及 192／512px PNG、1200×630 OG SVG／PNG，以及透明底的 mark.svg。

中文字均為向量輪廓，不需遠端字型。Noto Serif CJK TC SemiBold 採 SIL OFL；上下字標排列沿用母站生成方法，保留 MIT 授權文字。授權檔在 web/public/brand/licenses/，來源字型雜湊與 rasterizer 版本記錄於 generation.json。

重產：python tools/brand-assets.py /path/to/NotoSerifCJK-SemiBold.ttc。需本機 fontTools 與 rsvg-convert，不連線、不讀資料庫。TTC 選 TC face，會核對名稱。品牌 metadata 在 web/src/lib/site.ts，字標 paths 在生成的 web/src/components/Wordmark.tsx。
