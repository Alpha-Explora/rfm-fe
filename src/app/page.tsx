'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, BarChart2, Brain, Building2, CheckCircle2, ClipboardCheck, Database, Eye, FileText, GitBranch, LayoutDashboard, Layers, LoaderCircle, Mail, MessagesSquare, PanelRight, Phone, Search, Send, Sparkles, Square, Upload, User, UserPlus, Users, X, Zap } from 'lucide-react';
import CreditReportView from '@/components/CreditReportView';
import Markdown from '@/components/Markdown';
import { CreditReport, PipelineResult } from './types';
import { runEveSession, buildAssessmentMessage, EveEvent } from './eve';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type ClientDocument = { id: string; name: string; type: string; size: number; content: string; encoding: 'base64' };
type Client = { id: string; name: string; industry: string; contactName?: string; email?: string; phone?: string; data: string; documents: ClientDocument[] };
type ChatItem = { id: string; role: 'assistant' | 'user' | 'trace' | 'stream' | 'report'; content: string; report?: CreditReport; agent?: string; state?: string; meta?: string };
type BackroomItem = { id: string; type: string; agent: string; target?: string; model?: string; content: string; state?: string };
type AgentName = 'director' | 'ingest' | 'analytics' | 'risk' | 'reporting';
type WorkflowAgent = { name: AgentName; status: 'idle' | 'queued' | 'running' | 'streaming' | 'complete' | 'fallback' | 'error' | 'stopped'; task: string; output: string; model?: string; durationMs?: number };
type ClientOverview = { client: Record<string, string>; documents: { name: string; type: string; extractedChars: number }[]; snapshot: string[]; highlights: string[]; nextSteps: string[] };
type TokenStats = { session: number; run: number; byAgent: Record<string, number> };
type RunRecord = { id: string; mode: 'assessment' | 'overview' | 'stopped'; clientName: string; timestamp: number; tokens: number; success: boolean };

const agentTasks: Record<AgentName, string> = {
  director: 'Coordinate client overview',
  ingest: 'Read profile and documents',
  analytics: 'Calculate metrics',
  risk: 'Classify credit risk',
  reporting: 'Package recommendation',
};

const emptyWorkflow = (): Record<AgentName, WorkflowAgent> => ({
  director: { name: 'director', status: 'idle', task: agentTasks.director, output: '' },
  ingest: { name: 'ingest', status: 'idle', task: agentTasks.ingest, output: '' },
  analytics: { name: 'analytics', status: 'idle', task: agentTasks.analytics, output: '' },
  risk: { name: 'risk', status: 'idle', task: agentTasks.risk, output: '' },
  reporting: { name: 'reporting', status: 'idle', task: agentTasks.reporting, output: '' },
});

const starterClients: Client[] = [
  { id: 'northstar', name: 'Northstar Logistics', industry: 'Transportation', contactName: 'Mara Santos', email: 'mara@northstar.example', phone: '+1 415 555 0142', data: JSON.stringify({ gross_monthly_income: 185000, total_monthly_debt_payments: 31000, total_available_credit: 220000, total_outstanding_credit: 64000, total_monthly_expenses: 101000, fico_score: 742 }), documents: [textDoc('northstar-financials.csv', 'gross_monthly_income,total_monthly_debt_payments,total_available_credit,total_outstanding_credit,total_monthly_expenses,fico_score\n185000,31000,220000,64000,101000,742', 'text/csv')] },
  { id: 'harbor', name: 'Harbor Retail Group', industry: 'Retail', contactName: 'Noah Kim', email: 'finance@harbor.example', phone: '+1 312 555 0188', data: JSON.stringify({ gross_monthly_income: 94000, total_monthly_debt_payments: 21000, total_available_credit: 130000, total_outstanding_credit: 71000, total_monthly_expenses: 56000, fico_score: 681 }), documents: [textDoc('harbor-profile.json', '{"gross_monthly_income":94000,"total_monthly_debt_payments":21000,"total_available_credit":130000,"total_outstanding_credit":71000,"total_monthly_expenses":56000,"fico_score":681}', 'application/json')] },
];

export default function Home() {
  const [clients, setClients] = useState<Client[]>(starterClients);
  const [active, setActive] = useState<Client | null>(null);
  const [confirm, setConfirm] = useState<Client | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [viewingClient, setViewingClient] = useState<Client | null>(null);
  const [busy, setBusy] = useState(false);
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [backroomOpen, setBackroomOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [question, setQuestion] = useState('');
  const [latestReport, setLatestReport] = useState<CreditReport | null>(null);
  const [overview, setOverview] = useState<ClientOverview | null>(null);
  const [workflow, setWorkflow] = useState<Record<AgentName, WorkflowAgent>>(emptyWorkflow);
  const [backroom, setBackroom] = useState<BackroomItem[]>([]);
  const [messages, setMessages] = useState<ChatItem[]>([{ id: 'welcome', role: 'assistant', content: 'Welcome to RFM Credit AI. Select a client profile to inspect its user information and documents, then run an assessment or chat with the Director agent.' }]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'clients' | 'new-client' | 'workspace'>('clients');
  const [tokenStats, setTokenStats] = useState<TokenStats>({ session: 0, run: 0, byAgent: {} });
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const runTokensRef = useRef(0);
  const activeRef = useRef<Client | null>(null);
  const eveCollectRef = useRef<{ parsed?: any; metrics?: any; risk?: any; report?: any }>({});
  const eveFinalizedRef = useRef(false);

  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/clients`)
      .then((response) => response.ok ? response.json() : [])
      .then((records) => {
        if (cancelled || !Array.isArray(records) || records.length === 0) return;
        setClients(records.map(mapPersistedClient));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const openClientProfile = (client: Client) => { setViewingClient(client); setActiveTab('clients'); };

  function prepareClient(client: Client) {
    setActive(client);
    setLatestReport(null);
    setOverview(null);
    setWorkflow(emptyWorkflow());
    setBackroom([]);
  }

  function resetRunTokens() {
    runTokensRef.current = 0;
    setTokenStats(prev => ({ ...prev, run: 0, byAgent: {} }));
  }

  function viewClientDetails(client: Client) {
    prepareClient(client);
    setActiveTab('workspace');
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: `Opened ${client.name}. I'm showing the profile details and attached files without running the agents yet.` }]);
  }

  function runClientOverview(client: Client) {
    prepareClient(client);
    setActiveTab('workspace');
    void runOverview(client);
  }

  function handoffClientToAgents(client: Client) {
    prepareClient(client);
    setActiveTab('workspace');
    void startAssessmentFor(client);
  }

  async function consume(body: Record<string, unknown>) {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`${API_BASE}/api/assessment/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`Backend returned ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) handleEvent(JSON.parse(line));
        if (done) break;
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  // ── Eve integration ──
  // Run an assessment on the Eve agent runtime (proxied at /eve/*) and map its
  // NDJSON lifecycle events into the existing workflow / token / report UI.
  async function consumeEve(client: Client) {
    const controller = new AbortController();
    abortRef.current = controller;
    eveCollectRef.current = {};
    eveFinalizedRef.current = false;
    try {
      await runEveSession(buildAssessmentMessage(client.name, client.data), (event) => handleEveEvent(event, client), controller.signal);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function appendEveStream(agent: AgentName, delta: string) {
    const id = `token-${agent}`;
    setBackroom((items) => {
      const existing = items.find((item) => item.id === id);
      const content = ((existing?.content ?? '') + delta).slice(-4000);
      if (existing) return items.map((item) => item.id === id ? { ...item, content, state: 'streaming' } : item);
      return [...items, { id, type: 'reasoning', agent, content, state: 'streaming' }].slice(-80);
    });
  }

  function finalizeEveRun(client: Client, success: boolean) {
    if (eveFinalizedRef.current) return;
    eveFinalizedRef.current = true;
    const report = assembleEveReport(eveCollectRef.current);
    if (report) {
      setLatestReport(report);
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'report', content: 'Credit assessment complete.', report }]);
    }
    setRunHistory((prev) => [{ id: crypto.randomUUID(), mode: 'assessment' as const, clientName: client.name, timestamp: Date.now(), tokens: runTokensRef.current, success }, ...prev].slice(0, 30));
    abortRef.current?.abort();
  }

  function handleEveEvent(evt: EveEvent, client: Client) {
    const d = (evt.data ?? {}) as any;
    switch (evt.type) {
      case 'session.started': {
        const modelId = d?.runtime?.modelId as string | undefined;
        patchWorkflow('director', { status: 'running', model: modelId, task: 'Orchestrating credit workflow' });
        setBackroom((items) => [...items, { id: crypto.randomUUID(), type: 'session.started', agent: 'director', model: modelId, content: `Eve session started · ${modelId ?? ''}` }].slice(-120));
        break;
      }
      case 'reasoning.appended': {
        if (typeof d.reasoningDelta === 'string') appendEveStream('director', d.reasoningDelta);
        break;
      }
      case 'message.completed': {
        if (typeof d.message === 'string' && d.message.trim()) setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: d.message }]);
        break;
      }
      case 'actions.requested': {
        const actions: any[] = Array.isArray(d.actions) ? d.actions : [];
        for (const a of actions) {
          if (a.kind === 'subagent-call' && isAgent(String(a.subagentName))) {
            patchWorkflow(a.subagentName as AgentName, { status: 'running', task: a.description ?? agentTasks[a.subagentName as AgentName] });
            setBackroom((items) => [...items, { id: crypto.randomUUID(), type: 'dispatch', agent: 'director', target: a.subagentName, content: `Delegating to ${a.subagentName}` }].slice(-120));
          } else if (a.kind === 'tool-call') {
            setBackroom((items) => [...items, { id: crypto.randomUUID(), type: 'tool-call', agent: 'director', content: `tool: ${a.toolName ?? 'unknown'}` }].slice(-120));
          }
        }
        break;
      }
      case 'action.result': {
        const r = d.result as any;
        if (!r) break;
        if (r.kind === 'subagent-result' && isAgent(String(r.subagentName))) {
          patchWorkflow(r.subagentName as AgentName, { status: 'complete', output: summarizeEveOutput(r.output) });
          collectEve(r.subagentName as AgentName, r.output);
          setBackroom((items) => [...items, { id: crypto.randomUUID(), type: 'subagent-result', agent: r.subagentName, content: summarizeEveOutput(r.output) }].slice(-120));
        } else if (r.kind === 'tool-result') {
          if (looksLikeReport(r.output)) eveCollectRef.current.report = r.output;
          setBackroom((items) => [...items, { id: crypto.randomUUID(), type: 'tool-result', agent: 'director', content: summarizeEveOutput(r.output) }].slice(-120));
        }
        break;
      }
      case 'step.completed': {
        const out = Number((d.usage as any)?.outputTokens ?? 0);
        if (out > 0) {
          runTokensRef.current += out;
          setTokenStats((prev) => ({ session: prev.session + out, run: prev.run + out, byAgent: { ...prev.byAgent, director: (prev.byAgent.director ?? 0) + out } }));
        }
        break;
      }
      case 'turn.completed':
      case 'session.completed': {
        patchWorkflow('director', { status: 'complete' });
        finalizeEveRun(client, true);
        break;
      }
      case 'step.failed':
      case 'turn.failed':
      case 'session.failed': {
        const msg = (d.message as string) ?? 'Eve run failed';
        setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: `Eve error: ${msg}` }]);
        patchWorkflow('director', { status: 'error' });
        finalizeEveRun(client, false);
        break;
      }
    }
  }

  function collectEve(agent: AgentName, output: any) {
    if (agent === 'ingest') eveCollectRef.current.parsed = output;
    else if (agent === 'analytics') eveCollectRef.current.metrics = output;
    else if (agent === 'risk') eveCollectRef.current.risk = output;
    else if (agent === 'reporting') eveCollectRef.current.report = output;
  }

  function stop() {
    if (!abortRef.current) return;
    abortRef.current.abort();
    abortRef.current = null;
    setBusy(false);
    setOverviewBusy(false);
    const client = activeRef.current;
    if (client && runTokensRef.current > 0) {
      setRunHistory(prev => [{
        id: crypto.randomUUID(),
        mode: 'stopped' as const,
        clientName: client.name,
        timestamp: Date.now(),
        tokens: runTokensRef.current,
        success: false,
      }, ...prev].slice(0, 30));
    }
    setWorkflow((current) => {
      const next = { ...current };
      for (const key of Object.keys(next) as AgentName[]) {
        if (['queued', 'running', 'streaming'].includes(next[key].status)) next[key] = { ...next[key], status: 'stopped' };
      }
      return next;
    });
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: '_Conversation stopped._' }]);
  }

  function handleEvent(event: { type: string; message?: string; content?: string; result?: PipelineResult; overview?: ClientOverview; agent?: string; target?: string; model?: string; durationMs?: number }) {
    const agent = event.agent ?? 'director';
    const knownAgent = isAgent(agent) ? agent : 'director';
    recordBackroomEvent(event, knownAgent);

    // Token tracking — estimate tokens from character length of streaming chunks
    if (event.type === 'token' && event.content) {
      const estimated = Math.max(1, Math.ceil(event.content.length / 3.5));
      runTokensRef.current += estimated;
      setTokenStats(prev => ({
        session: prev.session + estimated,
        run: prev.run + estimated,
        byAgent: { ...prev.byAgent, [knownAgent]: (prev.byAgent[knownAgent] ?? 0) + estimated },
      }));
    }

    if (event.type === 'orchestration_start') patchWorkflow('director', { status: 'running', task: event.message ?? agentTasks.director });
    if (event.type === 'dispatch') {
      if (isAgent(String(event.target))) patchWorkflow(event.target as AgentName, { status: 'queued', task: event.content ?? agentTasks[event.target as AgentName] });
    }
    if (event.type === 'agent_start') patchWorkflow(knownAgent, { status: 'running', model: event.model });
    if (event.type === 'model_start') patchWorkflow(knownAgent, { status: 'streaming', model: event.model });
    if (event.type === 'handoff' && isAgent(String(event.target))) patchWorkflow(event.target as AgentName, { status: 'queued', task: event.content ?? agentTasks[event.target as AgentName] });
    if (event.type === 'fallback') patchWorkflow(knownAgent, { status: 'fallback', output: event.content ?? 'Using deterministic fallback.' });
    if (event.type === 'agent_output') patchWorkflow(knownAgent, { output: event.content ?? '' });
    if (event.type === 'agent_complete') patchWorkflow(knownAgent, { status: 'complete', durationMs: event.durationMs });
    if (event.type === 'aborted') patchWorkflow(knownAgent, { status: 'stopped' });
    if (event.type === 'message') setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: event.content ?? '' }]);
    if (event.type === 'message_complete') setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: event.content ?? '' }]);
    if (event.type === 'error') setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: `OpenCode error: ${event.message}` }]);
    if (event.type === 'overview_result' && event.overview) {
      setOverview(event.overview);
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: `Client overview ready for ${event.overview?.client?.name ?? 'this client'}. I scanned the profile, reviewed attached documents, and prepared a snapshot in the workflow panel.` }]);
      const client = activeRef.current;
      if (client) {
        const tokens = runTokensRef.current;
        setRunHistory(prev => [{ id: crypto.randomUUID(), mode: 'overview' as const, clientName: client.name, timestamp: Date.now(), tokens, success: true }, ...prev].slice(0, 30));
      }
    }
    if (event.type === 'result') {
      if (event.result?.success && event.result.report) {
        setLatestReport(event.result.report);
        setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'report', content: 'Credit assessment complete.', report: event.result?.report }]);
      } else {
        setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: event.result?.error ?? 'Assessment failed.' }]);
      }
      const client = activeRef.current;
      if (client) {
        const tokens = runTokensRef.current;
        setRunHistory(prev => [{ id: crypto.randomUUID(), mode: 'assessment' as const, clientName: client.name, timestamp: Date.now(), tokens, success: Boolean(event.result?.success) }, ...prev].slice(0, 30));
      }
    }
  }

  function patchWorkflow(agent: AgentName, patch: Partial<WorkflowAgent>) {
    setWorkflow((current) => ({ ...current, [agent]: { ...current[agent], ...patch } }));
  }

  function recordBackroomEvent(event: { type: string; message?: string; content?: string; agent?: string; target?: string; model?: string; durationMs?: number }, fallbackAgent: AgentName) {
    const agent = event.agent ?? fallbackAgent;
    if (event.type === 'token') {
      if (!event.content) return;
      const id = `token-${agent}`;
      setBackroom((items) => {
        const existing = items.find((item) => item.id === id);
        const content = ((existing?.content ?? '') + event.content).slice(-4000);
        if (existing) return items.map((item) => item.id === id ? { ...item, content, state: 'streaming' } : item);
        return [...items, { id, type: 'token stream', agent, content, state: 'streaming' }].slice(-80);
      });
      return;
    }
    const content = event.content ?? event.message ?? (event.type === 'agent_complete' ? `Completed in ${event.durationMs ?? 0} ms` : event.model ?? '');
    if (!content && !['agent_start', 'model_start', 'dispatch', 'handoff'].includes(event.type)) return;
    setBackroom((items) => [...items, { id: crypto.randomUUID(), type: event.type, agent, target: event.target, model: event.model, content, state: event.type }].slice(-120));
  }

  async function runOverview(client: Client) {
    resetRunTokens();
    setOverviewBusy(true);
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'user', content: `Open ${client.name} and run the client overview.` }]);
    try { await consume({ mode: 'overview', clientId: client.id, client: clientProfile(client), data: client.data, documents: client.documents }); }
    catch (error) { if (!isAbortError(error)) handleEvent({ type: 'error', message: error instanceof Error ? error.message : 'Connection failed' }); }
    finally { setOverviewBusy(false); }
  }

  async function startAssessment() {
    const client = confirm ?? active;
    if (!client) return;
    await startAssessmentFor(client);
  }

  async function startAssessmentFor(client: Client) {
    resetRunTokens();
    setConfirm(null); setBusy(true); setWorkflow(emptyWorkflow()); setBackroom([]);
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'user', content: `Run a full credit assessment for ${client.name} (via Eve agents).` }]);
    try { await consumeEve(client); }
    catch (error) { if (!isAbortError(error)) setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: `Eve connection failed: ${error instanceof Error ? error.message : 'unknown'}. Is the Eve dev server running on :2000?` }]); }
    finally { setBusy(false); }
  }

  async function ask(event: FormEvent) {
    event.preventDefault(); if (!question.trim() || busy) return;
    const text = question.trim(); setQuestion(''); setBusy(true);
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'user', content: text }]);
    try { await consume({ mode: 'chat', message: text, ...(latestReport ? { report: latestReport } : {}), ...(active ? { client: clientProfile(active), data: active.data, documents: active.documents.map(documentSummary) } : {}) }); }
    catch (error) { if (!isAbortError(error)) handleEvent({ type: 'error', message: error instanceof Error ? error.message : 'Connection failed' }); }
    finally { setBusy(false); }
  }

  const assessmentCount = runHistory.filter(r => r.mode === 'assessment').length;
  const successCount = runHistory.filter(r => r.success).length;

  return <main className="workspace-shell">
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark"><Brain size={20}/></span>
        <div><strong>RFM Credit AI</strong><small>Agent control</small></div>
      </div>
      <AgentRail workflow={workflow} active={Boolean(active)} clientName={active?.name}/>
      <div className="provider-pill"><i/> OpenCode connected</div>
    </aside>

    <section className="conversation">
      <header className="topbar">
        <div className="topbar-row">
          <div>
            <small>CONVERSATIONAL WORKSPACE</small>
            <h1>{active?.name ?? 'Credit Intelligence'}</h1>
          </div>
          <div className="top-actions">
            {tokenStats.session > 0 && (
              <div className="token-pill"><Zap size={12}/> {fmtTokens(tokenStats.session)} tokens</div>
            )}
            {activeTab === 'workspace' && (
              <button className={`backroom-toggle ${backroomOpen ? 'active' : ''}`} onClick={() => setBackroomOpen((open) => !open)}>
                <MessagesSquare size={14}/> Background activity
              </button>
            )}
            {activeTab === 'workspace' && (
              <button className={`backroom-toggle ${panelOpen ? 'active' : ''}`} onClick={() => setPanelOpen((open) => !open)}>
                <PanelRight size={14}/> Agents
              </button>
            )}
            <div className="model-badge"><Sparkles size={14}/> OpenCode API</div>
          </div>
        </div>
        <nav className="tab-nav">
          <button className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
            <LayoutDashboard size={13}/> Dashboard
          </button>
          <button className={`tab-btn ${activeTab === 'clients' ? 'active' : ''}`} onClick={() => { setActiveTab('clients'); }}>
            <Users size={13}/> Client Profiles
          </button>
          <button className={`tab-btn ${activeTab === 'new-client' ? 'active' : ''}`} onClick={() => setActiveTab('new-client')}>
            <UserPlus size={13}/> New Client
          </button>
          <button className={`tab-btn ${activeTab === 'workspace' ? 'active' : ''}`} onClick={() => setActiveTab('workspace')}>
            <Brain size={13}/> Workspace
          </button>
        </nav>
      </header>

      {/* ── Dashboard Tab ── */}
      {activeTab === 'dashboard' && (
        <DashboardView
          clients={clients}
          assessmentCount={assessmentCount}
          successCount={successCount}
          tokenStats={tokenStats}
          runHistory={runHistory}
          onSelectClient={openClientProfile}
        />
      )}

      {/* ── Client Profiles Tab ── */}
      {activeTab === 'clients' && (
        <ClientsView
          clients={clients}
          search={clientSearch}
          setSearch={setClientSearch}
          viewing={viewingClient}
          setViewing={setViewingClient}
          activeId={active?.id}
          onOverview={runClientOverview}
          onHandoff={handoffClientToAgents}
          onOpen={viewClientDetails}
          onNew={() => setActiveTab('new-client')}
        />
      )}

      {/* ── New Client Tab ── */}
      {activeTab === 'new-client' && (
        <NewClientForm
          onCancel={() => setActiveTab('clients')}
          onCreate={async (client) => {
            const saved = await saveClient(client);
            const finalClient = saved ?? client;
            setClients((all) => [finalClient, ...all.filter((item) => item.id !== finalClient.id)]);
            setViewingClient(finalClient);
            setActiveTab('clients');
          }}
        />
      )}

      {/* ── Workspace Tab ── */}
      {activeTab === 'workspace' && (
        <div className={`workspace-layout ${panelOpen && active ? 'with-panel' : ''}`}>
          <div className="conversation-main">
            <div className="chat-feed">
              {messages.map((item) => (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} key={item.id} className={`message ${item.role}`}>
                  {item.role === 'assistant' && <span className="avatar"><Brain size={16}/></span>}
                  {item.role === 'trace' ? (
                    <div className={`trace-line ${item.state}`}>
                      <span className="trace-node">{item.state === 'running' ? <LoaderCircle size={13} className="spin"/> : item.state === 'complete' ? '✓' : '→'}</span>
                      <div><strong>{title(item.agent ?? 'director')}</strong><span>{item.content}</span>{item.meta && <small>{item.meta}</small>}</div>
                    </div>
                  ) : item.role === 'stream' ? (
                    <div className={`agent-stream ${item.state}`}>
                      <header><span><Sparkles size={13}/>{title(item.agent ?? 'agent')} live output</span><i>{item.state === 'streaming' ? 'STREAMING' : 'COMPLETE'}</i></header>
                      <pre>{item.content}</pre>
                    </div>
                  ) : item.role === 'report' && item.report ? (
                    <div className="report-wrap">
                      <div className="report-title"><Sparkles size={16}/> Assessment complete</div>
                      <CreditReportView report={item.report}/>
                    </div>
                  ) : (
                    <div className="bubble">{item.role === 'assistant' ? <Markdown>{item.content}</Markdown> : item.content}</div>
                  )}
                </motion.div>
              ))}
              {backroomOpen && <InlineBackroom items={backroom}/>}
              {busy && <div className="thinking"><span/><span/><span/></div>}
            </div>
            <form className="composer" onSubmit={ask}>
              <input value={question} onChange={(e) => setQuestion(e.target.value)} disabled={busy || overviewBusy} placeholder={latestReport ? 'Ask about cash flow, risk factors, or payment terms…' : 'Chat with the RFM Director agent…'}/>
              {busy || overviewBusy
                ? <button type="button" className="stop" onClick={stop} aria-label="Stop conversation"><Square size={15}/></button>
                : <button disabled={!question.trim()} aria-label="Send message"><Send size={18}/></button>
              }
            </form>
          </div>

          {panelOpen && active && (
            <aside className="side-panel">
              <ClientProfilePanel client={active} overview={overview} busy={overviewBusy} onAssess={startAssessment}/>
              <WorkflowBoard workflow={workflow}/>
            </aside>
          )}
        </div>
      )}
    </section>
  </main>;
}

/* ══════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════ */
function DashboardView({ clients, assessmentCount, successCount, tokenStats, runHistory, onSelectClient }: {
  clients: Client[];
  assessmentCount: number;
  successCount: number;
  tokenStats: TokenStats;
  runHistory: RunRecord[];
  onSelectClient: (client: Client) => void;
}) {
  const totalRuns = runHistory.length;
  const maxAgentTokens = Math.max(1, ...Object.values(tokenStats.byAgent));

  return (
    <div className="dashboard">
      <p className="dashboard-title"><LayoutDashboard size={16}/> Overview</p>

      {/* Stat cards */}
      <div className="stat-grid">
        <div className="stat-card red">
          <div className="stat-icon red"><Building2 size={18}/></div>
          <div>
            <div className="stat-label red">Clients</div>
            <div className="stat-value red">{clients.length}</div>
            <div className="stat-sub red">loaded profiles</div>
          </div>
        </div>
        <div className="stat-card red">
          <div className="stat-icon red"><ClipboardCheck size={18}/></div>
          <div>
            <div className="stat-label red">Assessments</div>
            <div className="stat-value red">{assessmentCount}</div>
            <div className="stat-sub red">{successCount} successful</div>
          </div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon blue"><Zap size={18}/></div>
          <div>
            <div className="stat-label blue">Session Tokens</div>
            <div className="stat-value blue">{fmtTokens(tokenStats.session)}</div>
            <div className="stat-sub blue">~{fmtTokens(tokenStats.run)} this run</div>
          </div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon blue"><Activity size={18}/></div>
          <div>
            <div className="stat-label blue">Total Runs</div>
            <div className="stat-value blue">{totalRuns}</div>
            <div className="stat-sub blue">assessments + overviews</div>
          </div>
        </div>
      </div>

      <div className="dash-body">
        {/* Client profiles */}
        <div className="dash-section red">
          <div className="dash-section-head red">
            <strong><Building2 size={13}/> Client Profiles</strong>
            <span>{clients.length} total</span>
          </div>
          <div className="run-list">
            {clients.map((client) => (
              <button
                key={client.id}
                className="run-item"
                style={{ cursor: 'pointer', width: '100%', textAlign: 'left', border: '1px solid rgba(100,50,50,.22)', background: 'rgba(15,8,8,.6)', borderRadius: 10, padding: 10, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}
                onClick={() => onSelectClient(client)}
              >
                <span className="run-dot success"/>
                <div className="run-info">
                  <strong>{client.name}</strong>
                  <small>{client.industry} · {client.contactName ?? 'No contact'} · {client.documents.length} file{client.documents.length !== 1 ? 's' : ''}</small>
                </div>
                <div className="run-meta">
                  <div className="run-tokens">{client.email ? '✉' : '—'}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Run history */}
        <div className="dash-section red">
          <div className="dash-section-head red">
            <strong><BarChart2 size={13}/> Run History</strong>
            <span>{runHistory.length} runs</span>
          </div>
          {runHistory.length === 0
            ? <p className="run-empty">No runs yet. Select a client and run an assessment or overview.</p>
            : <div className="run-list">
                {runHistory.map((run) => (
                  <div key={run.id} className="run-item">
                    <span className={`run-dot ${run.mode === 'stopped' ? 'stopped' : run.success ? 'success' : 'failed'}`}/>
                    <div className="run-info">
                      <strong>{run.clientName}</strong>
                      <small>{new Date(run.timestamp).toLocaleTimeString()} · {run.mode}</small>
                    </div>
                    <div className="run-meta">
                      <div className="run-mode">{run.mode}</div>
                      <div className="run-tokens">{fmtTokens(run.tokens)} tok</div>
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>

        {/* Token usage by agent */}
        <div className="dash-section blue" style={{ gridColumn: '1 / -1' }}>
          <div className="dash-section-head blue">
            <strong><Zap size={13}/> Token Usage — Current Run</strong>
            <span>{fmtTokens(tokenStats.run)} tokens generated</span>
          </div>
          {tokenStats.run === 0
            ? <p className="token-empty">No token data yet. Tokens are counted as agents stream their output.</p>
            : <div className="token-body">
                <div className="token-total-row">
                  <strong>{fmtTokens(tokenStats.session)}</strong>
                  <span>total session tokens</span>
                </div>
                <div className="token-run-row">
                  <strong>{fmtTokens(tokenStats.run)}</strong>
                  <span>this run</span>
                </div>
                <div className="token-agents-title">By agent</div>
                <div className="token-agents">
                  {Object.entries(tokenStats.byAgent)
                    .sort(([, a], [, b]) => b - a)
                    .map(([agent, count]) => (
                      <div key={agent} className="token-agent-row">
                        <div className="token-agent-label">
                          <span>{title(agent)}</span>
                          <strong>{fmtTokens(count)}</strong>
                        </div>
                        <div className="token-bar">
                          <div className="token-bar-fill" style={{ width: `${Math.round((count / maxAgentTokens) * 100)}%` }}/>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
          }
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   AGENT RAIL (left sidebar — agents only)
══════════════════════════════════════════════ */
const agentMeta: Record<AgentName, { icon: typeof Brain; label: string }> = {
  director: { icon: Brain, label: 'Director' },
  ingest: { icon: Database, label: 'Ingest' },
  analytics: { icon: BarChart2, label: 'Analytics' },
  risk: { icon: Activity, label: 'Risk' },
  reporting: { icon: FileText, label: 'Reporting' },
};

function AgentRail({ workflow, active, clientName }: { workflow: Record<AgentName, WorkflowAgent>; active: boolean; clientName?: string }) {
  return <>
    <div className="sidebar-label">AGENTS <span>5</span></div>
    <div className="agent-rail">
      {(Object.keys(agentMeta) as AgentName[]).map((agent) => {
        const item = workflow[agent];
        const Icon = agentMeta[agent].icon;
        return <div className={`agent-rail-item ${item.status}`} key={agent}>
          <span className="agent-rail-icon">
            {item.status === 'complete' ? <CheckCircle2 size={16}/> : item.status === 'running' || item.status === 'streaming' ? <LoaderCircle size={16} className="spin"/> : <Icon size={16}/>}
          </span>
          <div className="agent-rail-text">
            <strong>{agentMeta[agent].label}</strong>
            <small>{item.task}</small>
          </div>
          <i className={`agent-status-dot ${item.status}`} title={item.status}/>
        </div>;
      })}
    </div>
    <div className="agent-rail-foot">
      {active ? <><Building2 size={13}/> Working on <strong>{clientName}</strong></> : <><Building2 size={13}/> No client handed off yet</>}
    </div>
  </>;
}

/* ══════════════════════════════════════════════
   CLIENT PROFILES TAB (searchable, full detail)
══════════════════════════════════════════════ */
function ClientsView({ clients, search, setSearch, viewing, setViewing, activeId, onOverview, onHandoff, onOpen, onNew }: {
  clients: Client[];
  search: string;
  setSearch: (value: string) => void;
  viewing: Client | null;
  setViewing: (client: Client | null) => void;
  activeId?: string;
  onOverview: (client: Client) => void;
  onHandoff: (client: Client) => void;
  onOpen: (client: Client) => void;
  onNew: () => void;
}) {
  const query = search.trim().toLowerCase();
  const filtered = query
    ? clients.filter((c) => [c.name, c.industry, c.contactName, c.email, c.phone].filter(Boolean).some((field) => String(field).toLowerCase().includes(query)))
    : clients;

  // Keep the detail view in sync with the latest record from the list.
  const current = viewing ? clients.find((c) => c.id === viewing.id) ?? viewing : null;

  return (
    <div className="clients-view">
      <div className="clients-toolbar">
        <div className="client-search">
          <Search size={15}/>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, industry, contact, email, or phone…"/>
          {search && <button className="search-clear" onClick={() => setSearch('')} aria-label="Clear search"><X size={14}/></button>}
        </div>
        <button className="clients-new-btn" onClick={onNew}><UserPlus size={15}/> New client</button>
      </div>

      {current ? (
        <ClientDetail client={current} activeId={activeId} onBack={() => setViewing(null)} onOverview={onOverview} onHandoff={onHandoff} onOpen={onOpen}/>
      ) : filtered.length === 0 ? (
        <div className="clients-empty">
          <Users size={30}/>
          <strong>{query ? 'No clients match your search' : 'No client profiles yet'}</strong>
          <p>{query ? 'Try a different name, industry, or contact.' : 'Create your first client profile to get started.'}</p>
          {!query && <button className="clients-new-btn" onClick={onNew}><UserPlus size={15}/> Create a client</button>}
        </div>
      ) : (
        <div className="client-grid">
          {filtered.map((client) => {
            const financials = parseFinancials(client.data);
            return (
              <button key={client.id} className={`client-card ${activeId === client.id ? 'active' : ''}`} onClick={() => setViewing(client)}>
                <div className="client-card-top">
                  <span className="client-card-avatar"><Building2 size={18}/></span>
                  <div className="client-card-id">
                    <strong>{client.name}</strong>
                    <small>{client.industry}</small>
                  </div>
                  {activeId === client.id && <em className="client-card-tag">Active</em>}
                </div>
                <div className="client-card-meta">
                  {client.contactName && <span><User size={12}/> {client.contactName}</span>}
                  {client.email && <span><Mail size={12}/> {client.email}</span>}
                  {client.phone && <span><Phone size={12}/> {client.phone}</span>}
                  <span><FileText size={12}/> {client.documents.length} file{client.documents.length !== 1 ? 's' : ''}</span>
                </div>
                {financials.length > 0 && (
                  <div className="client-card-stats">
                    {financials.slice(0, 3).map(([key, value]) => (
                      <div key={key}><small>{prettyKey(key)}</small><strong>{value}</strong></div>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ClientDetail({ client, activeId, onBack, onOverview, onHandoff, onOpen }: {
  client: Client;
  activeId?: string;
  onBack: () => void;
  onOverview: (client: Client) => void;
  onHandoff: (client: Client) => void;
  onOpen: (client: Client) => void;
}) {
  const financials = parseFinancials(client.data);
  return (
    <div className="client-detail">
      <button className="detail-back" onClick={onBack}><X size={14}/> Back to list</button>
      <div className="detail-head">
        <span className="detail-avatar"><Building2 size={24}/></span>
        <div>
          <h2>{client.name}{activeId === client.id && <em className="client-card-tag">Active</em>}</h2>
          <p>{client.industry}</p>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-block">
          <small>CONTACT</small>
          <div className="detail-row"><User size={14}/><span>{client.contactName || 'No contact name'}</span></div>
          <div className="detail-row"><Mail size={14}/><span>{client.email || 'No email'}</span></div>
          <div className="detail-row"><Phone size={14}/><span>{client.phone || 'No phone'}</span></div>
        </div>

        <div className="detail-block">
          <small>FINANCIAL PROFILE</small>
          {financials.length > 0 ? (
            <div className="detail-financials">
              {financials.map(([key, value]) => (
                <div key={key} className="detail-fin-row"><span>{prettyKey(key)}</span><strong>{value}</strong></div>
              ))}
            </div>
          ) : <p className="detail-muted">No structured financial data on file.</p>}
        </div>
      </div>

      <div className="detail-block">
        <small>DOCUMENTS ({client.documents.length})</small>
        {client.documents.length ? (
          <div className="detail-docs">
            {client.documents.map((doc) => (
              <a className="doc-chip" key={doc.id} href={`${API_BASE}/api/clients/documents/${doc.id}/download`} target="_blank">
                <FileText size={14}/><span>{doc.name}</span><i>{formatBytes(doc.size)}</i>
              </a>
            ))}
          </div>
        ) : <p className="detail-muted">No files attached to this profile.</p>}
      </div>

      <div className="detail-actions">
        <span className="detail-actions-label">Hand off to the agents:</span>
        <button className="action-secondary" onClick={() => onOpen(client)}><Eye size={15}/> Open in workspace</button>
        <button className="action-secondary" onClick={() => onOverview(client)}><Sparkles size={15}/> Run overview</button>
        <button className="action-primary" onClick={() => onHandoff(client)}><GitBranch size={15}/> Full assessment</button>
      </div>
    </div>
  );
}

function ClientProfilePanel({ client, overview, busy, onAssess }: { client: Client; overview: ClientOverview | null; busy: boolean; onAssess: () => void }) {
  return <section className="profile-panel">
    <div className="panel-heading"><User size={13}/> Client profile</div>
    <div className="profile-card"><span><User size={15}/></span><div><small>CLIENT INFO</small><strong>{client.contactName || 'No contact name yet'}</strong><p>{client.email || 'No email'} · {client.phone || 'No phone'}</p></div></div>
    <div className="profile-card"><span><Database size={15}/></span><div><small>PROFILE DATA</small><strong>{client.industry}</strong><p>{client.data ? 'Financial profile data is attached for agent ingestion.' : 'No profile data.'}</p></div></div>
    <div className="documents-card"><small>CLIENT FILES</small><div>{client.documents.length ? client.documents.map((doc) => <a className="doc-chip" key={doc.id} href={`${API_BASE}/api/clients/documents/${doc.id}/download`} target="_blank"><FileText size={14}/><span>{doc.name}</span><i>{formatBytes(doc.size)}</i></a>) : <p>No files attached yet.</p>}</div></div>
    <div className="overview-card"><small>{busy ? 'OVERVIEW RUNNING' : 'CLIENT OVERVIEW'}</small>{overview ? <><div className="overview-grid">{overview.highlights.map((item) => <span key={item}>{item}</span>)}</div><ul>{overview.snapshot.map((item) => <li key={item}>{item}</li>)}</ul></> : <p>{busy ? 'Director is dispatching agents to scan the profile.' : 'Select this profile to generate an overview.'}</p>}<button onClick={onAssess}>Run full assessment</button></div>
  </section>;
}

function WorkflowBoard({ workflow }: { workflow: Record<AgentName, WorkflowAgent> }) {
  return <section className="workflow-board">
    <div className="panel-heading"><Layers size={13}/> Agent workflow</div>
    {(Object.keys(workflow) as AgentName[]).map((agent) => {
      const item = workflow[agent];
      return <div className={`workflow-agent ${item.status}`} key={agent}>
        <div className="agent-top"><span>{item.status === 'complete' ? <CheckCircle2 size={15}/> : item.status === 'running' || item.status === 'streaming' ? <LoaderCircle className="spin" size={15}/> : <Activity size={15}/>}</span><div><strong>{title(agent)}</strong><small>{item.model || item.status}</small></div></div>
        <p>{item.task}</p>
        {item.output && <blockquote><Markdown>{item.output}</Markdown></blockquote>}
        {item.durationMs !== undefined && <em>{item.durationMs} ms</em>}
      </div>;
    })}
  </section>;
}

// Background agent activity rendered inline in the conversation as transparent
// trace bubbles — toggled on/off, the way typical AI chats surface tool activity.
function InlineBackroom({ items }: { items: BackroomItem[] }) {
  return <div className="inline-backroom">
    <div className="inline-backroom-head"><MessagesSquare size={13}/> Background activity<span>{items.length ? `${items.length} events` : 'waiting'}</span></div>
    {items.length ? items.slice(-24).map((item) => <div className={`inline-event ${item.type.replace(/_/g, '-')}`} key={item.id}>
      <div className="inline-event-meta"><strong>{title(item.agent)}</strong><small>{item.type}{item.target ? ` → ${item.target}` : ''}{item.model ? ` · ${item.model}` : ''}</small></div>
      {(item.content || item.type === 'token stream') && <p>{item.content || 'Working…'}</p>}
    </div>) : <p className="inline-empty">No agent traffic yet. Choose a client action or ask the Director something.</p>}
  </div>;
}

/* ══════════════════════════════════════════════
   NEW CLIENT TAB (creation form)
══════════════════════════════════════════════ */
function NewClientForm({ onCancel, onCreate }: { onCancel: () => void; onCreate: (client: Client) => void }) {
  const [name, setName] = useState(''); const [industry, setIndustry] = useState(''); const [contactName, setContactName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [data, setData] = useState(''); const [documents, setDocuments] = useState<ClientDocument[]>([]);
  const valid = useMemo(() => name.trim() && (data.trim() || documents.length), [name, data, documents]);
  async function readFiles(files?: FileList | null) { if (!files) return; const parsed = await Promise.all(Array.from(files).map(readDocument)); setDocuments((current) => [...current, ...parsed]); }
  return (
    <div className="new-client-view">
      <div className="form-card">
        <small>NEW PROFILE</small>
        <h2>Create a client profile</h2>
        <p>Provide user information plus supporting files. The backend will extract text and tables from PDF, Excel, CSV, JSON, TXT, and DOCX files for the agents.</p>
        <div className="form-grid">
          <label>Client name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Trading Corp."/></label>
          <label>Industry<input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Wholesale"/></label>
          <label>Contact person<input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Jane Lee"/></label>
          <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="finance@acme.com"/></label>
          <label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0123"/></label>
        </div>
        <label className="upload-zone"><Upload/><strong>{documents.length ? `${documents.length} document(s) attached` : 'Upload client documents'}</strong><span>PDF, Excel, CSV, JSON, TXT, DOCX</span><input multiple type="file" accept=".csv,.json,.txt,.xlsx,.xls,.pdf,.docx" onChange={(e) => readFiles(e.target.files)}/></label>
        {documents.length > 0 && <div className="drawer-docs">{documents.map((doc) => <button key={doc.id} type="button" onClick={() => setDocuments((all) => all.filter((item) => item.id !== doc.id))}><FileText size={14}/><span>{doc.name}</span><i>remove</i></button>)}</div>}
        <label>Optional pasted financial data<textarea value={data} onChange={(e) => setData(e.target.value)} rows={7} placeholder='{"gross_monthly_income": 120000, ...}'/></label>
        <div className="form-actions">
          <button className="action-secondary" type="button" onClick={onCancel}>Cancel</button>
          <button className="create-button" disabled={!valid} onClick={() => onCreate({ id: crypto.randomUUID(), name: name.trim(), industry: industry.trim() || 'Uncategorized', contactName, email, phone, data, documents })}>Create profile</button>
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ── */
function isAbortError(error: unknown): boolean { return error instanceof DOMException ? error.name === 'AbortError' : error instanceof Error && error.name === 'AbortError'; }
function title(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
function isAgent(value: string): value is AgentName { return ['director', 'ingest', 'analytics', 'risk', 'reporting'].includes(value); }
function clientProfile(client: Client) { return { id: client.id, name: client.name, industry: client.industry, contactName: client.contactName, email: client.email, phone: client.phone }; }
function documentSummary(doc: ClientDocument) { return { id: doc.id, name: doc.name, type: doc.type, size: doc.size }; }
function fmtTokens(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

function summarizeEveOutput(output: unknown): string {
  if (output == null) return '';
  try { const s = typeof output === 'string' ? output : JSON.stringify(output); return s.length > 600 ? `${s.slice(0, 600)}…` : s; } catch { return String(output); }
}

function looksLikeReport(o: any): boolean {
  return !!o && typeof o === 'object' && (o.risk_assessment?.tier || o.calculated_metrics || (o.tier && o.repayment_days !== undefined));
}

// Tolerant assembler — Eve's model shapes intermediate outputs ad-hoc, so read
// multiple possible field names and build the CreditReport the UI expects.
function assembleEveReport(c: { parsed?: any; metrics?: any; risk?: any; report?: any }): CreditReport | null {
  const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const pct = (v: any) => typeof v === 'number' ? `${v.toFixed(1)}%` : (v != null ? String(v) : '—');
  const rep = c.report;
  if (rep && typeof rep === 'object' && rep.risk_assessment && rep.calculated_metrics) return rep as CreditReport;
  if (!c.metrics && !c.risk && !rep) return null;
  const income = c.parsed?.income ?? c.parsed ?? {};
  const m = c.metrics ?? rep?.calculated_metrics ?? {};
  const rk = c.risk ?? rep?.risk_assessment ?? {};
  return {
    customer_summary: {
      gross_monthly_income: num(income.gross_monthly_income),
      total_monthly_debt_payments: num(income.total_monthly_debt_payments),
      total_available_credit: num(income.total_available_credit),
      total_outstanding_credit: num(income.total_outstanding_credit),
      total_monthly_expenses: num(income.total_monthly_expenses),
    },
    calculated_metrics: {
      dti: pct(m.dti),
      utilization: pct(m.utilization ?? m.credit_utilization),
      cash_flow_margin: pct(m.cash_flow_margin ?? m.cashFlowMargin),
      fico_score: num(m.fico_score ?? m.ficoScore),
    },
    risk_assessment: {
      tier: String(rk.tier ?? '—'),
      repayment_days: num(rk.repayment_days ?? rk.repaymentDays),
      flag_for_manual_review: Boolean(rk.flag_for_manual_review ?? rk.flagForManualReview),
      reasons: Array.isArray(rk.reasons) ? rk.reasons : [],
    },
    report_metadata: { generated_at: new Date().toISOString(), pipeline_version: 'eve', models_used: {} },
  };
}
function prettyKey(key: string): string { return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
function parseFinancials(data: string): [string, string][] {
  try {
    const obj = JSON.parse(data || '{}');
    if (!obj || typeof obj !== 'object') return [];
    return Object.entries(obj).map(([key, value]) => [key, typeof value === 'number' ? value.toLocaleString() : String(value)] as [string, string]);
  } catch { return []; }
}

async function saveClient(client: Client): Promise<Client | null> {
  try {
    const response = await fetch(`${API_BASE}/api/clients`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(client) });
    if (!response.ok) return null;
    const saved = await response.json();
    return saved ? mapPersistedClient(saved) : null;
  } catch { return null; }
}

function mapPersistedClient(record: any): Client {
  return {
    id: record.id, name: record.name, industry: record.industry || 'Uncategorized',
    contactName: record.contactName, email: record.email, phone: record.phone,
    data: JSON.stringify(record.profileData ?? {}),
    documents: Array.isArray(record.documents) ? record.documents.map((document: any) => ({
      id: document.id, name: document.name,
      type: document.mimeType || document.type || 'application/octet-stream',
      size: Number(document.size || 0),
      content: document.contentBase64 || document.content || '',
      encoding: 'base64' as const,
    })) : [],
  };
}

function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`; return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function textDoc(name: string, text: string, type: string): ClientDocument { return { id: cryptoSafeId(), name, type, size: text.length, content: toBase64(text), encoding: 'base64' }; }
function cryptoSafeId() { return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
function toBase64(text: string) { return typeof btoa !== 'undefined' ? btoa(text) : Buffer.from(text, 'utf-8').toString('base64'); }

async function readDocument(file: File): Promise<ClientDocument> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
  return { id: crypto.randomUUID(), name: file.name, type: file.type || 'application/octet-stream', size: file.size, content: dataUrl.split(',')[1] ?? '', encoding: 'base64' };
}
