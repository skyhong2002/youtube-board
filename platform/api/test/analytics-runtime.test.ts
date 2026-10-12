import {describe,it,expect} from 'vitest';
import {analyticsTransportEnabled} from '../../shared/analytics-runtime.js';
describe('analytics transport gate',()=>{
  const ready={NODE_ENV:'production',APP_ENV:'production',AUTH_PUBLIC_ORIGIN:'https://youtube.observe.tw',NEXT_PUBLIC_GA_ID:'G-X2G1PLNP7K'};
  it('opens only explicitly configured production transport',()=>{
    expect(analyticsTransportEnabled(ready)).toBe(true);
    expect(analyticsTransportEnabled({})).toBe(false);
    for(const key of Object.keys(ready))expect(analyticsTransportEnabled({...ready,[key]:undefined})).toBe(false);
    for(const [key,value] of Object.entries({NODE_ENV:'development',APP_ENV:'preview',AUTH_PUBLIC_ORIGIN:'https://preview.example',NEXT_PUBLIC_GA_ID:'G-OTHER123'}))expect(analyticsTransportEnabled({...ready,[key]:value})).toBe(false);
  });
});
