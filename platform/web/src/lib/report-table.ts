import type {ReportCell,ReportColumn,ReportValue} from './report-contract';
type Row=Record<string,ReportValue|ReportCell>;
export function numericColumn(column:ReportColumn){return column.kind==='number'||column.kind==='percent';}
const timeColumn=(column:ReportColumn)=>column.kind==='date'||column.kind==='datetime';
/** Wide report tables keep one identifying column sticky. A leading rank or
 * source-log number says little once the table is scrolled, so the lead is the
 * column that carries a channel avatar or video thumbnail, else the first text
 * column after a leading run of numbers and dates. Tables that open with a
 * date or name (daily matrices, hour grids) and rank-by-date matrices keep
 * their first column. Column order is never changed. */
export function reportLeadIndex(columns:ReportColumn[],rows:Row[]){
 const media=columns.findIndex(column=>rows.some(row=>{const cell=row[column.key];return cell!==null&&typeof cell==='object'&&!!cell.media;}));
 if(media>=0)return media;
 if(!columns.length||!numericColumn(columns[0]))return 0;
 const next=columns.findIndex(column=>!numericColumn(column)&&!timeColumn(column));
 return next>0&&!/^\d{4}-\d{2}-\d{2}/.test(columns[next].label)?next:0;
}
