import {it,expect} from 'vitest';
import {clientNetwork,boundedLimiter} from '../src/rate-limit.js';
import {trustedProxies} from '../src/trusted-proxy.js';
it('normalizes IPv6 /64 and mapped IPv4 without grouping independent /64s',()=>{
 expect(clientNetwork('2001:db8:1:2::1')).toBe(clientNetwork('2001:0db8:0001:0002:ffff:ffff:ffff:ffff'));
 expect(clientNetwork('2001:db8:1:3::1')).not.toBe(clientNetwork('2001:db8:1:2::1'));
 expect(clientNetwork('::ffff:192.0.2.1')).toBe('192.0.2.1');expect(clientNetwork('::ffff:c000:201')).toBe('192.0.2.1');
});
it('evicts LRU without global cardinality lockout and bounds address churn separately',()=>{
 const allow=boundedLimiter(2,100,6,2);expect(allow('a',0)).toBe(true);expect(allow('b',0)).toBe(true);expect(allow('a',0)).toBe(true);expect(allow('a',0)).toBe(false);expect(allow('c',0)).toBe(true);expect(allow('a',0)).toBe(false);expect(allow('b',0)).toBe(true);expect(allow('d',0)).toBe(true);expect(allow('e',0)).toBe(false);expect(allow('e',100)).toBe(true);
});
it('production refuses missing ingress trust',()=>{expect(()=>trustedProxies('',true)).toThrow();expect(trustedProxies('10.42.0.1/32',true)).toEqual(['10.42.0.1/32']);});
