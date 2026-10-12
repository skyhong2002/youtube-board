import {it,expect,vi} from 'vitest';
import {createGoogleCrawlerVerifier,isGoogleCrawlerAgent} from '../src/seo/google-crawler-verifier.js';
const ip='66.249.66.1',ua='Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
function dns(names=['crawl-66-249-66-1.googlebot.com'],v4=[ip],v6:string[]=[]){return {reverse:vi.fn(async()=>names),resolve4:vi.fn(async()=>v4),resolve6:vi.fn(async()=>v6),cancel:vi.fn()};}
it('requires both an eligible Google UA token and forward confirmed Google reverse DNS',async()=>{
 const resolver=dns(),verifier=createGoogleCrawlerVerifier({resolver:()=>resolver});
 expect(await verifier.verify(ip,ua)).toBe(true);expect(resolver.reverse).toHaveBeenCalledWith(ip);
 expect(verifier.verify(ip,'youtube-board-verify/1.0 Googlebot/2.1')).toBe(false);
 expect(verifier.verify(ip,'NotGooglebot/2.1')).toBe(false);expect(verifier.verify(ip,'Browser')).toBe(false);
 expect(isGoogleCrawlerAgent('Google-InspectionTool/1.0')).toBe(true);await verifier.close();
});
it('rejects suffix tricks, mismatched forward records, resolver errors and private addresses',async()=>{
 for(const names of [['googlebot.com.evil.example'],['evilgoogle.com'],['googlebot.com..'],['secret@google.com'],['valid.googlebot.com']]){
  const resolver=dns(names,['66.249.66.2']),verifier=createGoogleCrawlerVerifier({resolver:()=>resolver});
  expect(await verifier.verify(ip,ua)).toBe(false);await verifier.close();
 }
 const resolver=dns();resolver.reverse.mockRejectedValue(Error('raw IP must never be logged'));const verifier=createGoogleCrawlerVerifier({resolver:()=>resolver});
 expect(await verifier.verify(ip,ua)).toBe(false);
 for(const privateIp of ['127.0.0.1','::1','::ffff:127.0.0.1','not-ip','fe80::1%eth0','10.0.0.1'])expect(verifier.verify(privateIp,ua)).toBe(false);
 await verifier.close();
});
it('accepts canonical IPv6, IPv4-mapped IPv6, case and terminal DNS dot',async()=>{
 const v6='2001:4860:4801:10::1',resolver=dns(['CRAWL.GOOGLE.COM.'],[],['2001:4860:4801:0010:0000:0000:0000:0001']);
 const verifier=createGoogleCrawlerVerifier({resolver:()=>resolver});expect(await verifier.verify(v6,ua)).toBe(true);await verifier.close();
 const mappedDns=dns(),mapped=createGoogleCrawlerVerifier({resolver:()=>mappedDns});expect(await mapped.verify('::ffff:66.249.66.1',ua)).toBe(true);expect(mappedDns.reverse).toHaveBeenCalledWith(ip);await mapped.close();
});
it('bounds pending work with no duplicate fanout, deadline cancellation and shutdown',async()=>{
 const resolver=dns();resolver.reverse.mockImplementation(()=>new Promise(()=>{}));
 const verifier=createGoogleCrawlerVerifier({resolver:()=>resolver,maxConcurrent:1,deadlineMs:20});
 const pending=verifier.verify(ip,ua);expect(verifier.verify(ip,ua)).toBe(false);expect(verifier.verify('66.249.66.2',ua)).toBe(false);
 expect(await pending).toBe(false);expect(resolver.cancel).toHaveBeenCalled();
 const second=verifier.verify('66.249.66.2',ua);await verifier.close();expect(await second).toBe(false);expect(verifier.verify(ip,ua)).toBe(false);
});
it('bounds LRU cache, expires negative results and caps PTR candidate processing',async()=>{
 let now=0;const resolver=dns(),verifier=createGoogleCrawlerVerifier({resolver:()=>resolver,maxCache:1,now:()=>now});
 expect(await verifier.verify(ip,ua)).toBe(true);expect(verifier.verify(ip,ua)).toBe(true);expect(resolver.reverse).toHaveBeenCalledTimes(1);
 expect(await verifier.verify('66.249.66.2',ua)).toBe(false);expect(verifier.verify('66.249.66.2',ua)).toBe(false);now=60001;
 await verifier.verify('66.249.66.2',ua);expect(resolver.reverse).toHaveBeenCalledTimes(3);
 await verifier.verify(ip,ua);expect(resolver.reverse).toHaveBeenCalledTimes(4);await verifier.close();
 const capped=dns(['evil.example','evil.example','evil.example','evil.example','crawl.googlebot.com']);
 const cap=createGoogleCrawlerVerifier({resolver:()=>capped});expect(await cap.verify(ip,ua)).toBe(false);expect(capped.resolve4).not.toHaveBeenCalled();await cap.close();
});
it('bounds new DNS starts per minute while preserving cached verification and resetting without poisoning saturated IPs',async()=>{
 let now=1000;const resolver=dns(),verifier=createGoogleCrawlerVerifier({resolver:()=>resolver,now:()=>now,maxStartsPerMinute:2});
 expect(await verifier.verify(ip,ua)).toBe(true);
 expect(await verifier.verify('66.249.66.2',ua)).toBe(false);
 expect(verifier.verify('66.249.66.3',ua)).toBe(false);
 expect(resolver.reverse).toHaveBeenCalledTimes(2);
 expect(verifier.verify(ip,ua)).toBe(true);expect(resolver.reverse).toHaveBeenCalledTimes(2);
 now=60000;
 expect(await verifier.verify('66.249.66.3',ua)).toBe(false);
 expect(resolver.reverse).toHaveBeenCalledTimes(3);
 expect(verifier.verify(ip,ua)).toBe(true);await verifier.close();
 for(const value of [0,301,1.5,NaN])expect(()=>createGoogleCrawlerVerifier({maxStartsPerMinute:value})).toThrow('Invalid crawler verifier limits');
});
