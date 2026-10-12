/** Daily generation stores 標題; older imports retain the documented aliases. */
export function dailyTopicTitle(value:unknown):string {
 if(!value||typeof value!=='object'||Array.isArray(value))return '';
 const row=value as Record<string,unknown>;
 for(const key of ['標題','議題','title','topic','事件','event'])if(typeof row[key]==='string'&&row[key].trim())return row[key].trim();
 return '';
}
