/** Fixed vocabulary prevents query/error payloads from entering operational logs. */
export const HOME_DIAGNOSTIC_STAGES = ['category-source','vocabulary','video-source','term-labels','ranking','daily-history','representatives','version-check'] as const;
export const HOME_DIAGNOSTIC_REASONS = ['data-source-unavailable','source-cap','precision','not-synchronized','version-changed'] as const;
export type HomeDiagnostic = {section:'categories'|'keywords';stage:typeof HOME_DIAGNOSTIC_STAGES[number];reason:typeof HOME_DIAGNOSTIC_REASONS[number];UTC:string};
export type HomeDiagnosticCallback = (diagnostic:HomeDiagnostic)=>void;
/** At most one line per fixed tuple per minute. Failed sinks consume the slot too.
 * Reconstruct the record rather than serializing caller-supplied extra fields. */
export function homeDiagnosticSink(sink:(line:string)=>void,clock:()=>Date=()=>new Date()):HomeDiagnosticCallback {
 const last=new Map<string,number>();
 return record=>{
  try {
   const {section,stage,reason}=record;
   if(!['categories','keywords'].includes(section)||!HOME_DIAGNOSTIC_STAGES.includes(stage)||!HOME_DIAGNOSTIC_REASONS.includes(reason))return;
   const now=clock(),at=now.getTime();if(!Number.isFinite(at))return;
   const key=`${section}/${stage}/${reason}`,previous=last.get(key);
   if(previous!==undefined&&at-previous<60000)return;
   last.set(key,at);
   sink('HOME_SECTION_UNAVAILABLE '+JSON.stringify({section,stage,reason,UTC:now.toISOString()})+'\n');
  }catch { /* Diagnostics must never change report availability. */ }
 };
}
