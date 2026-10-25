import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app.ts';
import { assess, decide, validateAction } from '../src/core.ts';
const goodAction = (extra: Record<string, unknown> = {}) => ({ schema_version:'1.0',kind:'email',goal:'Notify internal reviewer',tool:'mock-email',operation:'send',resource:'mailbox/demo',recipient:'reviewer@example.com',data_classification:'internal',content:'Review attached draft',evidence_refs:['trace:1'],preconditions:['recipient verified'],permissions:['email:send'],correlation_id:'corr-1',idempotency_key:crypto.randomUUID(),...extra });
async function fixture() {
  const db=new DatabaseSync(':memory:'); const tokens={op:{id:'operator',role:'operator' as const},ap:{id:'approver',role:'approver' as const},adm:{id:'admin',role:'admin' as const}};
  let clock=Date.now(); const {server,handler}=createApp(db,{tokens,secret:'test-secret',now:()=>clock,rateLimit:100});
  const request=async(path:string,token='op',body?:unknown,method?:string)=>{
    let status=200, payload:any=null; const headers:any={authorization:`Bearer ${token}`,'x-correlation-id':'test-trace'};
    const req:any={method:method??(body?'POST':'GET'),url:path,headers,async *[Symbol.asyncIterator](){if(body!==undefined)yield Buffer.from(JSON.stringify(body));}};
    const res:any={setHeader(){},writeHead(code:number){status=code;},end(data:string){payload=JSON.parse(data);}};
    await handler(req,res); return {status,json:async()=>payload};
  };
  return {db,server,request,advance:(ms:number)=>{clock+=ms;},close:async()=>{server.close();}};
}
test('rejects unsupported and malformed actions',()=>{
  assert.throws(()=>validateAction({...goodAction(),kind:'shell',operation:'run'}),/Unsupported action type/);
  assert.throws(()=>validateAction({...goodAction(),operation:'execute'}),/not supported/);
  assert.throws(()=>validateAction({...goodAction(),unexpected:'value'}),/unsupported fields/);
});
test('heuristic score is reproducible and not represented as probability',()=>{
  const a=validateAction(goodAction()); const x=assess(a),y=assess(a); assert.deepEqual(x,y); assert.equal(x.label,'HEURISTIC_NOT_PROBABILITY');
  assert.equal(Object.values(x.factors).reduce((s,f)=>s+f.weight,0),1); assert.equal(decide(a,x.score).decision,'ALLOW');
});
test('external email preview, separate approval, mock commit, audit verification and duplicate protection',async t=>{
  const f=await fixture(); t.after(f.close); const p=await f.request('/api/actions/preview','op',{action:goodAction({recipient:'outside@elsewhere.invalid'})}); assert.equal(p.status,201); const preview=await p.json() as any;
  assert.equal(preview.policy.decision,'REQUIRE_APPROVAL'); assert.equal(preview.proof.commit_eligibility,false); assert.equal(preview.scenarios[0].action_id,preview.action_id); assert.ok(preview.scenarios[0].generated_at);
  assert.equal((await f.request(`/api/actions/${preview.action_id}/approve`,'ap',{action_hash:preview.action_hash})).status,200);
  const commit=await f.request(`/api/actions/${preview.action_id}/commit`,'op',{action_hash:preview.action_hash,preview_token:preview.preview_token}); assert.equal(commit.status,200); assert.equal((await commit.json() as any).simulated,true);
  assert.equal((f.db.prepare('select count(*) n from mock_outbox').get() as any).n,1); assert.equal((await (await f.request('/api/audit/verify')).json() as any).valid,true);
  assert.equal((await f.request(`/api/actions/${preview.action_id}/commit`,'op',{action_hash:preview.action_hash,preview_token:preview.preview_token})).status,409);
});

test('commit gate rejects recipient tampering after approval', async t => {
  const f = await fixture();
  t.after(f.close);

  const p = await f.request('/api/actions/preview', 'op', {
    action: goodAction({ recipient: 'outside@elsewhere.invalid' })
  });
  assert.equal(p.status, 201);
  const preview = await p.json() as any;

  const approval = await f.request(
    `/api/actions/${preview.action_id}/approve`,
    'ap',
    { action_hash: preview.action_hash }
  );
  assert.equal(approval.status, 200);

  // Simulate a changed recipient in the stored action.
  const stored = f.db.prepare(
    'SELECT action_json FROM actions WHERE id=?'
  ).get(preview.action_id) as any;

  const tamperedAction = {
    ...JSON.parse(stored.action_json),
    recipient: 'attacker@outside.invalid'
  };

  f.db.prepare(
    'UPDATE actions SET action_json=? WHERE id=?'
  ).run(JSON.stringify(tamperedAction), preview.action_id);

  const commit = await f.request(
    `/api/actions/${preview.action_id}/commit`,
    'op',
    {
      action_hash: preview.action_hash,
      preview_token: preview.preview_token
    }
  );

  assert.equal(commit.status, 409);
  assert.equal(
    (await commit.json() as any).error,
    'action_hash_mismatch'
  );

  const outbox = f.db.prepare(
    'SELECT count(*) AS n FROM mock_outbox WHERE action_id=?'
  ).get(preview.action_id) as any;

  assert.equal(outbox.n, 0);
});

test('mandatory policy block cannot be approved even by approver',async t=>{
  const f=await fixture(); t.after(f.close); const p=await f.request('/api/actions/preview','op',{action:goodAction({recipient:'attacker@outside.invalid',data_classification:'restricted'})}); const preview=await p.json() as any;
  assert.equal(preview.policy.decision,'BLOCK'); assert.equal((await f.request(`/api/actions/${preview.action_id}/approve`,'ap',{action_hash:preview.action_hash})).status,403);
});
test('requires authentication and rejects actor idempotency replay',async t=>{
  const f=await fixture(); t.after(f.close); const a=goodAction(); assert.equal((await f.request('/api/actions/preview','missing',{action:a})).status,401);
  assert.equal((await f.request('/api/actions/preview','op',{action:a})).status,201); assert.equal((await f.request('/api/actions/preview','op',{action:a})).status,409);
});


test('rejects wrong approver role, changed action hash, and expired previews',async t=>{
  const f=await fixture(); t.after(f.close); const p=await f.request('/api/actions/preview','op',{action:goodAction({recipient:'outside@elsewhere.invalid'})}); const preview=await p.json() as any;
  assert.equal((await f.request(`/api/actions/${preview.action_id}/approve`,'op',{action_hash:preview.action_hash})).status,403);
  assert.equal((await f.request(`/api/actions/${preview.action_id}/approve`,'ap',{action_hash:'changed'})).status,409);
  f.advance(10*60*1000+1); assert.equal((await f.request(`/api/actions/${preview.action_id}/approve`,'ap',{action_hash:preview.action_hash})).status,410);
});
test('audit verification detects modified persisted event metadata',async t=>{
  const f=await fixture(); t.after(f.close); await f.request('/api/actions/preview','op',{action:goodAction()});
  f.db.prepare("UPDATE audit_events SET metadata_json='{}'").run(); const result=await (await f.request('/api/audit/verify')).json() as any; assert.equal(result.valid,false);
});


test('trace events preserve evidence labels and do not infer causality automatically',async t=>{
  const f=await fixture(); t.after(f.close);
  const created=await f.request('/api/traces','op',{objective:'Review message',original_instruction:'Check token=verysecret and draft reply'}); assert.equal(created.status,201); const trace=await created.json() as any; assert.match(trace.original_instruction,/REDACTED/);
  const event=await f.request(`/api/traces/${trace.trace_id}/events`,'op',{kind:'tool_call',source:'mock-email',content:'Read sender metadata',evidence_status:'verified_observation'}); assert.equal(event.status,201); const ev=await event.json() as any;
  const edge=await f.request(`/api/traces/${trace.trace_id}/edges`,'op',{from_node:trace.node_id,to_node:ev.node_id,relationship:'preceded',confidence_kind:'verified_observation',explanation:'Recorded sequence only'}); assert.equal(edge.status,201);
  const got=await f.request(`/api/traces/${trace.trace_id}`); const body=await got.json() as any; assert.equal(body.events.length,2); assert.equal(body.edges.length,1); assert.equal(body.edges[0].relationship,'preceded');
});
test('evaluation endpoint persists actual deterministic run metrics and alternatives are generated',async t=>{
  const f=await fixture(); t.after(f.close);
  const preview=await f.request('/api/actions/preview','op',{action:goodAction()}); const p=await preview.json() as any;
  const plans=await f.request(`/api/actions/${p.action_id}/alternatives`); assert.equal(plans.status,200); assert.ok((await plans.json() as any).plans.length>=4);
  const run=await f.request('/api/evaluations/run','ap',{}); assert.equal(run.status,201); const result=await run.json() as any; assert.equal(result.results.length,5); assert.equal(result.metrics.policy_accuracy,1);
  const saved=await f.request(`/api/evaluations/${result.run_id}`,'ap'); assert.equal(saved.status,200); assert.equal((await saved.json() as any).results.length,5);
});



test('agent permissions are least-privilege and policy releases invalidate stale previews',async t=>{
  const f=await fixture(); t.after(f.close);
  const fileAction=goodAction({kind:'file',operation:'delete',permissions:['file:delete']});
  assert.equal((await f.request('/api/actions/preview','op',{action:fileAction})).status,403);
  assert.equal((await f.request('/api/admin/agents/demo-agent/permissions','adm',{permissions:['email:send','email:draft','file:delete','file:read','api:get','database:select']},'PUT')).status,200);
  assert.equal((await f.request('/api/actions/preview','op',{action:fileAction})).status,201);
  const p=await f.request('/api/actions/preview','op',{action:goodAction()});const preview=await p.json() as any;assert.equal(preview.state,'AUTHORIZED');
  assert.equal((await f.request('/api/admin/policies','adm',{version:'policy-v2',approval_threshold:20})).status,201);
  assert.equal((await f.request(`/api/actions/${preview.action_id}/commit`,'op',{action_hash:preview.action_hash,preview_token:preview.preview_token})).status,409);
  assert.equal((await (await f.request('/api/policies/current')).json() as any).version,'policy-v2');
});
test('preview includes structured anomaly findings',async t=>{
  const f=await fixture();t.after(f.close);const p=await f.request('/api/actions/preview','op',{action:goodAction({content:'password=example-secret',evidence_refs:[]})});const result=await p.json() as any;
  const codes=result.risk.findings.map((x:any)=>x.code);assert.ok(codes.includes('sensitive_pattern'));assert.ok(codes.includes('missing_evidence'));
});



test('lists visible actions and persists unavailable model comparisons without overriding policy',async t=>{
  const f=await fixture();t.after(f.close);const action=goodAction({recipient:'outside@elsewhere.invalid'});const preview=await f.request('/api/actions/preview','op',{action});const p=await preview.json() as any;
  const queue=await f.request('/api/actions?status=AUTHORIZATION_PENDING','ap');assert.equal((await queue.json() as any).actions.length,1);
  assert.equal((await f.request('/api/actions?status=AUTHORIZATION_PENDING','op')).status,200);
  const compare=await f.request('/api/models/compare','op',{action});const c=await compare.json() as any;assert.equal(compare.status,200);assert.equal(c.policy_decision.decision,p.policy.decision);assert.equal(c.models.llm.status,'unconfigured');assert.equal(c.models.learned.status,'unavailable_insufficient_data');assert.equal((f.db.prepare('select count(*) n from model_comparisons').get() as any).n,1);
});
test('sandbox boot seeds realistic local data and exposes local-only demo sessions',async t=>{
  const db=new DatabaseSync(':memory:'),tokens={'sandbox-op':{id:'sandbox-operator',role:'operator' as const},'sandbox-approver':{id:'sandbox-approver',role:'approver' as const},'sandbox-admin':{id:'sandbox-admin',role:'admin' as const}};
  const {server,handler}=createApp(db,{tokens,secret:'sandbox-secret',sandbox:true});t.after(()=>server.close());
  const call=async(url:string,token='sandbox-op')=>{let status=200,payload:any;const req:any={method:'GET',url,headers:{authorization:`Bearer ${token}`},async *[Symbol.asyncIterator](){}},res:any={setHeader(){},writeHead(n:number){status=n},end(data:string){payload=JSON.parse(data)}};await handler(req,res);return {status,payload}};
  const session=await call('/api/sandbox/session','');assert.equal(session.payload.sandbox,true);assert.equal(session.payload.approver_token,'sandbox-approver');
  const actions=await call('/api/actions');assert.equal(actions.payload.actions.length,3);assert.deepEqual(new Set(actions.payload.actions.map((a:any)=>a.state)),new Set(['AUTHORIZED','AUTHORIZATION_PENDING','BLOCKED']));
  assert.equal((await call('/api/audit/verify')).payload.valid,true);assert.equal((db.prepare('SELECT count(*) AS n FROM traces').get() as any).n,1);
});
