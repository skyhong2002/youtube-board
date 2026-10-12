import hashlib,json,os,pathlib,stat,subprocess,sys,tempfile,unittest
SCRIPT=pathlib.Path(__file__).with_name('export-ts-principals.py')
class ExportTests(unittest.TestCase):
 def run_export(self,root,mode='ok',name='out'):
  bin=root/'bin';bin.mkdir(exist_ok=True)
  fake=bin/'docker';fake.write_text('#!'+sys.executable+'\n'+r"""
import os,sys
mode=os.environ.get('FIXTURE_MODE','ok')
if sys.argv[1]=='ps':
 print('aaaaaaaaaaaa\nbbbbbbbbbbbb' if mode=='multi-container' else 'aaaaaaaaaaaa');sys.exit()
query=sys.argv[-1]
if mode=='db-error': print('fixture-auth-hash',file=sys.stderr);sys.exit(1)
if query.startswith('SELECT '):
 if mode=='empty-users': sys.exit()
 print(('unrelated_root' if mode=='bad-user' else 'youtube_ts_reader')+'\t'+("bad'host" if mode=='bad-host' else '%'))
 if mode=='duplicate-user': print('youtube_ts_reader\t%')
elif query.startswith('SHOW CREATE USER'):
 print("CREATE USER 'youtube_ts_reader'@'%' IDENTIFIED BY PASSWORD '"+('changed-fixture-hash' if mode=='changed' else 'fixture-auth-hash')+"'")
 if mode=='multi-create': print('unexpected second row')
elif query.startswith('SHOW GRANTS'):
 print('malformed grants' if mode=='bad-grants' else "GRANT SELECT ON `youtube_board_ts`.* TO 'youtube_ts_reader'@'%'")
else: sys.exit(2)
""");fake.chmod(0o700)
  env={**os.environ,'PATH':str(bin)+':'+os.environ['PATH'],'FIXTURE_MODE':mode}
  r=subprocess.run([sys.executable,str(SCRIPT),str(root/name)],env=env,capture_output=True,text=True)
  self.assertNotIn('fixture-auth-hash',r.stdout+r.stderr)
  return r,root/name
 def test_single_column_create_private_artifacts_and_deterministic_seal(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);first,out=self.run_export(root);self.assertEqual(first.returncode,0,first.stderr)
   result=json.loads(first.stdout);self.assertEqual(set(result),{'principalCount','grantCount','artifactSha256'});self.assertEqual(result['principalCount'],1);self.assertEqual(result['grantCount'],1)
   self.assertEqual(stat.S_IMODE(out.stat().st_mode),0o700)
   for filename in ['create-users.sql','grants.sql','inventory.json','principals.sha256']:self.assertEqual(stat.S_IMODE((out/filename).stat().st_mode),0o600)
   self.assertEqual(result['artifactSha256'],hashlib.sha256((out/'principals.sha256').read_bytes()).hexdigest())
   for line in (out/'principals.sha256').read_text().splitlines():
    digest,filename=line.split('  ');self.assertEqual(digest,hashlib.sha256((out/filename).read_bytes()).hexdigest())
   second,_=self.run_export(root,name='second');self.assertEqual(json.loads(second.stdout),result)
   changed,_=self.run_export(root,mode='changed',name='changed');self.assertNotEqual(json.loads(changed.stdout)['artifactSha256'],result['artifactSha256'])
 def test_out_of_scope_user_and_multiline_create_rejected_without_valid_seal(self):
  for mode in ['bad-user','bad-host','duplicate-user','empty-users','multi-create','bad-grants','multi-container']:
   with self.subTest(mode=mode),tempfile.TemporaryDirectory() as tmp:
    r,out=self.run_export(pathlib.Path(tmp),mode);self.assertNotEqual(r.returncode,0);self.assertFalse((out/'principals.sha256').exists())
 def test_upstream_error_body_withheld(self):
  with tempfile.TemporaryDirectory() as tmp:
   r,out=self.run_export(pathlib.Path(tmp),'db-error');self.assertNotEqual(r.returncode,0);self.assertIn('raw diagnostics withheld',r.stderr);self.assertFalse((out/'principals.sha256').exists())
 def test_existing_artifact_directory_is_not_overwritten(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);first,out=self.run_export(root);self.assertEqual(first.returncode,0)
   before={p.name:p.read_bytes() for p in out.iterdir()}
   second,_=self.run_export(root,mode='changed');self.assertNotEqual(second.returncode,0)
   self.assertEqual({p.name:p.read_bytes() for p in out.iterdir()},before)
 def test_service_and_prefix_arguments_reject_shell_or_sql_metacharacters(self):
  with tempfile.TemporaryDirectory() as tmp:
   for flag,value in [('--service','db;echo bad'),('--user-prefix',"ts_'bad")]:
    result=subprocess.run([sys.executable,str(SCRIPT),str(pathlib.Path(tmp)/'out'),flag,value],capture_output=True,text=True)
    self.assertNotEqual(result.returncode,0);self.assertFalse((pathlib.Path(tmp)/'out').exists())
if __name__=='__main__':unittest.main(verbosity=2)

