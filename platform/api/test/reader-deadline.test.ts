import {expect,it} from 'vitest';
import {sql} from 'drizzle-orm';
import {createReader} from '../src/db/client.js';
it('keeps the 15-second request ceiling and lets only an explicit small background reader raise it to 60 seconds',async()=>{
 expect(()=>createReader(undefined,{acquireMs:3000,statementMs:60000})).toThrow('Invalid query deadline');
 expect(()=>createReader(undefined,{acquireMs:3000,statementMs:60000},{maxStatementMs:60001})).toThrow('Invalid query deadline');
 expect(()=>createReader(undefined,{acquireMs:3000,statementMs:5000},{connectionLimit:7})).toThrow('Invalid query deadline');
 const request=createReader('mysql://u:p@127.0.0.1:1/x'),background=createReader('mysql://u:p@127.0.0.1:1/x',{acquireMs:50,statementMs:60000},{maxStatementMs:60000,connectionLimit:1});
 try{
  await expect(request.rows(sql`SELECT 1`,{statementMs:20000})).rejects.toThrow('Invalid query deadline');
  await expect(background.rows(sql`SELECT 1`,{statementMs:60001})).rejects.toThrow('Invalid query deadline');
  await expect(background.rows(sql`SELECT 1`,{statementMs:60000})).rejects.not.toThrow('Invalid query deadline');
 }finally{await request.close();await background.close();}
});
