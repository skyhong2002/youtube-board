import type {ReportCell,ReportColumn,ReportValue} from './report-contract';
import {numericColumn} from './report-table';
type Row=Record<string,ReportValue|ReportCell>;
const raw=(value:ReportValue|ReportCell|undefined)=>value!==null&&typeof value==='object'?value.value:value;
/** Rough rendered width in CJK character cells: ideographs and full-width marks 1, the rest about half. */
export function textWidth(text:string){let width=0;for(const ch of text)width+=ch.codePointAt(0)!>=0x2e80?1:0.55;return width;}
const cellWidth=(column:ReportColumn,value:ReportValue|ReportCell|undefined)=>{
 const v=raw(value);
 if(v===null||v===undefined)return 1;
 if(typeof v==='number')return textWidth(Math.round(v).toLocaleString('en-US'))+(column.kind==='percent'?0.6:0)+(Number.isInteger(v)?0:2);
 if(column.kind==='date')return 6;
 if(column.kind==='datetime')return 9;
 return textWidth(String(v));
};
/** Phone text cells of an unstacked narrow table are cut at this many character cells (max-sm:max-w-36). */
export const PHONE_TEXT_CELLS=10;
/** About 25 character cells of 14px text fit a 390px phone row inside the card, less each cell's padding. */
const PHONE_ROW_CELLS=25,CELL_PADDING=1.2,MEDIA_CELLS=3.5;
/** A narrow table (three columns or fewer) stacks its cells on phones only when a single line
 * cannot carry it: when typical text is longer than a phone cut keeps (sentences, video titles),
 * or the columns do not fit side by side even with that cut. Short lists (group names and counts,
 * term and weight) stay one line per row. */
export function stackOnPhones(columns:ReportColumn[],rows:Row[]){
 if(columns.length>3||!rows.length)return false;
 let total=0;
 for(const column of columns){
  const widths=rows.map(row=>cellWidth(column,row[column.key])).sort((a,b)=>a-b),median=widths[Math.floor((widths.length-1)/2)]!,max=widths[widths.length-1]!;
  const media=rows.some(row=>{const cell=row[column.key];return cell!==null&&typeof cell==='object'&&!!cell.media;})?MEDIA_CELLS:0;
  if(numericColumn(column)){total+=max+CELL_PADDING;continue;}
  if(median>PHONE_TEXT_CELLS)return true;
  total+=Math.min(PHONE_TEXT_CELLS,max)+media+CELL_PADDING;
 }
 return total>PHONE_ROW_CELLS;
}
/** Numeric columns holding the same value on every row of a wide table (coverage counts such as
 * 選定日數 7 on each group). They compare nothing, so the table names them once above itself.
 * Never the first or the lead column, only with three rows or more, and at least three columns stay. */
export function uniformColumns(columns:ReportColumn[],rows:Row[],lead:number):{column:ReportColumn;value:number}[]{
 if(columns.length<=4||rows.length<3)return [];
 const uniform=columns.flatMap((column,index)=>{
  if(index===0||index===lead||!numericColumn(column))return [];
  const first=raw(rows[0]![column.key]);
  if(typeof first!=='number'||!Number.isFinite(first))return [];
  return rows.every(row=>{const cell=row[column.key];return raw(cell)===first&&!(cell!==null&&typeof cell==='object'&&(cell.href||cell.detail||cell.media));})?[{column,value:first}]:[];
 });
 return columns.length-uniform.length>=3?uniform:uniform.slice(0,Math.max(0,columns.length-3));
}
