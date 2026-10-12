# 有影儀表板品牌延續

正式名稱延續舊站 youtube.board.tw 的「有影儀表板」。頁面標題使用「頁面名 - 有影儀表板」，metadata／OG／RSS／manifest／頁首頁尾一致。主題維持 YouTube 紅 #FF0000；內文連結使用較深紅、深色模式使用較淺紅。

使用者選定「新文易數同家族・舊站印記」為正式預設：宋體「有影／儀表板」上下排列，中間用舊站播放箭頭穿過直立橢圓環取代雙半圓。橫式字標同樣替換中間印記。16／32／48px 的「影」字圖示使用加粗、簡化與放大的印記，實際佔約6／8／12px；大型 App 圖示保留原本小圓點的視覺份量。首頁、導覽、頁尾、manifest、favicon、Apple、maskable、OG 均採用新版 family。

legacy 重繪版與螢幕／播放鍵／觀測柱線 original 原創版保留在 /about/brand 作為備選。新版 family 排在最前，並排提供深淺色大圖與16／32／48px實際尺寸。原始 urtube.png 參考只讀自本機副本，未更改舊站快照。

每款包含：

- 深淺色 SVG 標誌、完整字標、16／32／48／180／192／512px 圖示。
- 三尺寸 ICO、各尺寸 PNG、實色無透明角的 Apple180px 圖示。
- 自適應安全區 SVG 及192／512px PNG、1200×630 SVG／PNG 分享圖片。

中文字均為向量輪廓，不需遠端字型。Noto Serif CJK TC SemiBold 採 SIL OFL；母站字標生成方法與同家族設計保留 MIT 授權文字。授權檔在 web/public/brand/licenses/，來源字型雜湊與 rasterizer 版本記錄於 generation.json。

重產：python tools/brand-assets.py /path/to/NotoSerifCJK-SemiBold.ttc。需本機 fontTools 與 rsvg-convert，不連線、不讀資料庫。TTC 選 TC face，會核對名稱。

品牌 metadata 在 web/src/lib/site.ts，SVG paths 在生成的 web/src/components/Wordmark.tsx。首頁使用128px／手機104px 方形標誌；導覽及頁尾使用完整字標，與母站分工一致。

2026-10-12驗證：六組候選／色系的 Apple 四角不透明、ICO 三尺寸與 maskable PNG 尺寸正確；原生瀏覽器30張預覽圖載入成功、桌面無整頁溢出。實際 Opus5.5 review 後已修正 Apple底色、maskable PNG、ICO多尺寸、下載入口、字標比例、縮放裁切與主題色一致性。本機檔案尚未 commit、push 或部署。

使用者選版後驗證：新版family的深淺色大圖、16／32／48px實際尺寸皆正常載入，390px手機無水平溢出；首頁深淺色標誌切換正確。Opus指出16px線寬不足後改用6px印記／1.5px環線，32／48px印記為8／12px；大型印記直接共用legacy幾何，小型改用四頂點箭頭。全部衍生檔已重產，詳見.local/reviews/brand-family-resolution.txt。
