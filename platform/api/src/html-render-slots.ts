/** Bounded buffering + a short FIFO wait. Excess traffic gets retryable backpressure,
 * not an unbounded collection of HTML documents in the gateway heap. */
export class HtmlRenderSlots {
  private active=0;
  private readonly waiting=new Set<()=>void>();
  constructor(private readonly limit=4,private readonly queueLimit=16,private readonly waitMs=2000){}
  private lease():()=>void {
    this.active++;let released=false;
    return ()=>{if(released)return;released=true;this.active--;this.waiting.values().next().value?.();};
  }
  acquire(signal:AbortSignal):Promise<(()=>void)|null> {
    if(signal.aborted)return Promise.resolve(null);
    if(this.active<this.limit)return Promise.resolve(this.lease());
    if(this.waiting.size>=this.queueLimit)return Promise.resolve(null);
    return new Promise(resolve=>{
      const complete=(granted:boolean)=>{
        clearTimeout(timer);signal.removeEventListener('abort',abort);this.waiting.delete(grant);
        resolve(granted?this.lease():null);
      };
      const abort=()=>complete(false),grant=()=>complete(true);
      const timer=setTimeout(abort,this.waitMs).unref();
      this.waiting.add(grant);signal.addEventListener('abort',abort,{once:true});
    });
  }
}
