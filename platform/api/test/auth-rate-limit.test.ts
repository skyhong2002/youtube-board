import {expect,it} from 'vitest';
import {authNetworkLimiter,AUTH_NETWORK_LIMITS} from '../src/auth/rate-limit.js';

it('retains /64 limits and applies one /48 ceiling across rotating IPv6 subnets',()=>{
 const allow=authNetworkLimiter(AUTH_NETWORK_LIMITS.start);
 for(let subnet=0;subnet<10;subnet++)for(let i=0;i<20;i++)expect(allow(`2001:db8:1:${subnet.toString(16)}::${i+1}`,0)).toBe(true);
 expect(allow('2001:0db8:0001:0000:ffff:ffff:ffff:ffff',0)).toBe(false);
 expect(allow('2001:db8:1:ffff::1',0)).toBe(false);
 expect(allow('2001:db8:2:ffff::1',0)).toBe(true);
 expect(allow('2001:db8:1:ffff::1',600000)).toBe(true);
});
it('keeps native and mapped IPv4 equivalent without grouping independent addresses',()=>{
 const allow=authNetworkLimiter({network:2,aggregate:1,global:20,windowMs:100});
 expect(allow('192.0.2.1',0)).toBe(true);expect(allow('::ffff:c000:201',0)).toBe(true);expect(allow('::ffff:192.0.2.1',0)).toBe(false);
 for(let i=2;i<10;i++)expect(allow(`192.0.2.${i}`,0)).toBe(true);
});
it('does not spend global or aggregate budgets on refused requests',()=>{
 const allow=authNetworkLimiter({network:2,aggregate:4,global:8,windowMs:100});
 for(let i=0;i<2;i++)expect(allow('2001:db8:1:1::1',0)).toBe(true);
 for(let i=0;i<100;i++)expect(allow('2001:db8:1:1::2',0)).toBe(false);
 for(let i=0;i<2;i++)expect(allow('2001:db8:1:2::1',0)).toBe(true);
 for(let i=0;i<100;i++)expect(allow(`2001:db8:1:${(i+3).toString(16)}::1`,0)).toBe(false);
 for(let i=1;i<=4;i++)expect(allow(`192.0.2.${i}`,0)).toBe(true);
 expect(allow('192.0.2.5',0)).toBe(false);expect(allow('192.0.2.5',100)).toBe(true);
});
it('bounds LRU cardinality while subnet churn cannot evict its own aggregate',()=>{
 const allow=authNetworkLimiter({network:2,aggregate:4,global:8,windowMs:100,capacity:2});
 for(let i=1;i<=4;i++)expect(allow(`2001:db8:1:${i}::1`,0)).toBe(true);
 expect(allow('2001:db8:1:1::1',0)).toBe(false);
 for(let i=2;i<=5;i++)expect(allow(`2001:db8:${i}:1::1`,0)).toBe(true);
 expect(allow('2001:db8:6:1::1',0)).toBe(false);
 expect(allow('2001:db8:6:1::1',100)).toBe(true);
});
it('rejects invalid limiter bounds and clocks',()=>{
 for(const patch of [{network:0},{aggregate:-1},{global:Infinity},{windowMs:0},{capacity:0}])expect(()=>authNetworkLimiter({...AUTH_NETWORK_LIMITS.start,...patch})).toThrow('Invalid auth rate budget');
 expect(authNetworkLimiter(AUTH_NETWORK_LIMITS.start)('192.0.2.1',NaN)).toBe(false);
});
