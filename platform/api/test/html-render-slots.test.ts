import {it,expect} from 'vitest';
import {HtmlRenderSlots} from '../src/html-render-slots.js';
it('queues a bounded burst fairly and releases once; overflow and aborted waiters do not consume slots',async()=>{
  const slots=new HtmlRenderSlots(2,2,50), signal=new AbortController().signal;
  const one=await slots.acquire(signal),two=await slots.acquire(signal);expect(one).toBeTypeOf('function');
  const abort=new AbortController(),three=slots.acquire(abort.signal),four=slots.acquire(signal);
  expect(await slots.acquire(signal)).toBeNull();abort.abort();expect(await three).toBeNull();
  one!();one!();const fourth=await four;expect(fourth).toBeTypeOf('function');
  two!();fourth!();const again=await slots.acquire(signal);expect(again).toBeTypeOf('function');again!();
});
it('expires queued waiters without leaking admission capacity',async()=>{
  const slots=new HtmlRenderSlots(1,2,10),signal=new AbortController().signal;
  const release=await slots.acquire(signal);
  expect(await slots.acquire(signal)).toBeNull();release!();
  const fresh=await slots.acquire(signal);expect(fresh).toBeTypeOf('function');fresh!();
});
