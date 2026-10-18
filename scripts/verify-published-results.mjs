// Offline v1.4 gate: complete cohorts, retained measurements, safe public artifacts.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {csv, isInfraRow} from '../harness/lib.mjs';
import {publicCleaner} from './prepare-model-release.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const run=read('results/canonical/run.json');
const base=JSON.parse(execFileSync('git',['show','5ca8644:results/canonical/run.json'],{maxBuffer:100*1024*1024}));
const byId=new Map(base.rows.map(r=>[r.run_id,r]));
assert.equal(run.options.release,'v1.4');
assert.equal(run.rows.length,2793);assert.equal(new Set(run.rows.map(r=>r.run_id)).size,2793);
assert.equal(run.verdicts.length,931);
const previous=JSON.parse(execFileSync('git',['show','0983d0e:results/canonical/run.json'],{maxBuffer:100*1024*1024}));
assert.deepEqual(run.rows.slice(0,previous.rows.length),previous.rows,'v1.3 measurements changed');
assert.deepEqual(run.verdicts.slice(0,previous.verdicts.length),previous.verdicts,'v1.3 verdicts changed');
const expected=new Map([
 ['wm-claude|claude-haiku-5-5',[147,49]],['cu-claude|claude-haiku-5-5',[123,41]],
 ['wm-claude|claude-sonnet-5-5',[147,49]],['cu-claude|claude-sonnet-5-5',[140,47]],
 ['wm-gpt|gpt-6-luna',[144,48]],['cu-openai|gpt-6-luna',[128,41]],
 ['wm-gpt|gpt-6.1-sol',[147,49]],['cu-openai|gpt-6.1-sol',[134,45]],['code-openai|gpt-6.1-sol',[147,49]],
 ['wm-gemini|gemini-3.8-flash',[147,49]],['wm-meta|muse-wonder-1.0',[146,49]],
 ['wm-claude|claude-opus-5',[147,49]],['cu-claude|claude-opus-5',[134,45]],
 ['wm-gpt|gpt-6-astra',[146,49]],['cu-openai|gpt-6-astra',[135,45]],['code-openai|gpt-6-astra',[147,49]],
 ['wm-jev-mercury-v3|typesafe-ai/jev+mercury-2.5',[141,49]],['a11y-jev-mercury-ultrafast|typesafe-ai/jev+mercury-2.5',[76,25]],
 ['wm-chat|deepseek-v4.1-flash-1017',[147,49]],
]);
assert.deepEqual(new Set(run.rows.map(r=>`${r.arm}|${r.model}`)),new Set(expected.keys()));
for(const [key,[passes,solved]] of expected){
 const [arm,model]=key.split('|'),rows=run.rows.filter(r=>r.arm===arm&&r.model===model);
 assert.equal(rows.length,147);assert.equal(rows.filter(r=>r.success===true).length,passes,key);
 const cells=new Map();for(const r of rows){assert(!isInfraRow(r));const k=`${r.site}|${r.task_id}`;cells.set(k,[...(cells.get(k)||[]),r]);}
 assert.equal(cells.size,49);assert([...cells.values()].every(rs=>rs.length===3));
 const verdicts=run.verdicts.filter(v=>v.method===arm&&v.model===model);
 assert.equal(verdicts.length,49);assert.equal(verdicts.filter(v=>v.solved).length,solved);
 for(const [cell,rs] of cells){const v=verdicts.find(v=>`${v.site}|${v.taskId}`===cell);assert(v);assert.equal(v.solved,rs.filter(r=>r.success).length>=2);}
}
let retained=0;
for(const row of run.rows){
 assert(!('transcript' in row)&&!('decision_config' in row)&&!('reasoning' in row));
 assert.equal(row.pass,row.success);
 const prior=byId.get(row.run_id);if(!prior)continue;retained++;
 for(const [key,value] of Object.entries(prior))if(typeof value==='number'||typeof value==='boolean')assert.equal(row[key],value,`${row.run_id}: ${key}`);
}
assert.equal(retained,1029);
for(const row of run.rows.filter(r=>r.model==='deepseek-v4.1-flash-1017')){
 assert.equal(row.provider,'Fireworks');assert.equal(row.provider_pin,'fireworks');assert.equal(row.transport,'openrouter');
 assert.equal(row.effort,'high');assert.equal(row.cost_estimated,false);assert.equal(row.billed_cost_usd,row.est_cost_usd);
 assert.equal(row.model_snapshot,'deepseek/deepseek-v4.1-flash-1017');assert(JSON.parse(row.generation_ids).length);
}
assert.equal(fs.readFileSync('results/canonical/results.csv','utf8'),csv(run.rows));
const clean=publicCleaner();
for(const name of ['run.json','tasks.json'])assert.deepEqual(read(`results/canonical/${name}`),clean(read(`results/canonical/${name}`)),`${name}: unredacted content`);
for(const tasks of Object.values(read('results/canonical/tasks.json')))for(const task of tasks){
 for(const match of task.prompt.matchAll(/password(?:\s*[:=]\s*|\s+(?:is\s+)?)[`"']?([^\s,`"']+)/gi))assert.match(match[1],/^\[redacted\][.,;]?$/);
}
for(const file of ['run.json','tasks.json','explorer.html','explorer-artifact.html','PROVENANCE.md','PROVENANCE.json']){
 const text=fs.readFileSync(`results/canonical/${file}`,'utf8');
 assert(clean(text)===text,`${file}: unredacted fixture password or key`);
 assert(!/\/Users\/|\/private\/tmp\/|\b(?:LLM[_|]\d+[_|]|sk-(?:or-v1-|ant-api\d\d-|proj-|svcacct-)|gh[po]_)[A-Za-z0-9_-]{10,}/.test(text),file);
}
console.log('Publication verified: 19 complete configurations, 2793 attempts, 931 verdicts; all 2646 v1.3 attempts unchanged; no raw traces, keys, fixture passwords or local paths.');
