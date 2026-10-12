import {it,expect} from 'vitest';
import {GatewayProvider} from '../src/provider.js';
import {requestWorkflowShutdown} from '../../shared/shutdown.js';
it('shutdown cancels an in-flight AI request and prevents another attempt',async()=>{
 let calls=0;const provider=new GatewayProvider({OPENAI_API_KEY:'test'},async(_url,options)=>{calls++;queueMicrotask(requestWorkflowShutdown);return new Promise((_resolve,reject)=>options!.signal!.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));});
 const plan={input:{kind:'channel'},prompt:'synthetic',schema:{type:'object',properties:{},required:[],additionalProperties:false}};
 await expect(provider.complete(plan)).rejects.toThrow('outcome unknown');await expect(provider.complete(plan)).rejects.toThrow('shutting down');expect(calls).toBe(1);
});
