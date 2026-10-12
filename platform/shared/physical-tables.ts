import type {Connection,RowDataPacket} from 'mysql2/promise';
export interface PhysicalTable {schema:string;table:string;engine:string}
export type TableMapping=Readonly<Record<string,{schema:string;table:string}>>;
const bindings=new WeakMap<Connection,TableMapping>();
const identifier=(value:string)=>{if(!/^[a-z][a-z0-9_]{0,63}$/.test(value))throw new Error('Invalid physical table identifier');return '`'+value+'`';};
/** Verify a direct column-for-column facade. Schema configuration alone grants no trust. */
export async function verifyFacadeTable(db:Connection,facade:string,name:string,target:{schema:string;table:string}):Promise<PhysicalTable>{
 for(const value of [facade,name,target.schema,target.table])identifier(value);
 const[views]=await db.query<RowDataPacket[]>('SELECT VIEW_DEFINITION,IS_UPDATABLE,SECURITY_TYPE,ALGORITHM,CHECK_OPTION FROM information_schema.VIEWS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',[facade,name]);
 const view=views[0];if(views.length!==1||view?.IS_UPDATABLE!=='YES'||view.SECURITY_TYPE!=='INVOKER'||view.ALGORITHM!=='MERGE'||view.CHECK_OPTION!=='NONE')throw new Error('Worker source view boundary mismatch');
 const[tables]=await db.query<RowDataPacket[]>('SELECT TABLE_TYPE,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',[target.schema,target.table]);
 if(tables.length!==1||tables[0]?.TABLE_TYPE!=='BASE TABLE'||!tables[0].ENGINE)throw new Error('Worker backing table is not a physical base table');
 const[columns]=await db.query<RowDataPacket[]>('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[target.schema,target.table]);
 const backing=identifier(target.schema)+'.'+identifier(target.table);
 // MariaDB persists SELECT * as this explicit projection. Reject filters, joins,
 // expressions, renamed columns and views pointing through another view.
 const expected='select '+columns.map(r=>{const name=String(r.COLUMN_NAME);if(name.includes('`'))throw new Error('Unsupported backing column');return backing+'.`'+name+'` AS `'+name+'`';}).join(',')+' from '+backing;
 if(!columns.length||view.VIEW_DEFINITION!==expected)throw new Error('Worker source view mapping mismatch');
 return {schema:target.schema,table:target.table,engine:String(tables[0].ENGINE)};
}
export async function bindFacadeTables(db:Connection,facade:string,mapping:TableMapping){
 const[current]=await db.query<RowDataPacket[]>('SELECT DATABASE() AS current_schema');if(current[0]?.current_schema!==facade)throw new Error('Worker facade connection mismatch');
 if(!Object.keys(mapping).length)throw new Error('Empty worker mapping');
 for(const[name,target]of Object.entries(mapping))await verifyFacadeTable(db,facade,name,target);
 bindings.set(db,Object.freeze(Object.fromEntries(Object.entries(mapping).map(([name,target])=>[name,Object.freeze({...target})]))));
}
/** Returns real backing metadata, never invents an engine for a VIEW. */
export async function physicalTables(db:Connection,names:readonly string[]):Promise<PhysicalTable[]>{
 const mapping=bindings.get(db),[current]=await db.query<RowDataPacket[]>('SELECT DATABASE() AS current_schema'),schema=String(current[0]?.current_schema??'');identifier(schema);
 const result:PhysicalTable[]=[];
 for(const name of names){identifier(name);if(mapping){const target=mapping[name];if(!target)throw new Error('Unowned worker table');result.push(await verifyFacadeTable(db,schema,name,target));}
 else{const[rows]=await db.query<RowDataPacket[]>('SELECT TABLE_TYPE,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',[schema,name]);if(rows.length){if(rows[0]?.TABLE_TYPE!=='BASE TABLE'||!rows[0].ENGINE)throw new Error('Unverified source view');result.push({schema,table:name,engine:String(rows[0].ENGINE)});}}}
 return result;
}
