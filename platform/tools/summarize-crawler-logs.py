"""Run on the host via sudo; emits only the requested deidentified fields."""
from pathlib import Path
import json,datetime,re,stat
rows=[];started=None
path_re=re.compile(r'^/(?:robots\.txt|sitemap\.xml|sitemaps/(?:static|channels|videos|tags|keywords|events)/[a-f0-9]{1,8}\.xml)$')
for f in sorted(Path('/var/lib/youtube-board-ts/crawler-logs').glob('crawler.jsonl*')):
 st=f.lstat();assert stat.S_ISREG(st.st_mode) and st.st_size<=5*1024*1024
 with f.open()as stream:
  for line in stream:
   if len(line)>8192:continue
   try:r=json.loads(line)
   except ValueError:continue
   if r.get('code')!='CRAWLER_RESPONSE':continue
   at=r.get('at','')
   if not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z',at):continue
   started=min(started,at)if started else at
   path=r.get('path','')
   if not isinstance(path,str)or not path_re.fullmatch(path):continue
   ua=r.get('userAgent','');category='驗收程式'if'youtube-board-verify/'in ua else 'Google-InspectionTool'if'Google-InspectionTool'in ua else 'Googlebot'if'Googlebot'in ua else '其他 bot'if re.search(r'bot|crawler|spider',ua,re.I)else '一般瀏覽器'if any(x in ua for x in ['Mozilla','Chrome','Safari','Firefox','Chromium'])else '無法辨識'
   method=r.get('method');status=r.get('status');size=r.get('bytes');colo=r.get('cfColo')
   if not isinstance(method,str)or not re.fullmatch('[A-Z]{1,16}',method)or type(status)is not int or not 100<=status<=599 or type(size)is not int or size<0:continue
   if not isinstance(colo,str)or not re.fullmatch('[A-Z]{3}',colo):colo=None
   rows.append({'utc':at,'method':method,'path':path,'status':status,'bytes':size,'colo':colo,'agent':category,'verified':r.get('verified') is True})
rows.sort(key=lambda r:r['utc'])
print(json.dumps({'collectedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'firstRetainedAt':started,'count':len(rows),'verifiedGooglebotChildSitemaps':[r for r in rows if r['agent']=='Googlebot' and r['verified'] and r['path'].startswith('/sitemaps/')],'records':rows},ensure_ascii=False))
