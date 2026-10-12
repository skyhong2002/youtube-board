import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

// Replace the transport before invoking main: never call a real provider or use a real key.
function review(response,limit='2048'){
 const source=`import importlib.util,io,json,os,contextlib
spec=importlib.util.spec_from_file_location('review','tools/opus-review.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
os.environ['CLI_PROXY_API_KEY']='fixture-only'
os.environ['OPUS_REVIEW_MAX_TOKENS']=${JSON.stringify(limit)}
m.sys.stdin=io.StringIO('sanitized fixture packet')
def transport(request,timeout):
 payload=json.loads(request.data)
 assert payload['model']=='claude-opus-5-5'
 assert payload['max_tokens']==int(os.environ['OPUS_REVIEW_MAX_TOKENS'])
 assert request.full_url=='http://127.0.0.1:8317/v1/chat/completions'
 return contextlib.closing(io.StringIO(${JSON.stringify(JSON.stringify(response))}))
m.urllib.request.urlopen=transport
m.main()
`;
 return spawnSync('python3',['-c',source],{cwd:new URL('..',import.meta.url),encoding:'utf8',env:{PATH:process.env.PATH}});
}
const valid={model:'claude-opus-5-5',choices:[{finish_reason:'stop',message:{content:'Reviewed fixture.'}}]};
test('Opus review accepts only the exact completed model and configurable token budget',()=>{
 const result=review(valid);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).response_model,'claude-opus-5-5');assert.ok(!result.stdout.includes('fixture-only'));
});
test('wrong model, truncation, empty reviews and invalid budgets cannot count as completed reviews',()=>{
 for(const response of [{...valid,model:'other'}, {...valid,choices:[]}, {...valid,choices:[{finish_reason:'length',message:{content:'partial'}}]}, {...valid,choices:[{finish_reason:'stop',message:{content:' '}}]}]){const result=review(response);assert.notEqual(result.status,0);assert.equal(result.stdout,'');}
 for(const limit of ['1023','12001','invalid'])assert.notEqual(review(valid,limit).status,0);
});
