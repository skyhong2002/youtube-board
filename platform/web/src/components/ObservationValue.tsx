import {count} from "@/lib/format";
export function MissingObservation(){return <><span aria-hidden="true">—</span><span className="sr-only">無觀測值</span></>;}
export function ObservationValue({value}:{value:number|null|undefined}){return value==null||!Number.isFinite(value)?<MissingObservation/>:<>{count(value)}</>;}
