import {ReportReadBound} from './cache-weights.js';
export function recordedMetric(value:unknown):number|null{
 if(value===null||value===undefined||value==='')return null;
 if((typeof value!=='string'&&typeof value!=='number')||(typeof value==='string'&&!/^\d+$/.test(value)))throw new ReportReadBound('Invalid recorded metric.');
 const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw new ReportReadBound('Recorded metric exceeds safe precision.');return n;
}
export function observedMetric(values:unknown[]){
 const known=values.map(recordedMetric).filter((v):v is number=>v!==null).sort((a,b)=>a-b);
 if(!known.length)return {sum:null,median:null,knownDays:0};
 let total=0n;for(const n of known)total+=BigInt(n);if(total>BigInt(Number.MAX_SAFE_INTEGER))throw new ReportReadBound('Recorded metric total exceeds safe precision.');
 const mid=Math.floor(known.length/2),twice=known.length%2?BigInt(known[mid]!)*2n:BigInt(known[mid-1]!)+BigInt(known[mid]!);
 const median=Number(twice/2n)+(twice%2n===1n?0.5:0);if(BigInt(median*2)!==twice)throw new ReportReadBound('Recorded metric median exceeds safe precision.');
 return {sum:Number(total),median,knownDays:known.length};
}
