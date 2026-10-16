import {readFileSync,readdirSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {migrationStatements} from '../src/migration-statements.js';
const directory=new URL('../migrations/',import.meta.url);
describe('migrationStatements',()=>{
 it('drops whole-line comments even when their prose contains semicolons',()=>{
  expect(migrationStatements('-- Own schema only; reviewed.\nCREATE TABLE t (a INT);\n  -- trailing; note\nINSERT INTO t VALUES (1);')).toEqual(['CREATE TABLE t (a INT)','INSERT INTO t VALUES (1)']);
 });
 it('keeps -- inside statements that are not whole-line comments',()=>{
  expect(migrationStatements("SELECT '--x' AS v;")).toEqual(["SELECT '--x' AS v"]);
 });
 it('yields only SQL statements for every reviewed migration',()=>{
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql'))){
   for(const statement of migrationStatements(readFileSync(new URL(name,directory),'utf8')))
    expect(statement,name).toMatch(/^(CREATE|ALTER|INSERT|UPDATE|DROP|SET|REPLACE|DELETE|RENAME|PREPARE|EXECUTE|DEALLOCATE|SELECT)\b/i);
  }
 });
});
