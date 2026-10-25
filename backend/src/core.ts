import { createHash } from 'node:crypto';

export type ActionKind = 'email' | 'file' | 'api' | 'database';
export type Decision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'BLOCK';
export type Action = {
  schema_version: '1.0'; kind: ActionKind; goal: string; tool: string; operation: string;
  resource: string; recipient?: string; data_classification: 'public' | 'internal' | 'confidential' | 'restricted';
  content?: string; evidence_refs: string[]; preconditions: string[]; permissions: string[];
  correlation_id: string; idempotency_key: string;
};
const LIMIT = 16_384;
const id = (s: string) => s.length > 0 && s.length <= 160;
export function validateAction(input: unknown): Action {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Action must be a JSON object');
  const a = input as Record<string, unknown>;
  const known = new Set(['schema_version','kind','goal','tool','operation','resource','recipient','data_classification','content','evidence_refs','preconditions','permissions','correlation_id','idempotency_key']);
  if (Object.keys(a).some(k=>!known.has(k))) throw new Error('Action contains unsupported fields');
  if (Buffer.byteLength(JSON.stringify(a), 'utf8') > LIMIT) throw new Error('Action exceeds 16 KB limit');
  const enums = (v: unknown, list: string[]) => typeof v === 'string' && list.includes(v);
  for (const key of ['schema_version','kind','goal','tool','operation','resource','data_classification','correlation_id','idempotency_key']) {
    if (typeof a[key] !== 'string' || !id(a[key] as string)) throw new Error(`Invalid or missing ${key}`);
  }
  if (a.schema_version !== '1.0') throw new Error('Unsupported action schema version');
  if (!enums(a.kind, ['email','file','api','database'])) throw new Error('Unsupported action type');
  if (!enums(a.data_classification, ['public','internal','confidential','restricted'])) throw new Error('Invalid data classification');
  if (a.recipient !== undefined && (typeof a.recipient !== 'string' || !id(a.recipient))) throw new Error('Invalid recipient');
  if (a.content !== undefined && (typeof a.content !== 'string' || a.content.length > 8000)) throw new Error('Invalid content');
  for (const k of ['evidence_refs','preconditions','permissions']) if (!Array.isArray(a[k]) || a[k].length > 32 || !(a[k] as unknown[]).every(x => typeof x === 'string' && x.length <= 300)) throw new Error(`Invalid ${k}`);
  const allowed: Record<ActionKind, string[]> = { email: ['send','draft'], file: ['read','write','delete'], api: ['get','post','put','delete'], database: ['select','insert','update','delete'] };
  if (!allowed[a.kind as ActionKind].includes(a.operation as string)) throw new Error('Operation is not supported for action type');
  return structuredClone(a) as Action;
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const actionHash = (a: Action) => sha256(canonical(a));
export type Factor = { score: number; weight: number; contribution: number; explanation: string; evidence_refs: string[]; source_version: string; missing_information: string[]; assumptions: string[] };
export function assess(a: Action) {
  const external = !!a.recipient && !/(^|@)(example\.com|internal\.test)$/i.test(a.recipient);
  const sensitive = /(?:password|api[_ -]?key|secret|token|ssn|credit.?card)/i.test(a.content ?? '');
  const irreversible = a.operation === 'delete' || a.operation === 'send' || a.operation === 'post';
  const scope = a.permissions.length > 2 || /\*|all|global/i.test(a.resource);
  const factors = {
    impact: [a.data_classification === 'restricted' ? 90 : a.data_classification === 'confidential' ? 70 : a.data_classification === 'internal' ? 35 : 15, .30, 'Potential impact based on declared data classification.'],
    unauthorized_access: [external ? 80 : 10, .25, external ? 'Recipient is outside the configured trusted domains.' : 'No external recipient detected.'],
    irreversibility: [irreversible ? 75 : 20, .15, irreversible ? 'Operation may have an irreversible side effect.' : 'Operation is simulated and appears reversible.'],
    scope: [scope ? 75 : 20, .15, scope ? 'Broad resource or permission scope detected.' : 'No broad scope marker detected.'],
    contextual_risk: [sensitive ? 90 : /ignore (all )?previous instructions|reveal.*secret/i.test(a.content ?? '') ? 70 : 15, .15, sensitive ? 'Synthetic sensitive-data pattern detected.' : 'Contextual pattern scan only; misses are possible.'],
  } as const;
  const detail: Record<string, Factor> = {}; let score = 0;
  for (const [name, [v, weight, explanation]] of Object.entries(factors)) {
    const contribution = v * weight; score += contribution;
    detail[name] = { score: v, weight, contribution, explanation, evidence_refs: a.evidence_refs, source_version: 'heuristic-v1', missing_information: [], assumptions: ['Input declarations are accurate.'] };
  }
  return { score: Math.round(score * 100) / 100, label: 'HEURISTIC_NOT_PROBABILITY', config_version: 'risk-weights-v1', factors: detail };
}
export function decide(a: Action, score: number, config: { version?: string; approvalThreshold?: number } = {}): { decision: Decision; reasons: string[]; policy_version: string; mandatory_block: boolean } {
  const mandatory: string[] = [], reasons: string[] = [];
  if (/ignore (all )?previous instructions|override policy|reveal.*secret/i.test(a.content ?? '')) mandatory.push('Untrusted content contains a prompt-injection indicator.');
  if (a.data_classification === 'restricted' && a.recipient && !/(example\.com|internal\.test)$/i.test(a.recipient)) mandatory.push('Restricted data cannot be sent to an external recipient.');
  if (a.permissions.includes('*')) mandatory.push('Wildcard agent permissions are forbidden.');
  if (mandatory.length) return { decision:'BLOCK',reasons:mandatory,policy_version:config.version??'policy-v1',mandatory_block:true };
  if (a.data_classification === 'restricted') reasons.push('Restricted data requires a higher-authority review.');
  if (a.kind === 'email' && a.operation === 'send' && !a.recipient) reasons.push('Recipient is missing and must be verified.');
  if (a.kind === 'email' && a.operation === 'send' && a.recipient && !/(example\.com|internal\.test)$/i.test(a.recipient)) reasons.push('External email requires a separate approver.');
  if (a.operation === 'delete') reasons.push('Deletion requires approval.');
  if (score >= (config.approvalThreshold ?? 55)) reasons.push('Heuristic score reached the approval threshold.');
  return { decision:reasons.length?'REQUIRE_APPROVAL':'ALLOW',reasons,policy_version:config.version??'policy-v1',mandatory_block:false };
}
export function simulate(a: Action) {
  const deletion = a.operation === 'delete';
  return [
    { category: 'intended', severity: 10, likelihood: 'qualitative', summary: `Simulated ${a.kind} ${a.operation} on ${a.resource}.`, reversibility: deletion ? 'limited' : 'reversible' },
    ...(a.recipient && !/(example\.com|internal\.test)$/i.test(a.recipient) ? [{ category: 'adverse', severity: 65, likelihood: 'unknown', summary: 'Data may reach an unverified external recipient.', reversibility: 'limited' }] : []),
    ...(a.data_classification === 'restricted' ? [{ category: 'worst_credible', severity: 90, likelihood: 'unknown', summary: 'Restricted data exposure may cause serious harm.', reversibility: 'irreversible' }] : []),
  ].map((s, i) => ({ scenario_id: `scenario-${i + 1}`, ...s, assumptions: ['Mock connector; no external side effect occurs.'], evidence_refs: a.evidence_refs, affected_resources: [a.resource], mitigations: ['Verify scope and preconditions before authorization.'], simulator_version: 'deterministic-v1' }));
}
export function nextAuditHash(previous: string, event: object) { return sha256(`${previous}\n${canonical(event)}`); }
export function alternatives(a: Action) {
  const candidates: Array<{ id: string; label: string; change: (x: Action) => Action | null }> = [
    { id:'save_as_draft', label:'Save as draft', change:x=>({...x,operation:x.kind==='email'?'draft':x.operation}) },
    { id:'verify_recipient', label:'Verify recipient', change:x=>({...x,preconditions:[...new Set([...x.preconditions,'recipient verified by an independent source'])]}) },
    { id:'redact_sensitive_content', label:'Redact detected sensitive patterns', change:x=>({...x,content:(x.content??'').replace(/(password|api[_ -]?key|secret|token|ssn|credit.?card)\s*[:=]?\s*[^\s,;]+/gi,'[REDACTED]')}) },
    { id:'request_approval', label:'Request appropriate approval', change:x=>({...x,preconditions:[...new Set([...x.preconditions,'separate authorized approver confirms this exact action'])]}) },
    { id:'cancel', label:'Cancel action', change:()=>null },
  ];
  return candidates.map(c=>{const action=c.change(structuredClone(a));if(!action)return {plan_id:c.id,label:c.label,goal_completion:0,action:null,action_hash:null,risk_score:0,decision:'NO_ACTION',policy_reasons:[],potential_benefits:['Prevents the proposed side effect.'],side_effects:['The requested outcome does not occur.'],reversibility:'not_applicable',remaining_uncertainty:[],required_permissions:[]};const risk=assess(action);const policy=decide(action,risk.score);return {plan_id:c.id,label:c.label,goal_completion:c.id==='save_as_draft'?70:100,action,action_hash:actionHash(action),risk_score:risk.score,decision:policy.decision,policy_reasons:policy.reasons,potential_benefits:['Preserves the stated objective with an additional safeguard.'],side_effects:[],reversibility:'reversible',remaining_uncertainty:['Pattern checks are incomplete.'],required_permissions:action.permissions};});
}






export type Finding = { code: string; severity: 'low'|'medium'|'high'|'critical'; evidence: string[]; detector_version: string; limitation: string };
export function detectAnomalies(a: Action): Finding[] {
  const out: Finding[]=[]; const add=(code:string,severity:Finding['severity'],evidence:string[],limitation:string)=>out.push({code,severity,evidence,detector_version:'detectors-v1',limitation});
  if(/(?:password|api[_ -]?key|secret|token|ssn|credit.?card)\s*[:=]?\s*[^\s,;]+/i.test(a.content??''))add('sensitive_pattern','high',['action.content'],'Pattern detection is incomplete; no payload classification guarantee.');
  if(a.recipient&&!/(example\.com|internal\.test)$/i.test(a.recipient))add('external_recipient','high',['action.recipient'],'Trusted domains are a demo allowlist and require deployment-specific configuration.');
  if(a.permissions.includes('*')||/\*|\ball\b|global/i.test(a.resource))add('scope_expansion','high',['action.permissions','action.resource'],'String rules can miss semantic scope expansion.');
  if(/ignore (all )?previous instructions|override policy|reveal.*secret/i.test(a.content??''))add('prompt_injection_indicator','high',['action.content'],'Indicator matching cannot reliably detect prompt injection.');
  if(!a.evidence_refs.length)add('missing_evidence','medium',['action.evidence_refs'],'Evidence presence does not establish accuracy or causation.');
  if(/\b(delete|remove|destroy)\b/i.test(a.goal)&&a.operation!=='delete'||/\b(read|inspect|view)\b/i.test(a.goal)&&a.operation==='delete')add('intent_action_mismatch','medium',['action.goal','action.operation'],'Goal text matching is heuristic and may be wrong.');
  if(a.kind==='email'&&a.operation==='send'&&!a.recipient)add('missing_recipient','high',['action.recipient'],'Recipient identity and authorization must be verified independently.');
  return out;
}
