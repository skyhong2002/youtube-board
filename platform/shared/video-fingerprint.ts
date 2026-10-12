import {createHash} from 'node:crypto';
/** Ordered fields and exact original text; changing either invalidates stored match offsets. */
export function sourceTextFingerprint(title:string,description:string):string{
 return createHash('sha256').update(JSON.stringify([title,description])).digest('hex');
}
