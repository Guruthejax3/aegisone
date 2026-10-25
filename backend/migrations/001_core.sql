-- Supabase/PostgreSQL schema starter. Review policies and bind them to Supabase Auth before deployment.
create extension if not exists pgcrypto;
create table if not exists organizations (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table if not exists organization_members (organization_id uuid not null references organizations on delete cascade, user_id uuid not null references auth.users on delete cascade, role text not null check (role in ('admin','operator','approver','viewer')), created_at timestamptz not null default now(), primary key (organization_id,user_id));
create table if not exists agents (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, name text not null, status text not null default 'active', created_at timestamptz not null default now(), unique(organization_id,name));
create table if not exists agent_permissions (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, agent_id uuid not null references agents on delete cascade, permission text not null, resource_pattern text not null, created_at timestamptz not null default now(), unique(agent_id,permission,resource_pattern));
create table if not exists actions (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, actor_id uuid not null references auth.users, agent_id uuid not null references agents, schema_version text not null, action jsonb not null, action_hash text not null, status text not null, decision text not null check(decision in ('ALLOW','REQUIRE_APPROVAL','BLOCK')), policy_version text not null, risk jsonb not null, scenarios jsonb not null, preview_expires_at timestamptz not null, idempotency_key text not null, created_at timestamptz not null default now(), unique(organization_id,actor_id,idempotency_key));
create index if not exists actions_org_status_created on actions(organization_id,status,created_at desc);
create table if not exists approvals (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, action_id uuid not null references actions on delete cascade, approver_id uuid not null references auth.users, action_hash text not null, policy_version text not null, expires_at timestamptz not null, created_at timestamptz not null default now(), unique(action_id));
create table if not exists mock_outbox (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, action_id uuid not null unique references actions on delete cascade, payload_hash text not null, result jsonb not null, created_at timestamptz not null default now());
create table if not exists audit_events (seq bigint generated always as identity primary key, id uuid not null unique default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, event_type text not null, actor_id uuid not null references auth.users, action_id uuid references actions, occurred_at timestamptz not null default now(), metadata jsonb not null default '{}', previous_hash text not null, event_hash text not null, unique(organization_id,seq));
create index if not exists audit_org_action_seq on audit_events(organization_id,action_id,seq);

create table if not exists traces (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, actor_id uuid not null references auth.users, agent_id uuid not null references agents, objective text not null, original_instruction text not null, created_at timestamptz not null default now());
create table if not exists trace_actions (organization_id uuid not null references organizations on delete cascade, trace_id uuid not null references traces on delete cascade, action_id uuid not null references actions on delete cascade, created_at timestamptz not null default now(), primary key(trace_id,action_id));
create table if not exists trace_events (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, trace_id uuid not null references traces on delete cascade, event_type text not null, source text not null, content_redacted text not null, evidence_status text not null check(evidence_status in ('verified_observation','inferred_relationship','model_explanation','unknown')), created_at timestamptz not null default now());
create table if not exists causal_nodes (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, trace_id uuid not null references traces on delete cascade, node_type text not null, label text not null, evidence_status text not null, reference_id uuid, created_at timestamptz not null default now());
create table if not exists causal_edges (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, trace_id uuid not null references traces on delete cascade, from_node uuid not null references causal_nodes, to_node uuid not null references causal_nodes, relationship text not null, confidence_kind text not null, explanation text not null, created_at timestamptz not null default now(), check(from_node<>to_node));
create table if not exists policies (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, name text not null, status text not null default 'draft', created_at timestamptz not null default now(), unique(organization_id,name));
create table if not exists policy_versions (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, policy_id uuid not null references policies on delete cascade, version text not null, rules jsonb not null, released_by uuid references auth.users, released_at timestamptz, unique(policy_id,version));
create table if not exists policy_decisions (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, actor_id uuid not null references auth.users, action_hash text not null, policy_version text not null, decision text not null check(decision in ('ALLOW','REQUIRE_APPROVAL','BLOCK')), risk jsonb not null, created_at timestamptz not null default now());
create table if not exists risk_assessments (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, action_id uuid not null references actions on delete cascade, model_version text not null, configuration_version text not null, score numeric not null check(score between 0 and 100), factors jsonb not null, created_at timestamptz not null default now());
create table if not exists consequence_scenarios (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, action_id uuid not null references actions on delete cascade, category text not null, scenario jsonb not null, simulator_version text not null, created_at timestamptz not null default now());
create table if not exists alternative_plans (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, action_id uuid not null references actions on delete cascade, plan jsonb not null, created_at timestamptz not null default now());
create table if not exists model_versions (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, model_name text not null, version text not null, status text not null, governance_metadata jsonb not null default '{}', created_at timestamptz not null default now(), unique(organization_id,model_name,version));
create table if not exists dataset_versions (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, version text not null, schema_version text not null, provenance jsonb not null, created_at timestamptz not null default now(), unique(organization_id,version));
create table if not exists evaluation_runs (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, actor_id uuid not null references auth.users, scenario_version text not null, model_version text not null, policy_version text not null, metrics jsonb not null, created_at timestamptz not null default now());
create table if not exists evaluation_results (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, run_id uuid not null references evaluation_runs on delete cascade, scenario_id text not null, expected_label text not null, actual_label text not null, duration_ms numeric not null, findings jsonb not null default '[]', created_at timestamptz not null default now());
create table if not exists recovery_plans (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, action_id uuid not null references actions on delete cascade, plan jsonb not null, simulated boolean not null default true, created_at timestamptz not null default now());
create table if not exists system_health_events (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations on delete cascade, component text not null, status text not null, metadata jsonb not null default '{}', created_at timestamptz not null default now());

alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table agents enable row level security;
alter table agent_permissions enable row level security;
alter table actions enable row level security;
alter table approvals enable row level security;
alter table mock_outbox enable row level security;
alter table audit_events enable row level security;
alter table system_health_events enable row level security;
alter table recovery_plans enable row level security;
alter table evaluation_results enable row level security;
alter table evaluation_runs enable row level security;
alter table dataset_versions enable row level security;
alter table model_versions enable row level security;
alter table alternative_plans enable row level security;
alter table consequence_scenarios enable row level security;
alter table risk_assessments enable row level security;
alter table policy_decisions enable row level security;
alter table policy_versions enable row level security;
alter table policies enable row level security;
alter table causal_edges enable row level security;
alter table causal_nodes enable row level security;
alter table trace_events enable row level security;
alter table traces enable row level security;
alter table trace_actions enable row level security;
-- Membership-scoped reads; writes should go through trusted server routes using transaction-aware service code.
create policy "members read traces" on traces for select using (exists(select 1 from organization_members m where m.organization_id=traces.organization_id and m.user_id=auth.uid()));
create policy "members read trace_actions" on trace_actions for select using (exists(select 1 from organization_members m where m.organization_id=trace_actions.organization_id and m.user_id=auth.uid()));
create policy "members read trace_events" on trace_events for select using (exists(select 1 from organization_members m where m.organization_id=trace_events.organization_id and m.user_id=auth.uid()));
create policy "members read causal_nodes" on causal_nodes for select using (exists(select 1 from organization_members m where m.organization_id=causal_nodes.organization_id and m.user_id=auth.uid()));
create policy "members read causal_edges" on causal_edges for select using (exists(select 1 from organization_members m where m.organization_id=causal_edges.organization_id and m.user_id=auth.uid()));
create policy "members read policies" on policies for select using (exists(select 1 from organization_members m where m.organization_id=policies.organization_id and m.user_id=auth.uid()));
create policy "members read policy_versions" on policy_versions for select using (exists(select 1 from organization_members m where m.organization_id=policy_versions.organization_id and m.user_id=auth.uid()));
create policy "members read policy_decisions" on policy_decisions for select using (exists(select 1 from organization_members m where m.organization_id=policy_decisions.organization_id and m.user_id=auth.uid()));
create policy "members read risk_assessments" on risk_assessments for select using (exists(select 1 from organization_members m where m.organization_id=risk_assessments.organization_id and m.user_id=auth.uid()));
create policy "members read consequence_scenarios" on consequence_scenarios for select using (exists(select 1 from organization_members m where m.organization_id=consequence_scenarios.organization_id and m.user_id=auth.uid()));
create policy "members read alternative_plans" on alternative_plans for select using (exists(select 1 from organization_members m where m.organization_id=alternative_plans.organization_id and m.user_id=auth.uid()));
create policy "members read model_versions" on model_versions for select using (exists(select 1 from organization_members m where m.organization_id=model_versions.organization_id and m.user_id=auth.uid()));
create policy "members read dataset_versions" on dataset_versions for select using (exists(select 1 from organization_members m where m.organization_id=dataset_versions.organization_id and m.user_id=auth.uid()));
create policy "members read evaluation_runs" on evaluation_runs for select using (exists(select 1 from organization_members m where m.organization_id=evaluation_runs.organization_id and m.user_id=auth.uid()));
create policy "members read evaluation_results" on evaluation_results for select using (exists(select 1 from organization_members m where m.organization_id=evaluation_results.organization_id and m.user_id=auth.uid()));
create policy "members read recovery_plans" on recovery_plans for select using (exists(select 1 from organization_members m where m.organization_id=recovery_plans.organization_id and m.user_id=auth.uid()));
create policy "members read system_health_events" on system_health_events for select using (exists(select 1 from organization_members m where m.organization_id=system_health_events.organization_id and m.user_id=auth.uid()));

create policy "members read organization" on organizations for select using (exists(select 1 from organization_members m where m.organization_id=id and m.user_id=auth.uid()));
create policy "members read own membership" on organization_members for select using (user_id=auth.uid());
create policy "members read agents" on agents for select using (exists(select 1 from organization_members m where m.organization_id=agents.organization_id and m.user_id=auth.uid()));
create policy "members read permissions" on agent_permissions for select using (exists(select 1 from organization_members m where m.organization_id=agent_permissions.organization_id and m.user_id=auth.uid()));
create policy "members read actions" on actions for select using (exists(select 1 from organization_members m where m.organization_id=actions.organization_id and m.user_id=auth.uid()));
create policy "members read approvals" on approvals for select using (exists(select 1 from organization_members m where m.organization_id=approvals.organization_id and m.user_id=auth.uid()));
create policy "members read outbox" on mock_outbox for select using (exists(select 1 from organization_members m where m.organization_id=mock_outbox.organization_id and m.user_id=auth.uid()));
create policy "members read audit" on audit_events for select using (exists(select 1 from organization_members m where m.organization_id=audit_events.organization_id and m.user_id=auth.uid()));
revoke insert, update, delete on audit_events from anon, authenticated;



