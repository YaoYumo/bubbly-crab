// Runs the installed, real native helper against a loopback fixture, NOT real GGUF/Astrill.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
const exe=process.argv[2];if(!exe)throw Error('helper path required');
const key=randomBytes(32).toString('hex');let mode='health',received,requests=0;
const server=http.createServer(async(req,res)=>{requests++;assert.equal(req.headers.authorization,'Bearer '+key);let bytes=[];for await(const part of req)bytes.push(part);received=Buffer.concat(bytes);
 if(mode==='hang')return;
 if(mode==='redirect'){res.writeHead(302,{Location:'https://example.invalid/','Content-Length':'0'});res.end();return;}
 if(mode==='chat'){assert.equal(req.url,'/v1/chat/completions');assert.equal(req.method,'POST');const reply=Buffer.from(JSON.stringify({choices:[{message:{content:'{"reply":"放置一座大殿","operations":[]}'}}]}));res.writeHead(200,{'Content-Length':String(reply.length)});res.end(reply);return;}
 assert.equal(req.url,'/health');res.writeHead(200,{'Content-Type':'application/json'});res.write('{"sta');res.end('tus":"ok"}');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const wire=(kind,body='',timeout=2000)=>`PREVIZ-LOOPBACK/1\n${kind}\n${port}\n${timeout}\n${key}\n${Buffer.byteLength(body)}\n${body}`;
function run(input,{kill=false}={}){return new Promise((resolve,reject)=>{const child=spawn(exe,[],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:''}}),out=[];let count=0,stderr='';const timer=setTimeout(()=>{child.kill();reject(Error('helper test timeout'));},5000);child.stdout.on('data',b=>{count+=b.length;if(count>1048704){child.kill();reject(Error('oversized helper output'));}else out.push(b);});child.stderr.on('data',b=>{stderr+=b.toString().slice(0,1024);});child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,text:Buffer.concat(out).toString(),stderr});});child.stdin.on('error',()=>{});child.stdin.end(input);if(kill)setTimeout(()=>child.kill(),100);});}
try{
 let result=await run('PREVIZ-LOOPBACK/1\nprobe\n');assert.equal(result.code,0);assert.match(result.text,/^PORT [1-9][0-9]*\n$/);
 result=await run(wire('health'));assert.equal(result.code,0,result.stderr);assert.equal(result.text,'STATUS 200\n{"status":"ok"}');
 mode='chat';const body=JSON.stringify({messages:[{role:'user',content:'中式院落\n向右移5米'}],response_format:{type:'json_object'}});result=await run(wire('chat',body));assert.equal(result.code,0,result.stderr);assert.equal(received.toString(),body);assert.match(result.text,/^STATUS 200\n/);assert.ok(JSON.parse(result.text.slice('STATUS 200\n'.length)).choices[0].message.content.includes('大殿'));
 mode='redirect';const before=requests;result=await run(wire('health'));assert.equal(result.code,0);assert.equal(result.text,'STATUS 302\n');assert.equal(requests,before+1);
 result=await run('PREVIZ-LOOPBACK/1\nother\n');assert.equal(result.code,2);
 mode='hang';result=await run(wire('health','',60));assert.equal(result.code,2);
 result=await run(wire('health','',2000),{kill:true});assert.notEqual(result.code,0);
 const report={status:'PASS_INSTALLED_LOOPBACK_HELPER',probe:true,chunkedHealth:true,unicodeChatRoundTrip:true,proxyEnvironmentIgnored:true,noRedirect:true,malformedInputRejected:true,socketTimeout:true,childTerminationDoesNotTerminateTestHost:true,realAstrillDllInjected:false,realGGUFInferenceVerified:false};mkdirSync('.shots',{recursive:true});writeFileSync('.shots/loopback-installed.json',JSON.stringify(report,null,2)+'\n');console.log('::notice title=Installed isolated loopback helper::'+JSON.stringify(report));
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
