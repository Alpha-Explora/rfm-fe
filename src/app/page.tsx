'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, ArrowRight, BarChart2, Brain, Building2, CheckCircle2, ChevronRight, ChevronDown, ChevronUp, ClipboardCheck, Coins, Database, Eye, EyeOff, FileText, GitBranch, History, LayoutDashboard, Layers, LoaderCircle, Lock, LogOut, Mail, MessagesSquare, PanelRight, Phone, Search, Send, Shield, ShieldAlert, ShieldCheck, Sparkles, Square, Trash2, TrendingUp, Upload, User, UserPlus, Users, X, Zap, Calculator, Plus, Menu, Settings } from 'lucide-react';
import CreditMemo, { AssessmentData } from '@/components/CreditMemo';
import Markdown from '@/components/Markdown';
import { CreditReport } from './types';
import { runEveSession, buildAssessmentMessage, buildOverviewMessage, buildChatMessage, EveEvent } from './eve';

type EveMode = 'assessment' | 'overview' | 'chat';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type ClientDocument = { id: string; name: string; type: string; size: number; content: string; encoding: 'base64' };
type Client = { id: string; name: string; industry: string; contactName?: string; email?: string; phone?: string; data: string; documents: ClientDocument[]; webhookUrl?: string };
type ChatItem = { id: string; role: 'assistant' | 'user' | 'trace' | 'stream' | 'report'; content: string; report?: CreditReport; assessment?: AssessmentData; agent?: string; state?: string; meta?: string; suggestions?: string[] };
type BackroomItem = { id: string; type: string; agent: string; target?: string; model?: string; content: string; state?: string };
type AgentName = 'director' | 'analytics' | 'risk' | 'reporting' | 'kyc' | 'document-verification' | 'fraud-investigation' | 'credit-review' | 'portfolio-monitor';
type WorkflowAgent = { name: AgentName; status: 'idle' | 'queued' | 'running' | 'streaming' | 'complete' | 'fallback' | 'error' | 'stopped'; task: string; output: string; model?: string; durationMs?: number };
type ClientOverview = { client: Record<string, string>; documents: { name: string; type: string; extractedChars: number }[]; snapshot: string[]; highlights: string[]; nextSteps: string[] };
type TokenCount = { input: number; output: number; cached: number };
type TokenStats = { session: TokenCount; run: TokenCount; byAgent: Record<string, number> };
const emptyTokenCount = (): TokenCount => ({ input: 0, output: 0, cached: 0 });
const tokenTotal = (t: TokenCount) => t.input + t.output;
type RunRecord = { id: string; mode: 'assessment' | 'overview' | 'stopped'; clientName: string; timestamp: number; tokens: number; success: boolean };

const agentTasks: Record<AgentName, string> = {
  director: 'Coordinate the assessment',
  analytics: 'Calculate metrics',
  risk: 'Classify credit risk',
  reporting: 'Package recommendation',
  kyc: 'Screen compliance and AML',
  'document-verification': 'Verify document legitimacy',
  'fraud-investigation': 'Investigate fraud indicators',
  'credit-review': 'Resolve manual review queue',
  'portfolio-monitor': 'Scan client portfolio status',
};

// Workflow order = the assessment story
const AGENT_ORDER: AgentName[] = [
  'analytics',
  'risk',
  'reporting',
  'kyc',
  'document-verification',
  'fraud-investigation',
  'credit-review',
  'portfolio-monitor'
];

// The board is split into two honest groups. REASONING_AGENTS genuinely think with
// the model and light up one-by-one as they execute. AUTO_AGENTS are the compliance/
// intelligence checks that run as deterministic CODE inside the run_intelligence tool
// (see lib/intelligence.ts) — they complete near-instantly, so we render them as
// "automated checks" rather than pretending they are slow model calls.
const REASONING_AGENTS: AgentName[] = ['director', 'analytics', 'risk', 'reporting', 'credit-review'];
const AUTO_AGENTS: AgentName[] = ['kyc', 'document-verification', 'fraud-investigation', 'portfolio-monitor'];
const isAutoAgent = (name: AgentName) => AUTO_AGENTS.includes(name);

const emptyWorkflow = (): Record<AgentName, WorkflowAgent> =>
  ['director', ...AGENT_ORDER].reduce((acc, name) => {
    acc[name as AgentName] = { name: name as AgentName, status: 'idle', task: agentTasks[name as AgentName], output: '' };
    return acc;
  }, {} as Record<AgentName, WorkflowAgent>);

const starterClients: Client[] = [];

const WELCOME_MESSAGE = 'Welcome to RFM Credit AI. Select a client profile to inspect its user information and documents, then run an assessment or chat with the Director agent.';
const welcomeMessage = (): ChatItem => ({ id: 'welcome', role: 'assistant', content: WELCOME_MESSAGE });

// ── Multi-session model ──
// A "session" is one conversation tab. Each owns its own chat feed, workflow
// board, and run state so multiple conversations can run at once without
// blocking or overwriting one another. `SessionState` holds the rendered
// snapshot; `SessionRun` holds non-rendered per-run internals mutated while an
// Eve stream is in flight.
type SessionState = {
  localId: string;
  conversationId: string | null;
  client: Client | null;
  messages: ChatItem[];
  workflow: Record<AgentName, WorkflowAgent>;
  backroom: BackroomItem[];
  latestReport: CreditReport | null;
  overview: ClientOverview | null;
  busy: boolean;
  overviewBusy: boolean;
};

type SessionRun = {
  conversationId: string | null;
  abort: AbortController | null;
  collect: { parsed?: any; metrics?: any; risk?: any; report?: any; intelligence?: any; recommendation?: any };
  finalized: boolean;
  finalMsg: string;
  activeAgent: string;
  runTokens: number;
  runTokenStats: TokenCount;
  // In-flight conversation-create promise: dedupes concurrent create calls so a
  // single chat never fragments into two DB conversations.
  createPromise: Promise<string> | null;
};

const freshSession = (localId: string, client: Client | null = null): SessionState => ({
  localId,
  conversationId: null,
  client,
  messages: [welcomeMessage()],
  workflow: emptyWorkflow(),
  backroom: [],
  latestReport: null,
  overview: null,
  busy: false,
  overviewBusy: false,
});

const freshRun = (): SessionRun => ({
  conversationId: null,
  abort: null,
  collect: {},
  finalized: false,
  finalMsg: '',
  activeAgent: 'director',
  runTokens: 0,
  runTokenStats: emptyTokenCount(),
  createPromise: null,
});

export default function Home() {
  const [clients, setClients] = useState<Client[]>(starterClients);
  const [confirm, setConfirm] = useState<Client | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [viewingClient, setViewingClient] = useState<Client | null>(null);
  const [backroomOpen, setBackroomOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [question, setQuestion] = useState('');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'clients' | 'new-client' | 'workspace' | 'settings'>('clients');
  // Floating agent-status indicator: set when an agent finishes while the user is on another tab.
  const [agentDoneAway, setAgentDoneAway] = useState(false);
  // Client deletion: the client pending a delete confirmation, plus in-flight/error state.
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [tokenStats, setTokenStats] = useState<TokenStats>({ session: emptyTokenCount(), run: emptyTokenCount(), byAgent: {} });
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const activeTabRef = useRef(activeTab);
  const prevRunningRef = useRef(false);

  // ── Multi-session store ──
  // `store.sessions` maps localId → SessionState; `activeLocalId` is the visible tab.
  const [store, setStore] = useState<{ sessions: Record<string, SessionState>; activeLocalId: string }>(() => {
    const id = crypto.randomUUID();
    return { sessions: { [id]: freshSession(id) }, activeLocalId: id };
  });
  const sessions = store.sessions;
  const activeLocalId = store.activeLocalId;
  const activeLocalIdRef = useRef(activeLocalId);
  useEffect(() => { activeLocalIdRef.current = activeLocalId; }, [activeLocalId]);

  // Per-run internals (mutated during streaming), keyed by localId — never rendered directly.
  const runsRef = useRef<Record<string, SessionRun>>({});
  const getRun = (sid: string): SessionRun => (runsRef.current[sid] ??= freshRun());

  // Active-session view — the JSX and non-run callers below read these names unchanged.
  const activeSession = sessions[activeLocalId] ?? freshSession(activeLocalId);
  const { messages, workflow, backroom, latestReport, overview, busy, overviewBusy, client: active, conversationId: activeConversationId } = activeSession;
  const anyBusy = Object.values(sessions).some((s) => s.busy || s.overviewBusy);
  // Conversation ids of any session currently running (for the sessions-panel spinner).
  const runningConversationIds = new Set(
    Object.values(sessions).filter((s) => (s.busy || s.overviewBusy) && s.conversationId).map((s) => s.conversationId as string),
  );

  // ── Session mutation helpers ──
  function updateSession(sid: string, patch: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)) {
    setStore((prev) => {
      const s = prev.sessions[sid];
      if (!s) return prev;
      const p = typeof patch === 'function' ? patch(s) : patch;
      return { ...prev, sessions: { ...prev.sessions, [sid]: { ...s, ...p } } };
    });
  }
  const updMessages = (sid: string, fn: (items: ChatItem[]) => ChatItem[]) => updateSession(sid, (s) => ({ messages: fn(s.messages) }));
  const updBackroom = (sid: string, fn: (items: BackroomItem[]) => BackroomItem[]) => updateSession(sid, (s) => ({ backroom: fn(s.backroom) }));
  const patchWorkflowFor = (sid: string, agent: AgentName, patch: Partial<WorkflowAgent>) =>
    updateSession(sid, (s) => ({ workflow: { ...s.workflow, [agent]: { ...s.workflow[agent], ...patch } } }));
  function setConversationId(sid: string, cid: string | null) {
    getRun(sid).conversationId = cid;
    updateSession(sid, { conversationId: cid });
  }
  function switchToSession(sid: string) {
    activeLocalIdRef.current = sid;
    setStore((prev) => (prev.sessions[sid] ? { ...prev, activeLocalId: sid } : prev));
  }

  // Active-session wrapper setters. These target the *visible* session, so the
  // large JSX block and every synchronous UI action keep working unchanged.
  // Run handlers, which may update a backgrounded session, use the sid-scoped
  // helpers above instead.
  type Upd<T> = T | ((prev: T) => T);
  const applyUpd = <T,>(v: Upd<T>, prev: T): T => (typeof v === 'function' ? (v as (p: T) => T)(prev) : v);
  const setMessages = (v: Upd<ChatItem[]>) => updateSession(activeLocalIdRef.current, (s) => ({ messages: applyUpd(v, s.messages) }));
  const setLatestReport = (v: Upd<CreditReport | null>) => updateSession(activeLocalIdRef.current, (s) => ({ latestReport: applyUpd(v, s.latestReport) }));
  const setOverview = (v: Upd<ClientOverview | null>) => updateSession(activeLocalIdRef.current, (s) => ({ overview: applyUpd(v, s.overview) }));
  const setActive = (v: Upd<Client | null>) => updateSession(activeLocalIdRef.current, (s) => ({ client: applyUpd(v, s.client) }));

  // Conversation & Memory Persistence
  const [conversations, setConversations] = useState<any[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<any[]>([]);
  const [showArchivedPanel, setShowArchivedPanel] = useState(false);
  const [showLearningsPanel, setShowLearningsPanel] = useState(false);
  const [selectedAgentName, setSelectedAgentName] = useState<AgentName>('director');
  const [agentMemories, setAgentMemories] = useState<any[]>([]);
  // Archived (soft-deleted) clients — retrievable or permanently deletable from Settings.
  const [archivedClients, setArchivedClients] = useState<Client[]>([]);
  const [purgeTarget, setPurgeTarget] = useState<Client | null>(null);
  const [purging, setPurging] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showFloatingClients, setShowFloatingClients] = useState(false);

  async function handleSelectClientFromFloating(client: Client) {
    prepareClient(client);
    setActiveTab('workspace');

    const userMsg: ChatItem = {
      id: crypto.randomUUID(),
      role: 'user',
      content: `Selected client: **${client.name}**`
    };

    const assistantMsg: ChatItem = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: `I have loaded the profile and documents for **${client.name}**. What would you like me to do?`,
      suggestions: [
        `Run full credit assessment for ${client.name}`,
        `Give me a quick overview of ${client.name}`,
        `Check documents for compliance`,
        `Ask about their payment terms`
      ]
    };

    setMessages([
      { id: 'welcome', role: 'assistant', content: 'Welcome to RFM Credit AI. Select a client profile to inspect its user information and documents, then run an assessment or chat with the Director agent.' },
      userMsg,
      assistantMsg
    ]);

    try {
      const convId = await getOrCreateConversationForClient(client);
      await fetch(`${API_BASE}/api/conversations/${convId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: 'user', content: userMsg.content }),
      });
      await fetch(`${API_BASE}/api/conversations/${convId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: 'assistant', content: assistantMsg.content, metadata: { suggestions: assistantMsg.suggestions } }),
      });
    } catch (err) {
      console.error(err);
    }
  }

  async function getOrCreateConversationForClient(client: Client): Promise<string> {
    const title = buildConversationTitle(client, `Review ${client.name} profile`);
    const res = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ clientId: client.id, title }),
    });
    if (!res.ok) throw new Error('Failed to create conversation');
    const newConv = await res.json();
    setConversationId(activeLocalIdRef.current, newConv.id);
    void loadConversations();
    return newConv.id;
  }

  const [user, setUser] = useState<{ id: string; email: string; name?: string; role?: string } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    if (activeTab === 'settings' && token) {
      void loadArchivedConversations();
      void loadArchivedClients();
      void loadAgentMemories(selectedAgentName);
    }
  }, [activeTab, token, selectedAgentName]);

  async function loadConversations() {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function loadArchivedConversations() {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/conversations/archived`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setArchivedConversations(data);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function loadArchivedClients() {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/clients/archived`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setArchivedClients(Array.isArray(data) ? data.map(mapPersistedClient) : []);
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Restore an archived client back into the active list (and back into agent view).
  async function restoreClient(client: Client) {
    if (!token || restoringId) return;
    setRestoringId(client.id);
    try {
      const res = await fetch(`${API_BASE}/api/clients/${client.id}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 404) throw new Error(`Restore failed (${res.status})`);
      setArchivedClients((all) => all.filter((c) => c.id !== client.id));
      setClients((all) => (all.some((c) => c.id === client.id) ? all : [client, ...all]));
    } catch (err) {
      console.error(err);
    } finally {
      setRestoringId(null);
    }
  }

  // Permanently delete an archived client — irreversible; removes it from the DB
  // (documents, memories, emails included) so agents can never surface it again.
  async function purgeClient(client: Client) {
    if (!token || purging) return;
    setPurging(true);
    try {
      const res = await fetch(`${API_BASE}/api/clients/${client.id}/purge`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 404) throw new Error(`Delete failed (${res.status})`);
      setArchivedClients((all) => all.filter((c) => c.id !== client.id));
      setPurgeTarget(null);
    } catch (err) {
      console.error(err);
    } finally {
      setPurging(false);
    }
  }

  async function loadAgentMemories(agentName: string) {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/memories/agents/${agentName}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAgentMemories(data);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteAgentMemory(id: string) {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/memories/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        void loadAgentMemories(selectedAgentName);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function selectConversation(convId: string) {
    if (!token) return;
    // If a tab is already open for this conversation (possibly mid-run), just focus it —
    // never reload, so a running session is never interrupted or wiped.
    const existing = Object.values(store.sessions).find((s) => s.conversationId === convId);
    if (existing) { switchToSession(existing.localId); setActiveTab('workspace'); return; }
    try {
      const res = await fetch(`${API_BASE}/api/conversations/${convId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const conv = await res.json();

      const chatItems: ChatItem[] = conv.messages.map((msg: any) => {
        const metadata = msg.metadata || {};
        return {
          id: msg.id,
          role: msg.role.toLowerCase() === 'agent' ? 'trace' : msg.role.toLowerCase(),
          content: msg.content,
          agent: msg.agent || undefined,
          state: metadata.state || undefined,
          meta: metadata.meta || undefined,
          report: metadata.report || undefined,
          assessment: metadata.assessment || undefined,
        };
      });
      if (!chatItems.find((c) => c.id === 'welcome')) chatItems.unshift(welcomeMessage());

      const client = conv.clientId ? clients.find((c) => c.id === conv.clientId) ?? null : null;

      // Load into a fresh tab, reusing the current tab only if it is blank & idle
      // (so we don't spawn empty tabs, but never clobber a running one).
      const cur = store.sessions[store.activeLocalId];
      const reuseBlank = cur && !cur.busy && !cur.overviewBusy && !cur.conversationId && cur.messages.length <= 1;
      const targetId = reuseBlank ? store.activeLocalId : crypto.randomUUID();
      const loaded: SessionState = { ...freshSession(targetId, client), conversationId: conv.id, messages: chatItems };
      getRun(targetId).conversationId = conv.id;
      activeLocalIdRef.current = targetId;
      setStore((prev) => ({ sessions: { ...prev.sessions, [targetId]: loaded }, activeLocalId: targetId }));
      setActiveTab('workspace');
    } catch (err) {
      console.error(err);
    }
  }

  // Open a brand-new empty tab and focus it (existing tabs, running or not, are left alone).
  function createNewChat() {
    const sid = crypto.randomUUID();
    activeLocalIdRef.current = sid;
    setStore((prev) => ({ sessions: { ...prev.sessions, [sid]: freshSession(sid) }, activeLocalId: sid }));
    setActiveTab('workspace');
  }

  async function archiveConversation(convId: string, isArchived: boolean) {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/conversations/${convId}/archive`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ archived: isArchived }),
      });
      if (res.ok) {
        dropSessionsForConversation(convId);
        void loadConversations();
        void loadArchivedConversations();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteConversation(convId: string) {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/conversations/${convId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        dropSessionsForConversation(convId);
        void loadConversations();
        void loadArchivedConversations();
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Reset any open tab that points at a now-archived/deleted conversation, aborting
  // its run if one is in flight. Keeps the tab (blank) so the UI never loses its footing.
  function dropSessionsForConversation(convId: string) {
    setStore((prev) => {
      let changed = false;
      const next = { ...prev.sessions };
      for (const [sid, s] of Object.entries(prev.sessions)) {
        if (s.conversationId === convId) {
          getRun(sid).abort?.abort();
          runsRef.current[sid] = freshRun();
          next[sid] = freshSession(sid);
          changed = true;
        }
      }
      return changed ? { ...prev, sessions: next } : prev;
    });
  }

  // Get (or lazily create) the DB conversation for a specific session. A per-session
  // in-flight promise dedupes concurrent callers so one chat never fragments into two
  // conversations — the race that made threads appear to "disappear".
  async function getOrCreateConversation(sid: string, firstMessage?: string): Promise<string> {
    const run = getRun(sid);
    if (run.conversationId) return run.conversationId;
    if (run.createPromise) return run.createPromise;
    const sessionClient = store.sessions[sid]?.client ?? null;
    const title = buildConversationTitle(sessionClient, firstMessage);
    run.createPromise = (async () => {
      const res = await fetch(`${API_BASE}/api/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clientId: sessionClient?.id, title }),
      });
      if (!res.ok) throw new Error('Failed to create conversation');
      const newConv = await res.json();
      setConversationId(sid, newConv.id);
      void loadConversations();
      return newConv.id as string;
    })();
    try {
      return await run.createPromise;
    } finally {
      run.createPromise = null;
    }
  }

  async function persistMessage(sid: string, role: string, content: string, agent?: string, metadata?: any) {
    if (!token) return;
    try {
      const convId = await getOrCreateConversation(sid, role === 'user' ? content : undefined);
      await fetch(`${API_BASE}/api/conversations/${convId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role, content, agent, metadata }),
      });
    } catch (err) {
      console.error('Failed to persist message:', err);
    }
  }

  // Keep a ref of the current tab so the running-transition effect can read it without re-firing.
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // Detect when an agent run finishes while the user is on a different tab, so the floating
  // indicator can flip from "running" to "output ready". Returning to the workspace clears it.
  useEffect(() => {
    const isRunning = busy || overviewBusy;
    if (prevRunningRef.current && !isRunning && activeTabRef.current !== 'workspace') {
      setAgentDoneAway(true);
    }
    prevRunningRef.current = isRunning;
  }, [busy, overviewBusy]);

  useEffect(() => { if (activeTab === 'workspace') setAgentDoneAway(false); }, [activeTab]);

  useEffect(() => {
    const stored = localStorage.getItem('rfm-auth-token');
    if (stored) {
      fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${stored}` },
      })
        .then((res) => {
          if (res.ok) return res.json();
          throw new Error('Invalid session');
        })
        .then((userData) => {
          setToken(stored);
          setUser(userData);
        })
        .catch(() => {
          localStorage.removeItem('rfm-auth-token');
        })
        .finally(() => {
          setCheckingAuth(false);
        });
    } else {
      setCheckingAuth(false);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/clients`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => response.ok ? response.json() : [])
      .then((records) => {
        if (cancelled || !Array.isArray(records) || records.length === 0) return;
        setClients(records.map(mapPersistedClient));
      })
      .catch(() => undefined);

    void loadConversations();

    return () => { cancelled = true; };
  }, [token]);

  function handleLogout() {
    localStorage.removeItem('rfm-auth-token');
    setToken(null);
    setUser(null);
    setClients(starterClients);
    setConversations([]);
    runsRef.current = {};
    const id = crypto.randomUUID();
    activeLocalIdRef.current = id;
    setStore({ sessions: { [id]: freshSession(id) }, activeLocalId: id });
  }

  const openClientProfile = (client: Client) => { setViewingClient(client); setActiveTab('clients'); };

  // "Delete" is a soft-delete: DB-backed clients are archived (hidden from the list
  // and from every agent) and can be restored or permanently deleted from Settings.
  async function deleteClient(client: Client) {
    if (deleting) return;
    setDeleting(true);
    setDeleteError('');
    const token = typeof window !== 'undefined' ? localStorage.getItem('rfm-auth-token') : null;
    try {
      // Only call the backend for DB-backed clients; starter/local ones are removed from state only.
      if (isDbClient(client.id)) {
        const res = await fetch(`${API_BASE}/api/clients/${client.id}`, {
          method: 'DELETE',
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!res.ok && res.status !== 404) throw new Error(`Archive failed (${res.status})`);
        // Reflect the newly-archived client in Settings without a round-trip.
        setArchivedClients((all) => (all.some((c) => c.id === client.id) ? all : [client, ...all]));
      }
      setClients((all) => all.filter((c) => c.id !== client.id));
      if (viewingClient?.id === client.id) setViewingClient(null);
      if (active?.id === client.id) { setActive(null); setLatestReport(null); setOverview(null); }
      setDeleteTarget(null);
    } catch {
      setDeleteError('Could not archive this client. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  // Open a client in a tab: reuse the current tab only if it is blank & idle, otherwise
  // spin up a new tab. Never disturbs a running conversation. Returns the tab's localId.
  function prepareClient(client: Client): string {
    const cur = store.sessions[store.activeLocalId];
    const reuseBlank = cur && !cur.busy && !cur.overviewBusy && !cur.conversationId && cur.messages.length <= 1;
    const targetId = reuseBlank ? store.activeLocalId : crypto.randomUUID();
    runsRef.current[targetId] = freshRun();
    activeLocalIdRef.current = targetId;
    setStore((prev) => ({ sessions: { ...prev.sessions, [targetId]: freshSession(targetId, client) }, activeLocalId: targetId }));
    return targetId;
  }

  function resetRunTokens(sid: string) {
    const run = getRun(sid);
    run.runTokens = 0;
    run.runTokenStats = emptyTokenCount();
    setTokenStats((prev) => ({ ...prev, run: emptyTokenCount(), byAgent: {} }));
  }

  function viewClientDetails(client: Client) {
    prepareClient(client);
    setActiveTab('workspace');
    setConfirm(client);
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

  // ── Eve integration ──
  // Every agent workflow (assessment, overview, chat) runs on the Eve agent
  // runtime (proxied at /eve/*). Eve's NDJSON lifecycle events are mapped into
  // the existing workflow / token / report UI.
  // All handlers below take an explicit `sid` (the session/tab that owns this run) so a
  // run keeps updating its own tab even after the user switches away to prompt elsewhere.
  async function runEve(mode: EveMode, message: string, client: Client | null, sid: string) {
    const controller = new AbortController();
    const run = getRun(sid);
    run.abort = controller;
    run.collect = {};
    run.finalized = false;
    run.finalMsg = '';
    run.activeAgent = 'director';
    try {
      await runEveSession(message, (event) => handleEveEvent(event, mode, client, sid), controller.signal);
    } finally {
      if (getRun(sid).abort === controller) getRun(sid).abort = null;
    }
  }

  function appendEveStream(sid: string, agent: AgentName, delta: string) {
    const id = `token-${agent}`;
    updBackroom(sid, (items) => {
      const existing = items.find((item) => item.id === id);
      const content = ((existing?.content ?? '') + delta).slice(-4000);
      if (existing) return items.map((item) => item.id === id ? { ...item, content, state: 'streaming' } : item);
      return [...items, { id, type: 'reasoning', agent, content, state: 'streaming' }].slice(-80);
    });
  }

  function finalizeEveRun(mode: EveMode, client: Client | null, success: boolean, sid: string) {
    const run = getRun(sid);
    if (run.finalized) return;
    run.finalized = true;

    const runTok = run.runTokenStats;

    if (mode === 'assessment') {
      const report = assembleEveReport(run.collect);
      if (report) {
        updateSession(sid, { latestReport: report });
        const assessment: AssessmentData = {
          report,
          recommendation: run.collect.recommendation,
          intelligence: run.collect.intelligence,
          clientName: client?.name ?? 'Client',
          industry: client?.industry,
        };
        updMessages(sid, (items) => [...items, { id: crypto.randomUUID(), role: 'report', content: 'Credit assessment complete.', assessment }]);
        void persistMessage(sid, 'report', 'Credit assessment complete.', undefined, { assessment });
      }
      if (client) setRunHistory((prev) => [{ id: crypto.randomUUID(), mode: 'assessment' as const, clientName: client.name, timestamp: Date.now(), tokens: run.runTokens, success }, ...prev].slice(0, 30));
    } else if (mode === 'overview') {
      if (client) {
        updateSession(sid, { overview: buildOverviewFromEve(client, run.finalMsg) });
        setRunHistory((prev) => [{ id: crypto.randomUUID(), mode: 'overview' as const, clientName: client.name, timestamp: Date.now(), tokens: run.runTokens, success }, ...prev].slice(0, 30));
        void persistMessage(sid, 'assistant', run.finalMsg);
      }
    }
    // chat: messages already rendered; no report or run-history entry

    // Report token usage to admin backend
    if ((runTok.input + runTok.output) > 0 && mode !== 'chat') {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      let hasAuth = false;
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        hasAuth = true;
      } else {
        const adminKey = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('rfm-admin-key') : null;
        if (adminKey) {
          headers['x-admin-key'] = adminKey;
          hasAuth = true;
        }
      }

      if (hasAuth) {
        fetch(`${API_BASE}/api/admin/token-usage`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            clientId: client && isDbClient(client.id) ? client.id : undefined,
            clientName: client?.name,
            runMode: mode,
            inputTokens: runTok.input,
            outputTokens: runTok.output,
            cachedTokens: runTok.cached,
            success,
          }),
        }).catch(() => undefined);
      }
    }

    getRun(sid).abort?.abort();
  }

  function handleEveEvent(evt: EveEvent, mode: EveMode, client: Client | null, sid: string) {
    const run = getRun(sid);
    const d = (evt.data ?? {}) as any;
    switch (evt.type) {
      case 'session.started': {
        const modelId = d?.runtime?.modelId as string | undefined;
        patchWorkflowFor(sid, 'director', { status: 'running', model: modelId, task: mode === 'assessment' ? 'Orchestrating credit workflow' : mode === 'overview' ? 'Preparing client overview' : 'Answering' });
        updBackroom(sid, (items) => [...items, { id: crypto.randomUUID(), type: 'session.started', agent: 'director', model: modelId, content: `Eve session started · ${modelId ?? ''}` }].slice(-120));
        break;
      }
      case 'reasoning.appended': {
        if (typeof d.reasoningDelta === 'string') appendEveStream(sid, 'director', d.reasoningDelta);
        break;
      }
      case 'message.completed': {
        if (typeof d.message === 'string' && d.message.trim()) {
          run.finalMsg = d.message;
          const { content, suggestions } = parseSuggestions(d.message);
          updMessages(sid, (items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content, suggestions }]);
          void persistMessage(sid, 'assistant', d.message);
        }
        break;
      }
      case 'actions.requested': {
        const actions: any[] = Array.isArray(d.actions) ? d.actions : [];
        for (const a of actions) {
          if (a.kind === 'subagent-call' && isAgent(String(a.subagentName))) {
            patchWorkflowFor(sid, a.subagentName as AgentName, { status: 'running', task: a.description ?? agentTasks[a.subagentName as AgentName] });
            updBackroom(sid, (items) => [...items, { id: crypto.randomUUID(), type: 'dispatch', agent: 'director', target: a.subagentName, content: `Delegating to ${a.subagentName}` }].slice(-120));
          } else if (a.kind === 'tool-call') {
            // One-shot pipeline tool: it returns every stage at once, so line the
            // stages up as "queued" rather than pretending they run in parallel —
            // the tool-result below flips each to complete as its data arrives.
            if (a.toolName === 'run_assessment') {
              for (const ag of ['analytics', 'risk', 'reporting'] as AgentName[]) patchWorkflowFor(sid, ag, { status: 'queued' });
              for (const ag of AUTO_AGENTS) patchWorkflowFor(sid, ag, { status: 'queued' });
            }
            // The intelligence tool runs the compliance/fraud/document/portfolio
            // checks as code — mark them running; they'll complete near-instantly.
            if (a.toolName === 'run_intelligence') {
              for (const ag of AUTO_AGENTS) patchWorkflowFor(sid, ag, { status: 'running' });
            }
            updBackroom(sid, (items) => [...items, { id: crypto.randomUUID(), type: 'tool-call', agent: 'director', content: `tool: ${a.toolName ?? 'unknown'}` }].slice(-120));
          }
        }
        break;
      }
      case 'action.result': {
        const r = d.result as any;
        if (!r) break;
        if (r.kind === 'subagent-result' && isAgent(String(r.subagentName))) {
          patchWorkflowFor(sid, r.subagentName as AgentName, { status: 'complete', output: summarizeEveOutput(r.output) });
          collectEve(sid, r.subagentName as AgentName, r.output);
          updBackroom(sid, (items) => [...items, { id: crypto.randomUUID(), type: 'subagent-result', agent: r.subagentName, content: summarizeEveOutput(r.output) }].slice(-120));
        } else if (r.kind === 'tool-result') {
          const out = coerceEveOutput(r.output);
          // Collect whatever a director tool returns. In the orchestrated flow the
          // stages arrive separately: parse_financials → { parsed }, the subagents →
          // metrics/risk/report (via subagent events), run_intelligence →
          // { intelligence, recommendation }. run_assessment (direct mode) returns all
          // at once. Collect each field independently so no stage is dropped.
          if (out && typeof out === 'object') {
            if (out.parsed) { run.collect.parsed = out.parsed; }
            if (out.metrics) { patchWorkflowFor(sid, 'analytics', { status: 'complete', output: summarizeEveOutput(out.metrics) }); run.collect.metrics = out.metrics; }
            if (out.risk) { patchWorkflowFor(sid, 'risk', { status: 'complete', output: summarizeEveOutput(out.risk) }); run.collect.risk = out.risk; }
            if (out.report) { patchWorkflowFor(sid, 'reporting', { status: 'complete', output: 'CreditReport assembled' }); run.collect.report = out.report; }
            if (out.recommendation) {
              patchWorkflowFor(sid, 'reporting', { status: 'complete', output: out.recommendation.decision });
              run.collect.recommendation = out.recommendation;
            }
            if (out.intelligence) { run.collect.intelligence = out.intelligence; applyIntelligenceToBoard(sid, out.intelligence); }
            if (!out.parsed && !out.metrics && !out.risk && !out.report && !out.recommendation && !out.intelligence && looksLikeReport(out)) {
              run.collect.report = out;
            }
          }
          updBackroom(sid, (items) => [...items, { id: crypto.randomUUID(), type: 'tool-result', agent: 'director', content: summarizeEveOutput(out) }].slice(-120));
        }
        break;
      }
      // Eve's dedicated subagent lifecycle events — these fire directly when a
      // subagent starts/finishes, so the board updates without waiting for the
      // later action.result round-trip.
      case 'subagent.called': {
        if (isAgent(String(d.subagentName))) {
          run.activeAgent = String(d.subagentName);
          patchWorkflowFor(sid, d.subagentName as AgentName, { status: 'running' });
        }
        break;
      }
      case 'subagent.completed': {
        if (isAgent(String(d.subagentName))) {
          const out = coerceEveOutput(d.output);
          patchWorkflowFor(sid, d.subagentName as AgentName, { status: 'complete', output: summarizeEveOutput(out) });
          collectEve(sid, d.subagentName as AgentName, out);
          updBackroom(sid, (items) => [...items, { id: crypto.randomUUID(), type: 'subagent-result', agent: d.subagentName, content: summarizeEveOutput(out) }].slice(-120));
          run.activeAgent = 'director';
        }
        break;
      }
      case 'step.completed': {
        const usage = (d.usage ?? {}) as any;
        const inp = Number(usage.inputTokens ?? 0);
        const out = Number(usage.outputTokens ?? 0);
        const cached = Number(usage.cacheReadTokens ?? 0);
        if (inp || out || cached) {
          run.runTokens += inp + out;
          run.runTokenStats = { input: run.runTokenStats.input + inp, output: run.runTokenStats.output + out, cached: run.runTokenStats.cached + cached };
          const agent = run.activeAgent;
          setTokenStats((prev) => ({
            session: { input: prev.session.input + inp, output: prev.session.output + out, cached: prev.session.cached + cached },
            run: { input: prev.run.input + inp, output: prev.run.output + out, cached: prev.run.cached + cached },
            byAgent: { ...prev.byAgent, [agent]: (prev.byAgent[agent] ?? 0) + out },
          }));
        }
        break;
      }
      case 'turn.completed':
      case 'session.completed': {
        patchWorkflowFor(sid, 'director', { status: 'complete' });
        finalizeEveRun(mode, client, true, sid);
        break;
      }
      case 'step.failed':
      case 'turn.failed':
      case 'session.failed': {
        const msg = (d.message as string) ?? 'Eve run failed';
        updMessages(sid, (items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: `Eve error: ${msg}` }]);
        patchWorkflowFor(sid, 'director', { status: 'error' });
        finalizeEveRun(mode, client, false, sid);
        break;
      }
    }
  }

  function collectEve(sid: string, agent: AgentName, output: any) {
    const run = getRun(sid);
    if (agent === 'analytics') run.collect.metrics = output;
    else if (agent === 'risk') run.collect.risk = output;
    else if (agent === 'reporting') run.collect.report = output;
  }

  // The run_intelligence tool returns { compliance, fraud, loanOptions, macro,
  // portfolio } — all computed as code. Flip each automated-check card to complete
  // with a short summary of what the check found, so the board reflects the real
  // (instant) work instead of leaving these agents idle.
  function applyIntelligenceToBoard(sid: string, intel: any) {
    if (!intel || typeof intel !== 'object') return;
    const compliance = intel.compliance ?? {};
    const flags: unknown[] = Array.isArray(compliance.flags) ? compliance.flags : [];
    patchWorkflowFor(sid, 'kyc', {
      status: 'complete',
      output: `Compliance ${compliance.status ?? 'checked'}${flags.length ? ` · ${flags.length} flag${flags.length === 1 ? '' : 's'}` : ''}`,
    });

    const anomalies: unknown[] = Array.isArray(intel.fraud?.anomalies) ? intel.fraud.anomalies : [];
    patchWorkflowFor(sid, 'fraud-investigation', {
      status: 'complete',
      output: anomalies.length ? `${anomalies.length} anomaly signal${anomalies.length === 1 ? '' : 's'}` : 'No anomalies detected',
    });

    const docCheck = (Array.isArray(compliance.checks) ? compliance.checks : []).find((c: any) => /document/i.test(String(c?.label)));
    patchWorkflowFor(sid, 'document-verification', {
      status: 'complete',
      output: docCheck ? (docCheck.pass ? 'Supporting documents present' : 'No supporting documents on file') : 'Document presence checked',
    });

    patchWorkflowFor(sid, 'portfolio-monitor', {
      status: 'complete',
      output: 'Portfolio history reviewed',
    });
  }

  // Stop the currently-visible session's run (the composer's Stop button).
  function stop() {
    const sid = activeLocalIdRef.current;
    const run = getRun(sid);
    if (!run.abort) return;
    run.abort.abort();
    run.abort = null;
    const client = sessions[sid]?.client ?? null;
    if (client && run.runTokens > 0) {
      setRunHistory((prev) => [{
        id: crypto.randomUUID(),
        mode: 'stopped' as const,
        clientName: client.name,
        timestamp: Date.now(),
        tokens: run.runTokens,
        success: false,
      }, ...prev].slice(0, 30));
    }
    updateSession(sid, (s) => {
      const workflow = { ...s.workflow };
      for (const key of Object.keys(workflow) as AgentName[]) {
        if (['queued', 'running', 'streaming'].includes(workflow[key].status)) workflow[key] = { ...workflow[key], status: 'stopped' };
      }
      return {
        busy: false,
        overviewBusy: false,
        workflow,
        messages: [...s.messages, { id: crypto.randomUUID(), role: 'assistant', content: '_Conversation stopped._' }],
      };
    });
  }

  function eveError(sid: string, error: unknown) {
    if (isAbortError(error)) return;
    updMessages(sid, (items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: `Eve connection failed: ${error instanceof Error ? error.message : 'unknown'}. Is the Eve dev server running on :2000?` }]);
  }

  async function runOverview(client: Client) {
    const sid = activeLocalIdRef.current;
    resetRunTokens(sid);
    updateSession(sid, (s) => ({
      overviewBusy: true,
      workflow: emptyWorkflow(),
      backroom: [],
      messages: [...s.messages, { id: crypto.randomUUID(), role: 'user', content: `Give me a quick overview of ${client.name} (via Eve agents).` }],
    }));
    try { await runEve('overview', buildOverviewMessage(client.name, client.data, user?.id, isDbClient(client.id) ? client.id : undefined), client, sid); }
    catch (error) { eveError(sid, error); }
    finally { updateSession(sid, { overviewBusy: false }); }
  }

  async function startAssessment() {
    const client = confirm ?? active;
    if (!client) return;
    await startAssessmentFor(client);
  }

  async function startAssessmentFor(client: Client) {
    const sid = activeLocalIdRef.current;
    resetRunTokens(sid);
    setConfirm(null);
    updateSession(sid, (s) => ({
      busy: true,
      workflow: emptyWorkflow(),
      backroom: [],
      messages: [...s.messages, { id: crypto.randomUUID(), role: 'user', content: `Run a full credit assessment for ${client.name} (via Eve agents).` }],
    }));

    const dbClient = isDbClient(client.id);
    let data = client.data;
    let clientId: string | undefined;

    if (dbClient) {
      // DB-persisted client: agents fetch documents directly from the database.
      clientId = client.id;
      if (client.documents.length) {
        updMessages(sid, (items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: `Loading ${client.documents.length} document${client.documents.length > 1 ? 's' : ''} from database for agent ingestion…` }]);
      }
    } else {
      // In-memory starter client: extract document content client-side.
      if (client.documents.length) {
        updMessages(sid, (items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: `Scanning ${client.documents.length} document${client.documents.length > 1 ? 's' : ''} in code…` }]);
        const fields = await extractDocumentData(client);
        if (fields && Object.keys(fields).length) {
          data = JSON.stringify({ ...safeParse(client.data), ...fields });
          updMessages(sid, (items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: `Extracted **${Object.keys(fields).length} financial fields** (${Object.keys(fields).map(prettyKey).join(', ')}) — no model tokens used.` }]);
        }
      }
    }

    try { await runEve('assessment', buildAssessmentMessage(client.name, dbClient ? '' : data, client.industry, client.documents.map((d) => d.name), client.webhookUrl, clientId, user?.id), client, sid); }
    catch (error) { eveError(sid, error); }
    finally { updateSession(sid, { busy: false }); }
  }

  async function runSingleAgent(agent: AgentName) {
    const sid = activeLocalIdRef.current;
    if (sessions[sid]?.busy || sessions[sid]?.overviewBusy) return;
    const client = sessions[sid]?.client ?? null;

    let text = '';
    switch (agent) {
      case 'analytics':
        text = client ? `Run analytics calculation for client "${client.name}"` : `Run analytics calculation`;
        break;
      case 'risk':
        text = client ? `Run risk classification for client "${client.name}"` : `Run risk classification`;
        break;
      case 'reporting':
        text = client ? `Generate credit report for client "${client.name}"` : `Generate credit report`;
        break;
      case 'kyc':
        text = client ? `Run KYC screening for client "${client.name}"` : `Run KYC screening`;
        break;
      case 'document-verification':
        text = client ? `Verify documents for client "${client.name}"` : `Verify documents`;
        break;
      case 'fraud-investigation':
        text = client ? `Investigate fraud for client "${client.name}"` : `Investigate fraud`;
        break;
      case 'credit-review':
        text = `Resolve manual reviews`;
        break;
      case 'portfolio-monitor':
        text = `Scan client portfolio`;
        break;
      case 'director':
        if (client) {
          await startAssessmentFor(client);
          return;
        }
        text = `Coordinate the assessment`;
        break;
    }

    if (!text) return;

    updateSession(sid, (s) => ({
      backroom: [],
      messages: [...s.messages, { id: crypto.randomUUID(), role: 'user', content: text }],
      busy: true,
    }));
    void persistMessage(sid, 'user', text);

    try {
      await runEve(
        'chat',
        buildChatMessage(
          text,
          client?.name,
          client?.data,
          user?.id,
          client && isDbClient(client.id) ? client.id : undefined,
        ),
        client,
        sid,
      );
    } catch (error) {
      eveError(sid, error);
    } finally {
      updateSession(sid, { busy: false });
    }
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    const sid = activeLocalIdRef.current;
    if (!question.trim() || sessions[sid]?.busy) return;
    const client = sessions[sid]?.client ?? null;
    const text = question.trim(); setQuestion('');
    updateSession(sid, (s) => ({ busy: true, messages: [...s.messages, { id: crypto.randomUUID(), role: 'user', content: text }] }));
    void persistMessage(sid, 'user', text);
    try { await runEve('chat', buildChatMessage(text, client?.name, client?.data, user?.id, client && isDbClient(client.id) ? client.id : undefined), client, sid); }
    catch (error) { eveError(sid, error); }
    finally { updateSession(sid, { busy: false }); }
  }

  const assessmentCount = runHistory.filter(r => r.mode === 'assessment').length;
  const successCount = runHistory.filter(r => r.success).length;

  if (checkingAuth) {
    return (
      <div className="rfm-loader-shell" role="status" aria-live="polite" aria-label="Loading RFM session">
        <motion.div
          className="rfm-loader-card"
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.46, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="rfm-loader-mark" aria-hidden="true">
            {['R', 'F', 'M'].map((letter, index) => (
              <motion.span
                key={letter}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: [0.72, 1, 0.82], y: 0 }}
                transition={{
                  opacity: { repeat: Infinity, repeatType: 'mirror', duration: 1.65, delay: index * 0.18 },
                  y: { duration: 0.46, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] },
                }}
              >
                {letter}
              </motion.span>
            ))}
          </div>

          <div className="rfm-loader-signal" aria-hidden="true">
            <motion.span
              initial={{ x: '-18%' }}
              animate={{ x: '118%' }}
              transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
            />
          </div>

          <motion.div
            className="rfm-loader-copy"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.28, duration: 0.36 }}
          >
            <strong>Preparing credit workspace</strong>
            <small>Verifying session, agent routing, and underwriting context</small>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return <AuthGate onSuccess={(tok, usr) => { setToken(tok); setUser(usr); }} />;
  }

  return <main className={`workspace-shell ${sidebarOpen ? 'sidebar-open' : 'sidebar-collapsed'}`}>
    <AnimatePresence initial={false}>
      {sidebarOpen && (
        <motion.aside
          className="sidebar"
          initial={{ opacity: 0, x: -22, filter: 'blur(8px)' }}
          animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, x: -22, filter: 'blur(8px)' }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
      <div className="brand">
        <div className="brand-lockup">
          <span className="brand-mark"><Brain size={20}/></span>
          <div><strong>RFM Credit AI</strong><small>Underwriting Suite</small></div>
        </div>
        <button
          className="shell-icon-button sidebar-hide-button"
          onClick={() => setSidebarOpen(false)}
          title="Hide sidebar"
          aria-label="Hide sidebar"
        >
          <Menu size={16} />
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="Primary navigation">
        <button className={`sidebar-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
          <LayoutDashboard size={16}/><span>Dashboard</span>
        </button>
        <button className={`sidebar-nav-item ${activeTab === 'clients' ? 'active' : ''}`} onClick={() => setActiveTab('clients')}>
          <Users size={16}/><span>Client Profiles</span>
        </button>
        <button className={`sidebar-nav-item ${activeTab === 'new-client' ? 'active' : ''}`} onClick={() => setActiveTab('new-client')}>
          <UserPlus size={16}/><span>New Client</span>
        </button>
        <button className={`sidebar-nav-item ${activeTab === 'workspace' ? 'active' : ''}`} onClick={() => setActiveTab('workspace')}>
          <Brain size={16}/><span>Workspace</span>
        </button>
      </nav>

      <div style={{ marginTop: 'auto', paddingBottom: 10 }}>
        <button className={`sidebar-nav-item settings-link ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
          <Settings size={16}/><span>Settings</span>
        </button>
        <div className="provider-pill"><i/> OpenCode connected</div>
      </div>
        </motion.aside>
      )}
    </AnimatePresence>

    <section className="conversation">
      <header className="topbar">
        <div className="topbar-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {!sidebarOpen && (
              <button
                className="shell-icon-button sidebar-reveal-button"
                onClick={() => setSidebarOpen(true)}
                title="Show sidebar"
                aria-label="Show sidebar"
              >
                <Menu size={20} />
              </button>
            )}
            <div>
              <small>CONVERSATIONAL WORKSPACE</small>
              <h1>{active?.name ?? 'Credit Intelligence'}</h1>
            </div>
          </div>
          <div className="top-actions">
            {user?.role === 'superadmin' && (tokenTotal(tokenStats.session) > 0 || busy || overviewBusy) && (
              <div className={`token-meter ${busy || overviewBusy ? 'live' : ''}`} title="Real-time token usage">
                <Zap size={12}/>
                <span className="tm-live"/>
                <span className="tm-part"><i>in</i> {fmtTokens(tokenStats.session.input)}</span>
                <span className="tm-part"><i>out</i> {fmtTokens(tokenStats.session.output)}</span>
                {tokenStats.session.cached > 0 && <span className="tm-part tm-cached"><i>cached</i> {fmtTokens(tokenStats.session.cached)}</span>}
                <span className="tm-total">{fmtTokens(tokenTotal(tokenStats.session))}</span>
              </div>
            )}
            {activeTab === 'workspace' && (
              <button
                className={`backroom-toggle panel-toggle ${panelOpen ? 'active' : ''}`}
                onClick={() => setPanelOpen((open) => !open)}
                aria-expanded={panelOpen}
              >
                <PanelRight size={14}/> {panelOpen ? 'Hide panel' : 'Show panel'}
              </button>
            )}
            <div className="model-badge"><Sparkles size={14}/> OpenCode API</div>
          </div>
        </div>
      </header>

      {/* ── Dashboard Tab ── */}
      {activeTab === 'dashboard' && (
        <DashboardView
          clients={clients}
          assessmentCount={assessmentCount}
          successCount={successCount}
          runHistory={runHistory}
          onSelectClient={openClientProfile}
          onNewClient={() => setActiveTab('new-client')}
          onOpenWorkspace={() => setActiveTab('workspace')}
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
          onDelete={(client) => { setDeleteError(''); setDeleteTarget(client); }}
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
            prepareClient(finalClient);
            setActiveTab('workspace');
          }}
        />
      )}

      {/* ── Workspace Tab ── */}
      {activeTab === 'workspace' && (
        <div className={`workspace-layout ${panelOpen ? 'with-panel' : 'panel-hidden'}`}>
          <div className="conversation-main">
            <div className="chat-feed">
              {/* Starter prompts — shown only when conversation is at the welcome message */}
              {messages.length === 1 && !busy && !overviewBusy && (
                <StarterPrompts clients={clients} onSend={(text) => { setQuestion(text); setTimeout(() => { const form = document.querySelector<HTMLFormElement>('.composer'); form?.requestSubmit(); }, 0); }}/>
              )}
              {messages.map((item, idx) => (
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
                  ) : item.role === 'report' && item.assessment ? (
                    <div className="memo-wrap">
                      <CreditMemo data={item.assessment}/>
                    </div>
                  ) : (
                    <div className="bubble">
                      {item.role === 'assistant' ? (
                        <>
                          <Markdown>{item.content}</Markdown>
                          {item.suggestions && item.suggestions.length > 0 && idx === messages.length - 1 && !busy && !overviewBusy && (
                            <div className="bubble-suggestions">
                              {item.suggestions.map((s) => (
                                <button key={s} className="bubble-suggest-chip" onClick={() => { setQuestion(s); setTimeout(() => { document.querySelector<HTMLFormElement>('.composer')?.requestSubmit(); }, 0); }}>
                                  <ChevronRight size={11}/>{s}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      ) : item.content}
                    </div>
                  )}
                </motion.div>
              ))}
              {busy && (
                <motion.div className="chat-thinking" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                  <div className="chat-thinking-row">
                    <div className="thinking"><span/><span/><span/></div>
                    <button
                      type="button"
                      className={`chat-thinking-label ${backroomOpen ? 'open' : ''}`}
                      onClick={() => setBackroomOpen(!backroomOpen)}
                      title="Toggle background activity logs"
                    >
                      {backroomOpen ? 'Hide background activity' : 'Show background activity'}
                      <ChevronDown size={14}/>
                    </button>
                  </div>
                  <AnimatePresence initial={false}>
                    {backroomOpen && (
                      <motion.div
                        className="chat-thinking-panel"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <div>
                          <InlineBackroom items={backroom}/>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </div>
            <form className="composer" onSubmit={ask}>
              <input value={question} onChange={(e) => setQuestion(e.target.value)} disabled={busy || overviewBusy} placeholder={latestReport ? 'Ask about cash flow, risk factors, or payment terms…' : 'Chat with the RFM Director agent…'}/>
              {busy || overviewBusy
                ? <button type="button" className="stop" onClick={stop} aria-label="Stop conversation"><Square size={15}/></button>
                : <button disabled={!question.trim()} aria-label="Send message"><Send size={18}/></button>
              }
            </form>


          </div>

          <AnimatePresence initial={false}>
            {panelOpen ? (
              <motion.aside
                className="side-panel workspace-side-panel"
                initial={{ opacity: 0, x: 34, filter: 'blur(8px)' }}
                animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, x: 34, filter: 'blur(8px)' }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="side-panel-chrome">
                  <div>
                    <span>Workflow panel</span>
                    <strong>{active ? active.name : 'No client loaded'}</strong>
                  </div>
                  <button
                    type="button"
                    className="shell-icon-button"
                    onClick={() => setPanelOpen(false)}
                    aria-label="Hide workflow panel"
                    title="Hide workflow panel"
                  >
                    <PanelRight size={16}/>
                  </button>
                </div>
                <WorkspaceSessionsPanel
                  conversations={conversations}
                  activeConversationId={activeConversationId}
                  runningConversationIds={runningConversationIds}
                  onNew={createNewChat}
                  onSelect={(id) => void selectConversation(id)}
                  onArchive={(id) => void archiveConversation(id, true)}
                />
                {active && (
                  <>
                    <ClientProfilePanel client={active} overview={overview} busy={overviewBusy} onAssess={startAssessment}/>
                    <WorkflowBoard workflow={workflow} onRunAgent={runSingleAgent} disabled={busy || overviewBusy}/>
                  </>
                )}
              </motion.aside>
            ) : (
              <motion.button
                type="button"
                className="workflow-panel-peek"
                onClick={() => setPanelOpen(true)}
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 18 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                aria-label="Show workflow panel"
              >
                <PanelRight size={16}/>
                <span>Workflow</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── Me Settings Tab ── */}
      {activeTab === 'settings' && (
        <div className="settings-view">
          {/* Header */}
          <div className="settings-hero">
            <div>
              <small>CONTROL CENTER</small>
              <h1>Settings</h1>
              <p>Manage your account, AI memory, archived sessions, and workspace runtime.</p>
            </div>
            <div className="settings-status">
              <span><i/> OpenCode connected</span>
              <strong>{conversations.length}</strong>
              <small>active sessions</small>
            </div>
          </div>

          <div className="settings-metrics">
            <div><span><MessagesSquare size={15}/></span><small>Conversations</small><strong>{conversations.length}</strong></div>
            <div><span><History size={15}/></span><small>Archived</small><strong>{archivedConversations.length}</strong></div>
            <div><span><Users size={15}/></span><small>Client Profiles</small><strong>{clients.length}</strong></div>
            <div><span><Zap size={15}/></span><small>Session Tokens</small><strong>{fmtTokens(tokenTotal(tokenStats.session))}</strong></div>
          </div>

          {/* User Info Section */}
          <div className="settings-section-card" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: '24px', boxShadow: 'var(--shadow-sm)' }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <User size={18} style={{ color: 'var(--blue)' }} /> User Profile Information
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <small style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Full Name</small>
                <div style={{ fontSize: 14, color: 'var(--ink)', marginTop: 4, fontWeight: 500 }}>{user?.name || 'Not Provided'}</div>
              </div>
              <div>
                <small style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Email Address</small>
                <div style={{ fontSize: 14, color: 'var(--ink)', marginTop: 4, fontWeight: 500 }}>{user?.email || '—'}</div>
              </div>
              <div>
                <small style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Account Role</small>
                <div style={{ fontSize: 14, color: 'var(--ink)', marginTop: 4, fontWeight: 500, textTransform: 'capitalize' }}>{user?.role || 'User'}</div>
              </div>
              {user?.role === 'superadmin' && (
                <div>
                  <small style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Session Token Usage</small>
                  <div style={{ fontSize: 14, color: 'var(--ink)', marginTop: 4, fontWeight: 500 }}>
                    {fmtTokens(tokenTotal(tokenStats.session))} tokens
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Agent Memories Section */}
          <div className="settings-section-card" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: '24px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Brain size={18} style={{ color: 'var(--blue)' }} /> AI Agent Memories
              </h2>
              {/* Agent Selector */}
              <select
                value={selectedAgentName}
                onChange={(e) => {
                  const agent = e.target.value as any;
                  setSelectedAgentName(agent);
                  void loadAgentMemories(agent);
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--line)',
                  background: 'var(--surface-2)',
                  fontSize: 12,
                  color: 'var(--ink)',
                  cursor: 'pointer'
                }}
              >
                <option value="director">Director Agent</option>
                <option value="analytics">Analytics Agent</option>
                <option value="risk">Risk Agent</option>
                <option value="reporting">Reporting Agent</option>
                <option value="kyc">KYC / Compliance Agent</option>
                <option value="document-verification">Document Verification Agent</option>
                <option value="fraud-investigation">Fraud Investigation Agent</option>
                <option value="credit-review">Credit Review Agent</option>
                <option value="portfolio-monitor">Portfolio Monitor Agent</option>
              </select>
            </div>
            
            <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {agentMemories.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                  No persistent memories recorded for this agent.
                </div>
              ) : (
                agentMemories.map((mem) => (
                  <div key={mem.id} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', marginBottom: 4 }}>{mem.key}</div>
                      <p style={{ fontSize: 12, color: 'var(--ink)', margin: 0, lineHeight: 1.4 }}>{mem.content}</p>
                    </div>
                    <button
                      onClick={async () => {
                        await deleteAgentMemory(mem.id);
                        void loadAgentMemories(selectedAgentName);
                      }}
                      title="Forget Memory"
                      style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', padding: 2 }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--red)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Archived Sessions Section */}
          <div className="settings-section-card" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: '24px', boxShadow: 'var(--shadow-sm)' }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <History size={18} style={{ color: 'var(--blue)' }} /> Archived Sessions
            </h2>
            <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {archivedConversations.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                  No archived sessions found.
                </div>
              ) : (
                archivedConversations.map((conv) => (
                  <div key={conv.id} style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ textAlign: 'left' }}>
                      <strong style={{ fontSize: 13, color: 'var(--ink)' }}>{conv.title}</strong>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Archived on {new Date(conv.updatedAt).toLocaleDateString()}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={async () => {
                          await archiveConversation(conv.id, false);
                          void loadArchivedConversations();
                          void loadConversations();
                        }}
                        style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-soft)', fontSize: 11, cursor: 'pointer' }}
                      >
                        Restore
                      </button>
                      <button
                        onClick={async () => {
                          await deleteConversation(conv.id);
                          void loadArchivedConversations();
                        }}
                        style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--red-line)', background: 'var(--red-soft)', color: 'var(--red-bright)', fontSize: 11, cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Archived Clients Section */}
          <div className="settings-section-card" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: '24px', boxShadow: 'var(--shadow-sm)' }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Trash2 size={18} style={{ color: 'var(--red)' }} /> Archived Clients
            </h2>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 16px' }}>
              Deleted client profiles are kept here and hidden from the agents. Restore one to bring it back, or permanently delete it to remove it for good.
            </p>
            <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {archivedClients.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                  No archived clients.
                </div>
              ) : (
                archivedClients.map((client) => (
                  <div key={client.id} style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ textAlign: 'left', minWidth: 0 }}>
                      <strong style={{ fontSize: 13, color: 'var(--ink)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.name}</strong>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                        {client.industry}{client.documents.length > 0 ? ` · ${client.documents.length} document${client.documents.length !== 1 ? 's' : ''}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
                      <button
                        onClick={() => void restoreClient(client)}
                        disabled={restoringId === client.id}
                        style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--blue-line)', background: 'var(--blue-soft)', color: 'var(--blue-bright)', fontSize: 11, fontWeight: 600, cursor: restoringId === client.id ? 'default' : 'pointer', opacity: restoringId === client.id ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        {restoringId === client.id ? <LoaderCircle size={12} className="spin" /> : <History size={12} />} Restore
                      </button>
                      <button
                        onClick={() => setPurgeTarget(client)}
                        style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--red-line)', background: 'var(--red-soft)', color: 'var(--red-bright)', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Account Actions Section */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={handleLogout}
                style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--red-line)', background: 'var(--red-soft)', color: 'var(--red-bright)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                Sign Out Account
              </button>
              {user?.role === 'superadmin' && (
                <a 
                  href="/admin" 
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 13, textDecoration: 'none', fontWeight: 600 }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--red-line)'; (e.currentTarget as HTMLElement).style.color = 'var(--red)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--line)'; (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
                >
                  <Shield size={14}/> Superadmin Panel
                </a>
              )}
            </div>
            <button 
              onClick={() => setActiveTab('workspace')}
              style={{ padding: '10px 20px', borderRadius: 10, border: 0, background: 'var(--blue)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Back to Workspace
            </button>
          </div>
        </div>
      )}
    </section>
    <FloatingCalc />
    {activeTab !== 'workspace' && (anyBusy || agentDoneAway) && (
      <button
        className={`agent-float ${anyBusy ? 'running' : 'done'}`}
        onClick={() => setActiveTab('workspace')}
        title={anyBusy ? 'Agent is running — click to view' : 'Agent finished — click to view the output'}
      >
        <span className="agent-float-icon">
          {anyBusy ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}
        </span>
        <span className="agent-float-text">
          <strong>{anyBusy ? 'Agent running…' : 'Agent finished'}</strong>
          <small>
            {anyBusy
              ? (active?.name ? `Working on ${active.name}` : 'Processing your request')
              : 'Output ready — open Workspace'}
          </small>
        </span>
        {anyBusy
          ? <span className="agent-float-live" aria-hidden />
          : <ChevronRight size={17} className="agent-float-arrow" />}
      </button>
    )}
    {confirm && (
      <div className="modal-backdrop">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="confirm-card">
          <button className="choice-close" onClick={() => setConfirm(null)}><X size={16} /></button>
          <div className="scan-icon"><Activity size={24} /></div>
          <small>ORCHESTRATION TRIGGER</small>
          <h2>Scan client profile?</h2>
          <p>Do you want the agent to scan <strong>{confirm.name}</strong>'s profile and attached documents for a credit assessment?</p>
          <div className="modal-actions">
            <button onClick={() => setConfirm(null)}>No</button>
            <button className="primary" onClick={startAssessment}>Yes</button>
          </div>
        </motion.div>
      </div>
    )}

    {/* Delete Client Confirmation */}
    {deleteTarget && (
      <div className="modal-backdrop">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="confirm-card">
          <button className="choice-close" onClick={() => { if (!deleting) setDeleteTarget(null); }}><X size={16} /></button>
          <div className="scan-icon" style={{ color: 'var(--red)', background: 'var(--red-soft)' }}><Trash2 size={24} /></div>
          <small style={{ color: 'var(--red)' }}>ARCHIVE CLIENT</small>
          <h2>Delete {deleteTarget.name}?</h2>
          <p>
            <strong>{deleteTarget.name}</strong>
            {deleteTarget.documents.length > 0 && <> and its {deleteTarget.documents.length} document{deleteTarget.documents.length !== 1 ? 's' : ''}</>}
            {' '}will be moved to the archive and hidden from the agents. You can restore it — or permanently delete it — from <strong>Settings → Archived Clients</strong>.
          </p>
          {deleteError && (
            <div className="auth-error" role="alert" style={{ marginTop: 14 }}>
              <ShieldAlert size={15} /><span>{deleteError}</span>
            </div>
          )}
          <div className="modal-actions">
            <button onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
            <button
              className="primary"
              style={{ background: 'linear-gradient(135deg, var(--red), #e8736f)' }}
              onClick={() => deleteClient(deleteTarget)}
              disabled={deleting}
            >
              {deleting ? <><LoaderCircle size={15} className="spin" style={{ marginRight: 6, verticalAlign: '-2px' }} />Archiving…</> : 'Archive client'}
            </button>
          </div>
        </motion.div>
      </div>
    )}

    {/* Permanent-delete (purge) Confirmation */}
    {purgeTarget && (
      <div className="modal-backdrop">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="confirm-card">
          <button className="choice-close" onClick={() => { if (!purging) setPurgeTarget(null); }}><X size={16} /></button>
          <div className="scan-icon" style={{ color: 'var(--red)', background: 'var(--red-soft)' }}><Trash2 size={24} /></div>
          <small style={{ color: 'var(--red)' }}>PERMANENTLY DELETE</small>
          <h2>Delete {purgeTarget.name} for good?</h2>
          <p>
            This permanently removes <strong>{purgeTarget.name}</strong>
            {purgeTarget.documents.length > 0 && <> and its {purgeTarget.documents.length} document{purgeTarget.documents.length !== 1 ? 's' : ''}</>}
            {' '}from the database. This cannot be undone and it can no longer be restored.
          </p>
          <div className="modal-actions">
            <button onClick={() => setPurgeTarget(null)} disabled={purging}>Cancel</button>
            <button
              className="primary"
              style={{ background: 'linear-gradient(135deg, var(--red), #e8736f)' }}
              onClick={() => void purgeClient(purgeTarget)}
              disabled={purging}
            >
              {purging ? <><LoaderCircle size={15} className="spin" style={{ marginRight: 6, verticalAlign: '-2px' }} />Deleting…</> : 'Permanently delete'}
            </button>
          </div>
        </motion.div>
      </div>
    )}

    {/* Archived Conversations Overlay */}
    {showArchivedPanel && (
      <div className="modal-backdrop">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="confirm-card" style={{ maxWidth: 500, width: '100%' }}>
          <button className="choice-close" onClick={() => setShowArchivedPanel(false)}><X size={16} /></button>
          <div className="scan-icon"><History size={24} /></div>
          <small>ARCHIVE MANAGEMENT</small>
          <h2>Archived Conversations</h2>
          
          <div style={{ maxHeight: 300, overflowY: 'auto', margin: '20px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {archivedConversations.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>
                No archived chats.
              </div>
            ) : (
              archivedConversations.map((conv) => (
                <div key={conv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface-2)' }}>
                  <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                    <strong style={{ fontSize: 13, color: 'var(--ink)', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{conv.title}</strong>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Archived on {new Date(conv.updatedAt).toLocaleString()}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginLeft: 12 }}>
                    <button 
                      onClick={() => void archiveConversation(conv.id, false)}
                      style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 11, cursor: 'pointer', transition: 'all .1s' }}
                    >
                      Restore
                    </button>
                    <button 
                      onClick={() => void deleteConversation(conv.id)}
                      style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--red-line)', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--red)', fontSize: 11, cursor: 'pointer', transition: 'all .1s' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          
          <div className="modal-actions" style={{ justifyContent: 'flex-end' }}>
            <button onClick={() => setShowArchivedPanel(false)}>Close</button>
          </div>
        </motion.div>
      </div>
    )}

    {/* Agent Memories Inspector Overlay */}
    {showLearningsPanel && (
      <div className="modal-backdrop">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="confirm-card" style={{ maxWidth: 600, width: '100%' }}>
          <button className="choice-close" onClick={() => setShowLearningsPanel(false)}><X size={16} /></button>
          <div className="scan-icon"><Brain size={24} /></div>
          <small>AI KNOWLEDGE BASE</small>
          <h2>Agent Learnings & Memories</h2>
          
          {/* Agent Switcher Tabs */}
          <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--line)', paddingBottom: 10, margin: '14px 0' }}>
            {(['director', 'analytics', 'risk', 'reporting'] as const).map((agentName) => (
              <button
                key={agentName}
                onClick={() => { setSelectedAgentName(agentName); void loadAgentMemories(agentName); }}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid ' + (selectedAgentName === agentName ? 'var(--blue)' : 'var(--line)'),
                  background: selectedAgentName === agentName ? 'rgba(79, 140, 255, 0.1)' : 'transparent',
                  color: selectedAgentName === agentName ? 'var(--text)' : 'var(--muted)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                  transition: 'all .12s'
                }}
              >
                {agentName}
              </button>
            ))}
          </div>

          <div style={{ maxHeight: 300, overflowY: 'auto', margin: '10px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {agentMemories.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '30px 0' }}>
                No persistent learnings found for this agent.
              </div>
            ) : (
              agentMemories.map((mem) => (
                <div key={mem.id} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface-2)', position: 'relative' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase' }}>{mem.key}</span>
                    <button
                      onClick={() => void deleteAgentMemory(mem.id)}
                      title="Forget Memory"
                      style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', padding: 2, display: 'grid', placeItems: 'center' }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--red)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text)', margin: 0, lineHeight: '1.4', textAlign: 'left' }}>{mem.content}</p>
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 6, textAlign: 'right' }}>Learned on {new Date(mem.updatedAt).toLocaleDateString()}</div>
                </div>
              ))
            )}
          </div>

          <div className="modal-actions" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button onClick={() => setShowLearningsPanel(false)}>Close</button>
          </div>
        </motion.div>
      </div>
    )}

    {/* Floating Clients Button & Dropdown */}
    <button 
      onClick={() => setShowFloatingClients(!showFloatingClients)}
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 18px',
        borderRadius: '999px',
        background: 'linear-gradient(135deg, var(--red), var(--blue))',
        color: '#ffffff',
        border: 'none',
        boxShadow: '0 8px 30px rgba(79, 140, 255, 0.4)',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(79, 140, 255, 0.6)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 8px 30px rgba(79, 140, 255, 0.4)'; }}
    >
      <Users size={16} /> Clients
    </button>

    {showFloatingClients && (
      <div 
        style={{
          position: 'fixed',
          bottom: '80px',
          right: '24px',
          zIndex: 1000,
          width: '320px',
          borderRadius: '16px',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow-lg)',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--muted)' }}>SELECT CLIENT PROFILE</span>
          <button 
            onClick={() => { setActiveTab('new-client'); setShowFloatingClients(false); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: 'var(--blue)',
              background: 'none',
              border: 'none',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <Plus size={11} /> New
          </button>
        </div>

        {/* Client Search */}
        <input 
          value={clientSearch}
          onChange={(e) => setClientSearch(e.target.value)}
          placeholder="Search clients..."
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid var(--line)',
            background: 'var(--surface-2)',
            fontSize: '12px',
            color: 'var(--ink)'
          }}
        />

        {/* Client List */}
        <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {clients.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase())).length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, padding: '20px 0' }}>
              No clients found
            </div>
          ) : (
            clients.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase())).map((c) => (
              <button
                key={c.id}
                onClick={() => { handleSelectClientFromFloating(c); setShowFloatingClients(false); }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid transparent',
                  background: active?.id === c.id ? 'var(--blue-soft)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10
                }}
                onMouseEnter={(e) => { if (active?.id !== c.id) e.currentTarget.style.background = 'var(--surface-2)'; }}
                onMouseLeave={(e) => { if (active?.id !== c.id) e.currentTarget.style.background = 'transparent'; }}
              >
                <Building2 size={13} style={{ color: active?.id === c.id ? 'var(--blue)' : 'var(--muted)' }} />
                <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--ink)' }}>{c.name}</span>
              </button>
            ))
          )}
        </div>
      </div>
    )}
  </main>;
}

/* ══════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════ */

// Count-up on mount for stat values. Honors prefers-reduced-motion (snaps to final).
function CountUp({ value, duration = 900, suffix = '' }: { value: number; duration?: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return;
    }
    if (value === 0) { setDisplay(0); return; }
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{display}{suffix}</>;
}

// Staggered section entrance variants reused across the standalone views.
const dashSection = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { duration: 0.4, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] as const } }),
};

function DashboardView({ clients, assessmentCount, successCount, runHistory, onSelectClient, onNewClient, onOpenWorkspace }: {
  clients: Client[];
  assessmentCount: number;
  successCount: number;
  runHistory: RunRecord[];
  onSelectClient: (client: Client) => void;
  onNewClient: () => void;
  onOpenWorkspace: () => void;
}) {
  const totalRuns = runHistory.length;
  const clientsWithDocs = clients.filter((client) => client.documents.length > 0).length;
  const clientsWithContact = clients.filter((client) => client.email || client.phone || client.contactName).length;
  const totalDocuments = clients.reduce((sum, client) => sum + client.documents.length, 0);
  const readyRate = clients.length ? Math.round((clientsWithDocs / clients.length) * 100) : 0;
  const contactRate = clients.length ? Math.round((clientsWithContact / clients.length) * 100) : 0;
  const successRate = assessmentCount ? Math.round((successCount / assessmentCount) * 100) : 0;
  const latestRun = runHistory[0];
  const readyClients = clients.filter((client) => client.documents.length > 0).slice(0, 5);
  const needsDocuments = clients.filter((client) => client.documents.length === 0).slice(0, 4);

  return (
    <div className="dashboard">
      <motion.div className="dashboard-hero" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
        <div>
          <small>PORTFOLIO COMMAND CENTER</small>
          <h2>Overview</h2>
          <p>Track profile readiness, document coverage, and recent underwriting activity.</p>
        </div>
        <div className="dashboard-hero-actions">
          <button className="action-secondary" onClick={onNewClient}><UserPlus size={14}/> New Client</button>
          <button className="action-primary" onClick={onOpenWorkspace}><Brain size={14}/> Workspace</button>
        </div>
      </motion.div>

      {/* Stat cards */}
      <div className="stat-grid">
        {[
          { tone: 'red',  icon: <Building2 size={18}/>,     label: 'Clients',        value: clients.length,   sub: 'loaded profiles' },
          { tone: 'red',  icon: <FileText size={18}/>,      label: 'Ready Profiles', value: clientsWithDocs,   sub: `${readyRate}% with documents` },
          { tone: 'blue', icon: <Database size={18}/>,      label: 'Documents',      value: totalDocuments,    sub: 'attached files' },
          { tone: 'blue', icon: <ClipboardCheck size={18}/>,label: 'Assessments',    value: assessmentCount,   sub: `${successRate}% success rate` },
        ].map((s, i) => (
          <motion.div key={s.label} className={`stat-card ${s.tone}`} custom={i} variants={dashSection} initial="hidden" animate="show">
            <div className={`stat-icon ${s.tone}`}>{s.icon}</div>
            <div>
              <div className={`stat-label ${s.tone}`}>{s.label}</div>
              <div className={`stat-value ${s.tone}`}><CountUp value={s.value}/></div>
              <div className={`stat-sub ${s.tone}`}>{s.sub}</div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="dashboard-insights">
        <motion.section className="insight-card primary" custom={4} variants={dashSection} initial="hidden" animate="show">
          <div className="insight-head">
            <span><TrendingUp size={16}/></span>
            <div>
              <strong>Portfolio Readiness</strong>
              <small>{clients.length ? `${readyRate}% ready for agent review` : 'No portfolio loaded yet'}</small>
            </div>
          </div>
          <div className="readiness-stack">
            {[
              { label: 'Document coverage', pct: readyRate },
              { label: 'Contact completeness', pct: contactRate },
              { label: 'Assessment success', pct: successRate },
            ].map((r, i) => (
              <div className="readiness-row" key={r.label}>
                <span>{r.label}</span>
                <strong><CountUp value={r.pct} suffix="%"/></strong>
                <i><motion.b initial={{ width: 0 }} animate={{ width: `${r.pct}%` }} transition={{ duration: 0.9, delay: 0.2 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}/></i>
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section className="insight-card" custom={5} variants={dashSection} initial="hidden" animate="show">
          <div className="insight-head">
            <span><Activity size={16}/></span>
            <div>
              <strong>Latest Activity</strong>
              <small>{latestRun ? new Date(latestRun.timestamp).toLocaleString() : 'No runs recorded'}</small>
            </div>
          </div>
          {latestRun ? (
            <div className="latest-run-card">
              <strong>{latestRun.clientName}</strong>
              <span>{latestRun.mode} · {latestRun.success ? 'completed' : latestRun.mode === 'stopped' ? 'stopped' : 'needs review'}</span>
            </div>
          ) : (
            <p className="insight-empty">Run a quick overview or full assessment to start building the audit trail.</p>
          )}
        </motion.section>

        <motion.section className="insight-card" custom={6} variants={dashSection} initial="hidden" animate="show">
          <div className="insight-head">
            <span><ShieldAlert size={16}/></span>
            <div>
              <strong>Needs Attention</strong>
              <small>{needsDocuments.length ? `${needsDocuments.length} profile${needsDocuments.length === 1 ? '' : 's'} missing documents` : 'No immediate gaps'}</small>
            </div>
          </div>
          {needsDocuments.length ? (
            <div className="attention-list">
              {needsDocuments.map((client) => (
                <button key={client.id} onClick={() => onSelectClient(client)}>{client.name}<ChevronRight size={13}/></button>
              ))}
            </div>
          ) : (
            <p className="insight-empty">Profiles with files are ready for review from the workspace.</p>
          )}
        </motion.section>
      </div>

      <div className="dash-body">
        {/* Client profiles */}
        <div className="dash-section red">
          <div className="dash-section-head red">
            <strong><Building2 size={13}/> Ready Client Queue</strong>
            <span>{readyClients.length} shown</span>
          </div>
          {clients.length === 0 ? (
            <div className="dashboard-empty">
              <Building2 size={22}/>
              <strong>No clients yet</strong>
              <p>Create a client profile with supporting files to start the underwriting flow.</p>
              <button className="clients-new-btn" onClick={onNewClient}><UserPlus size={14}/> New Client</button>
            </div>
          ) : readyClients.length === 0 ? (
            <div className="dashboard-empty">
              <FileText size={22}/>
              <strong>Attach documents</strong>
              <p>Client profiles exist, but none have documents attached yet.</p>
            </div>
          ) : (
            <div className="run-list">
            {readyClients.map((client) => (
              <button
                key={client.id}
                className="run-item dashboard-client-row"
                onClick={() => onSelectClient(client)}
              >
                <span className="run-dot success"/>
                <div className="run-info">
                  <strong>{client.name}</strong>
                  <small>{client.industry} · {client.contactName ?? 'No contact'} · {client.documents.length} file{client.documents.length !== 1 ? 's' : ''}</small>
                </div>
                <div className="run-meta">
                  <div className="run-tokens">{client.documents.length} files</div>
                </div>
              </button>
            ))}
            </div>
          )}
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
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>

        <div className="dash-section blue" style={{ gridColumn: '1 / -1' }}>
          <div className="dash-section-head blue">
            <strong><Layers size={13}/> Next Best Actions</strong>
            <span>workflow guidance</span>
          </div>
          <div className="next-action-grid">
            <button onClick={onNewClient}>
              <span><UserPlus size={16}/></span>
              <strong>Create client profile</strong>
              <small>Add borrower/contact details and financial documents.</small>
            </button>
            <button onClick={onOpenWorkspace}>
              <span><Brain size={16}/></span>
              <strong>Open workspace</strong>
              <small>Review sessions, ask the Director agent, or run analysis.</small>
            </button>
            <button onClick={() => readyClients[0] ? onSelectClient(readyClients[0]) : onNewClient()}>
              <span><CheckCircle2 size={16}/></span>
              <strong>Review ready profile</strong>
              <small>{readyClients[0] ? `Start with ${readyClients[0].name}.` : 'Attach documents to unlock reviews.'}</small>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   SIDEBAR CLIENT LIST
══════════════════════════════════════════════ */
function SidebarClientList({ clients, activeId, onSelect, onNew }: {
  clients: Client[];
  activeId?: string;
  onSelect: (client: Client) => void;
  onNew: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div className="sidebar-label">
        <span>CLIENTS</span>
        <button
          onClick={onNew}
          style={{ background: 'none', border: 0, color: 'var(--red)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600 }}
        >
          <UserPlus size={11} /> New
        </button>
      </div>
      <div className="client-list" style={{ overflowY: 'auto', flex: 1 }}>
        {clients.length === 0 ? (
          <div style={{ padding: '14px 8px', color: 'var(--muted)', fontSize: 12, textAlign: 'center' }}>
            No clients yet
          </div>
        ) : (
          clients.map((client) => (
            <button
              key={client.id}
              className={`client-tab${client.id === activeId ? ' active' : ''}`}
              onClick={() => onSelect(client)}
            >
              <span><Building2 size={14} /></span>
              <div>
                <strong>{client.name}</strong>
                <small>{client.industry}</small>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   FLOATING DTI CALCULATOR
══════════════════════════════════════════════ */
function FloatingCalc() {
  const [open, setOpen] = useState(false);
  const [grossIncome, setGrossIncome] = useState('');
  const [monthlyDebt, setMonthlyDebt] = useState('');

  const dti = useMemo(() => {
    const income = parseFloat(grossIncome);
    const debt = parseFloat(monthlyDebt);
    if (!income || !debt || income <= 0) return null;
    return (debt / income) * 100;
  }, [grossIncome, monthlyDebt]);

  const dtiStatus = useMemo(() => {
    if (dti === null) return null;
    if (dti <= 35) return { label: 'Low Risk', color: 'var(--green)' };
    if (dti <= 45) return { label: 'Medium Risk', color: 'var(--amber)' };
    return { label: 'High Risk / Decline', color: 'var(--red)' };
  }, [dti]);

  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
      {open && (
        <div className="float-calc-popup">
          <div className="float-calc-header">
            <span>DTI Calculator</span>
            <button onClick={() => setOpen(false)}><X size={14} /></button>
          </div>
          <div className="sidebar-calc">
            <div className="calc-input-group">
              <label>Gross Income ($/mo)</label>
              <input
                type="number"
                placeholder="e.g. 10000"
                value={grossIncome}
                onChange={(e) => setGrossIncome(e.target.value)}
              />
            </div>
            <div className="calc-input-group">
              <label>Monthly Debt ($/mo)</label>
              <input
                type="number"
                placeholder="e.g. 3000"
                value={monthlyDebt}
                onChange={(e) => setMonthlyDebt(e.target.value)}
              />
            </div>
            {dti !== null && (
              <div className="calc-result" style={{ borderColor: dtiStatus?.color + '44', background: dtiStatus?.color + '0a' }}>
                <div className="result-value" style={{ color: dtiStatus?.color }}>
                  <strong>{dti.toFixed(1)}%</strong>
                  <small>Debt-to-Income</small>
                </div>
                <div className="result-badge" style={{ backgroundColor: dtiStatus?.color, color: '#fff' }}>
                  {dtiStatus?.label}
                </div>
              </div>
            )}
            {(grossIncome || monthlyDebt) && (
              <button
                onClick={() => { setGrossIncome(''); setMonthlyDebt(''); }}
                style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, fontSize: 10, color: 'var(--muted)', cursor: 'pointer', padding: '4px 8px' }}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}
      <button
        className={`float-calc-btn${open ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="DTI Calculator"
      >
        <Calculator size={16} />
        <span>DTI Calc</span>
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════
   CLIENT PROFILES TAB (searchable, full detail)
══════════════════════════════════════════════ */
function ClientsView({ clients, search, setSearch, viewing, setViewing, activeId, onOverview, onHandoff, onOpen, onNew, onDelete }: {
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
  onDelete: (client: Client) => void;
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
        <ClientDetail client={current} activeId={activeId} onBack={() => setViewing(null)} onOverview={onOverview} onHandoff={onHandoff} onOpen={onOpen} onDelete={onDelete}/>
      ) : filtered.length === 0 ? (
        <div className="clients-empty">
          <Users size={30}/>
          <strong>{query ? 'No clients match your search' : 'No client profiles yet'}</strong>
          <p>{query ? 'Try a different name, industry, or contact.' : 'Create your first client profile to get started.'}</p>
          {!query && <button className="clients-new-btn" onClick={onNew}><UserPlus size={15}/> Create a client</button>}
        </div>
      ) : (
        <div className="client-grid">
          {filtered.map((client, i) => {
            const financials = parseFinancials(client.data);
            return (
              <motion.div
                key={client.id}
                className="client-card-wrap"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, delay: Math.min(i * 0.04, 0.4), ease: [0.22, 1, 0.36, 1] }}
              >
                <button
                  className="client-card-delete"
                  title={`Delete ${client.name}`}
                  aria-label={`Delete ${client.name}`}
                  onClick={(e) => { e.stopPropagation(); onDelete(client); }}
                >
                  <Trash2 size={15}/>
                </button>
                <button className={`client-card ${activeId === client.id ? 'active' : ''}`} onClick={() => setViewing(client)}>
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
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ClientDetail({ client, activeId, onBack, onOverview, onHandoff, onOpen, onDelete }: {
  client: Client;
  activeId?: string;
  onBack: () => void;
  onOverview: (client: Client) => void;
  onHandoff: (client: Client) => void;
  onOpen: (client: Client) => void;
  onDelete: (client: Client) => void;
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
          <small>CONTACT & CHANNELS</small>
          <div className="detail-row"><User size={14}/><span>{client.contactName || 'No contact name'}</span></div>
          <div className="detail-row"><Mail size={14}/><span>{client.email || 'No email'}</span></div>
          <div className="detail-row"><Phone size={14}/><span>{client.phone || 'No phone'}</span></div>
          {client.webhookUrl && <div className="detail-row"><Zap size={14}/><span>Webhook: {client.webhookUrl}</span></div>}
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
        <button className="action-danger" onClick={() => onDelete(client)}><Trash2 size={15}/> Delete</button>
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

// Human-readable status labels for each WorkflowAgent.status value.
const AGENT_STATUS_LABEL: Record<WorkflowAgent['status'], string> = {
  idle: 'Idle',
  queued: 'Queued',
  running: 'Running',
  streaming: 'Streaming',
  complete: 'Complete',
  fallback: 'Fallback',
  error: 'Error',
  stopped: 'Stopped',
};

function AgentNodeIcon({ status }: { status: WorkflowAgent['status'] }) {
  if (status === 'complete') return <CheckCircle2 size={15}/>;
  if (status === 'running' || status === 'streaming') return <LoaderCircle className="spin" size={15}/>;
  if (status === 'error') return <ShieldAlert size={15}/>;
  if (status === 'stopped') return <Square size={13}/>;
  if (status === 'queued') return <ChevronDown size={15}/>;
  return <Activity size={15}/>;
}

function WorkflowBoard({ workflow, onRunAgent, disabled }: { workflow: Record<AgentName, WorkflowAgent>; onRunAgent: (agent: AgentName) => void; disabled: boolean }) {
  const present = (list: AgentName[]) => list.filter((a) => workflow[a]);
  const reasoning = present(REASONING_AGENTS);
  const automated = present(AUTO_AGENTS);
  const agents = [...reasoning, ...automated];
  // Pipeline progress: share of stages that have completed (director excluded from the count).
  const stages = agents.filter((a) => a !== 'director');
  const done = stages.filter((a) => workflow[a].status === 'complete').length;
  const anyActive = agents.some((a) => workflow[a].status === 'running' || workflow[a].status === 'streaming');
  const pct = stages.length ? Math.round((done / stages.length) * 100) : 0;

  const renderAgent = (agent: AgentName) => {
    const item = workflow[agent];
    const auto = isAutoAgent(agent);
    const isRunning = item.status === 'running' || item.status === 'streaming';
    const idle = item.status === 'idle';
    return (
      <motion.div layout className={`workflow-agent ${item.status} ${auto ? 'is-auto' : ''}`} key={agent}>
        <div className="workflow-agent-rail" aria-hidden="true">
          <div className="workflow-agent-node">
            <AgentNodeIcon status={item.status}/>
            <AnimatePresence>
              {item.status === 'complete' && (
                <motion.span
                  className="workflow-agent-check"
                  initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                >
                  <CheckCircle2 size={9}/>
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
        <div className="workflow-agent-body">
          <div className="workflow-agent-head">
            <div className="workflow-agent-title">
              <strong>{title(agent)}{auto && <span className="workflow-agent-codetag" title="Runs as deterministic code — no model call">code</span>}</strong>
              <span className="workflow-agent-status">
                <i/>{isRunning && !auto && item.model ? item.model : AGENT_STATUS_LABEL[item.status]}
              </span>
            </div>
            {!isRunning && (
              <button
                type="button"
                className="workflow-agent-run"
                disabled={disabled}
                onClick={() => onRunAgent(agent)}
              >
                Run
              </button>
            )}
          </div>
          {idle && <p className="workflow-agent-task">{item.task}</p>}
          {item.output && (
            <motion.blockquote initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              <Markdown>{item.output}</Markdown>
            </motion.blockquote>
          )}
          {item.durationMs !== undefined && <em className="workflow-agent-dur">{item.durationMs} ms</em>}
        </div>
      </motion.div>
    );
  };

  return <section className="workflow-board">
    <div className="panel-heading"><Layers size={13}/> Agent workflow</div>
    <div className={`workflow-board-progress ${anyActive ? 'live' : ''}`} aria-hidden="true">
      <motion.i initial={false} animate={{ width: `${anyActive && pct === 0 ? 6 : pct}%` }} transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}/>
    </div>

    <div className="workflow-group-label"><span>Reasoning pipeline</span><small>runs in sequence</small></div>
    <div className="workflow-pipeline">
      {reasoning.map(renderAgent)}
    </div>

    {automated.length > 0 && (
      <>
        <div className="workflow-group-label"><span>Automated checks</span><small>instant · run as code</small></div>
        <div className="workflow-pipeline is-auto-group">
          {automated.map(renderAgent)}
        </div>
      </>
    )}
  </section>;
}

/* ══════════════════════════════════════════════
   STARTER PROMPTS — shown at conversation start
══════════════════════════════════════════════ */
function StarterPrompts({ clients, onSend }: { clients: Client[]; onSend: (text: string) => void }) {
  const clientPrompts = clients.slice(0, 2).flatMap((c) => [
    `Run a full credit assessment for ${c.name}`,
    `Give me a quick overview of ${c.name}`,
  ]);

  const genericPrompts = [
    'What financial metrics do you use to determine credit risk?',
    'How do you calculate the debt-to-income ratio?',
    'What does a Tier A credit rating mean?',
    'How do I add a new client profile?',
  ];

  const prompts = clientPrompts.length >= 2
    ? [...clientPrompts.slice(0, 2), ...genericPrompts.slice(0, 2)]
    : genericPrompts.slice(0, 4);

  return (
    <div className="starter-prompts">
      <p className="starter-label"><Sparkles size={13}/> Suggested prompts — click to send</p>
      <div className="starter-grid">
        {prompts.map((text) => (
          <button key={text} className="starter-chip" onClick={() => onSend(text)}>
            <ChevronRight size={13} className="starter-chip-icon"/>
            <span>{text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   SUGGESTION CHIPS — shown after agent responses
══════════════════════════════════════════════ */
function SuggestionChips({ suggestions, onSelect }: { suggestions: string[]; onSelect: (text: string) => void }) {
  return (
    <div className="suggestion-chips">
      {suggestions.map((s) => (
        <button key={s} className="suggestion-chip" onClick={() => onSelect(s)}>
          <ChevronRight size={12}/>
          {s}
        </button>
      ))}
    </div>
  );
}

// Background agent activity rendered inline in the conversation as transparent
// trace bubbles — toggled on/off, the way typical AI chats surface tool activity.
function InlineBackroom({ items }: { items: BackroomItem[] }) {
  const shown = items.slice(-24);
  return <div className="inline-backroom">
    <div className="inline-backroom-head"><MessagesSquare size={13}/> Background activity<span>{items.length ? `${items.length} events` : 'waiting'}</span></div>
    {shown.length ? (
      <div className="inline-backroom-feed">
        <AnimatePresence initial={false}>
          {shown.map((item) => (
            <motion.div
              layout
              key={item.id}
              className={`inline-event ${item.type.replace(/[_.]/g, '-')}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="inline-event-meta"><strong>{title(item.agent)}</strong><small>{item.type}{item.target ? ` → ${item.target}` : ''}{item.model ? ` · ${item.model}` : ''}</small></div>
              {(item.content || item.type === 'token stream') && <p>{item.content || 'Working…'}</p>}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    ) : <p className="inline-empty">No agent traffic yet. Choose a client action or ask the Director something.</p>}
  </div>;
}

function WorkspaceSessionsPanel({
  conversations,
  activeConversationId,
  runningConversationIds,
  onNew,
  onSelect,
  onArchive,
}: {
  conversations: any[];
  activeConversationId: string | null;
  runningConversationIds: Set<string>;
  onNew: () => void;
  onSelect: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  return (
    <section className="workspace-sessions-panel">
      <div className="panel-heading"><MessagesSquare size={13}/> Conversations <span>{conversations.length}</span></div>
      <button className="workspace-new-session" onClick={onNew}>
        <Plus size={15}/> New Session
      </button>
      <div className="workspace-session-list">
        {conversations.length === 0 ? (
          <p className="workspace-session-empty">No recent sessions yet.</p>
        ) : conversations.map((conv) => {
          const isActive = conv.id === activeConversationId;
          const isRunning = runningConversationIds.has(conv.id);
          return (
            <div
              key={conv.id}
              role="button"
              tabIndex={0}
              className={`workspace-session-row ${isActive ? 'active' : ''} ${isRunning ? 'running' : ''}`}
              onClick={() => onSelect(conv.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(conv.id);
                }
              }}
            >
              <span className="workspace-session-icon">{isRunning ? <LoaderCircle size={14} className="spin"/> : <MessagesSquare size={14}/>}</span>
              <span className="workspace-session-copy">
                <strong>{conv.title || 'Untitled Session'}</strong>
                <small>{isRunning ? 'Agent running…' : new Date(conv.updatedAt).toLocaleString()}</small>
              </span>
              <button
                type="button"
                className="workspace-session-archive"
                title="Archive session"
                onClick={(event) => {
                  event.stopPropagation();
                  onArchive(conv.id);
                }}
              >
                <X size={12}/>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════
   NEW CLIENT TAB (creation form)
══════════════════════════════════════════════ */
function NewClientForm({ onCancel, onCreate }: { onCancel: () => void; onCreate: (client: Client) => void | Promise<void> }) {
  const [name, setName] = useState(''); const [industry, setIndustry] = useState(''); const [contactName, setContactName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [data, setData] = useState(''); const [documents, setDocuments] = useState<ClientDocument[]>([]);
  const [saving, setSaving] = useState(false);
  // Generate the client id ONCE per form instance so re-submits upsert the same row (idempotent)
  // instead of creating a new client every click.
  const clientId = useRef(crypto.randomUUID());
  const valid = useMemo(() => name.trim() && (data.trim() || documents.length), [name, data, documents]);
  async function readFiles(files?: FileList | null) { if (!files) return; const parsed = await Promise.all(Array.from(files).map(readDocument)); setDocuments((current) => [...current, ...parsed]); }
  async function submit() {
    if (!valid || saving) return; // guard against double-submit
    setSaving(true);
    try {
      await onCreate({ id: clientId.current, name: name.trim(), industry: industry.trim() || 'Uncategorized', contactName, email, phone, data, documents });
    } catch {
      setSaving(false); // re-enable so the user can retry; success navigates away
    }
  }
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
          <button className="action-secondary" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="create-button" disabled={!valid || saving} onClick={submit}>
            {saving ? <><LoaderCircle size={15} className="spin" style={{ marginRight: 6, verticalAlign: '-2px' }} />Creating…</> : 'Create profile'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ── */
// Parse SUGGEST:::["...","..."] from agent message, return clean content + suggestions array
function parseSuggestions(raw: string): { content: string; suggestions: string[] } {
  const idx = raw.indexOf('\nSUGGEST:::');
  if (idx === -1) return { content: raw.trim(), suggestions: [] };
  try {
    const jsonPart = raw.slice(idx + '\nSUGGEST:::'.length).trim().split('\n')[0];
    const suggestions: string[] = JSON.parse(jsonPart);
    return { content: raw.slice(0, idx).trim(), suggestions: Array.isArray(suggestions) ? suggestions : [] };
  } catch {
    return { content: raw.slice(0, idx).trim(), suggestions: [] };
  }
}
function isAbortError(error: unknown): boolean { return error instanceof DOMException ? error.name === 'AbortError' : error instanceof Error && error.name === 'AbortError'; }
function title(value: string): string {
  return value
    .split(/[-_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
function isAgent(value: string): value is AgentName {
  return [
    'director',
    'analytics',
    'risk',
    'reporting',
    'kyc',
    'document-verification',
    'fraud-investigation',
    'credit-review',
    'portfolio-monitor',
  ].includes(value);
}
function fmtTokens(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
function buildConversationTitle(client: Client | null, firstMessage?: string): string {
  const source = (firstMessage || '').replace(/\*\*/g, '').trim();
  const withoutClientPrefix = source.replace(/^selected client:\s*/i, '').trim();
  const compact = withoutClientPrefix
    .replace(/\s+/g, ' ')
    .replace(/[?.!,;:]+$/g, '')
    .slice(0, 72)
    .trim();
  if (client) {
    const normalized = compact.toLowerCase();
    if (!compact || normalized === client.name.toLowerCase() || normalized.includes('review profile')) {
      return `${client.name} - Client Review`;
    }
    const topic = compact
      .replace(new RegExp(client.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '')
      .replace(/\b(for|of|about|the|a|an)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return topic ? `${client.name} - ${toTitleCase(topic)}` : `${client.name} - Client Review`;
  }
  return compact ? toTitleCase(compact) : `New Chat ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
function toTitleCase(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => word.length <= 3 && /^[A-Z0-9]+$/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// Build the overview-card data from the Director's overview message (bullets).
function buildOverviewFromEve(client: Client, message: string): ClientOverview {
  const lines = message.split('\n').map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^[-*•]/.test(l)).map((l) => l.replace(/^[-*•]\s*/, ''));
  const highlights = (bullets.length ? bullets : lines).slice(0, 6);
  return {
    client: { name: client.name, industry: client.industry, contactName: client.contactName ?? '', email: client.email ?? '', phone: client.phone ?? '' },
    documents: client.documents.map((d) => ({ name: d.name, type: d.type, extractedChars: 0 })),
    snapshot: [],
    highlights,
    nextSteps: [],
  };
}

function summarizeEveOutput(output: unknown): string {
  if (output == null) return '';
  try { const s = typeof output === 'string' ? output : JSON.stringify(output); return s.length > 600 ? `${s.slice(0, 600)}…` : s; } catch { return String(output); }
}

// Eve emits subagent.completed output as a JSON string; parse it to an object.
function coerceEveOutput(output: unknown): any {
  if (typeof output === 'string') { try { return JSON.parse(output); } catch { return output; } }
  return output;
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

// Send the client's documents to the backend's code-level extractor and get
// back the financial fields. No model tokens are spent reading documents.
async function extractDocumentData(client: Client): Promise<Record<string, number> | null> {
  if (!client.documents.length) return null;
  const token = typeof window !== 'undefined' ? localStorage.getItem('rfm-auth-token') : null;
  try {
    const res = await fetch(`${API_BASE}/api/documents/extract`, {
      method: 'POST',
      headers: { 
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ documents: client.documents.map((d) => ({ name: d.name, type: d.type, content: d.content, encoding: d.encoding })) }),
    });
    if (!res.ok) return null;
    const result = await res.json();
    return result && typeof result.fields === 'object' ? result.fields : null;
  } catch { return null; }
}

function safeParse(data: string): Record<string, unknown> {
  try { const o = JSON.parse(data || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}

async function saveClient(client: Client): Promise<Client | null> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('rfm-auth-token') : null;
  try {
    const response = await fetch(`${API_BASE}/api/clients`, { 
      method: 'POST', 
      headers: { 
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }, 
      body: JSON.stringify(client) 
    });
    if (!response.ok) return null;
    const saved = await response.json();
    return saved ? mapPersistedClient(saved) : null;
  } catch { return null; }
}

function mapPersistedClient(record: any): Client {
  return {
    id: record.id, name: record.name, industry: record.industry || 'Uncategorized',
    contactName: record.contactName, email: record.email, phone: record.phone,
    webhookUrl: record.webhookUrl,
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

function isDbClient(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
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

/* ══════════════════════════════════════════════
   AUTHENTICATION GATE (LOGIN & SIGNUP)
   ══════════════════════════════════════════════ */
function AuthGate({ 
  onSuccess 
}: { 
  onSuccess: (token: string, user: { id: string; email: string; name?: string; role?: string }) => void 
}) {
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required');
      return;
    }
    if (isSignup && !name.trim()) {
      setError('Name is required');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const endpoint = isSignup ? '/api/auth/signup' : '/api/auth/login';
      const body = isSignup ? { email, password, name } : { email, password };
      
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.token && data.user) {
        localStorage.setItem('rfm-auth-token', data.token);
        onSuccess(data.token, data.user);
      } else {
        setError(data.message || 'Authentication failed');
      }
    } catch (err) {
      setError('Could not connect to the authentication server');
    } finally {
      setLoading(false);
    }
  }

  function switchMode(signup: boolean) {
    setIsSignup(signup);
    setError('');
  }

  return (
    <div className="auth-shell">
      {/* ── Left: immersive brand panel ── */}
      <aside className="auth-aside">
        <div className="auth-aside-inner">
          <div className="auth-logo">
            <div className="brand-mark"><Brain size={22} /></div>
            <div>
              <strong>RFM Credit AI</strong>
              <small>Underwriting Suite</small>
            </div>
          </div>

          <div className="auth-hero">
            <h1 className="auth-headline">
              Corporate credit decisions,<br /><em>scored by AI agents.</em>
            </h1>
            <p className="auth-sub">
              Run a full underwriting workflow — analytics, risk, KYC and reporting —
              in one place, with an auditable decision trail on every call.
            </p>
          </div>

          <ul className="auth-features">
            {[
              { icon: <TrendingUp size={16} />, title: 'Deterministic scoring', sub: 'DSCR, liquidity & leverage on a 300–850 scale.' },
              { icon: <ShieldCheck size={16} />, title: 'KYC & beneficial-owner screening', sub: 'Sanctions, PEP and ownership-gap checks built in.' },
              { icon: <ClipboardCheck size={16} />, title: 'Adverse-action ready', sub: 'Reason codes and a hashed audit trail for every decision.' },
            ].map((f, i) => (
              <motion.li
                className="auth-feature"
                key={f.title}
                initial={{ opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.45, delay: 0.25 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
              >
                <span>{f.icon}</span>
                <div>
                  <strong>{f.title}</strong>
                  <small>{f.sub}</small>
                </div>
              </motion.li>
            ))}
          </ul>

          <div className="auth-aside-foot">
            <span><i /> Agents online</span>
            <span>ECOA / Reg B aligned</span>
          </div>
        </div>
      </aside>

      {/* ── Right: clean full-height form ── */}
      <main className="auth-main">
        <motion.div className="auth-main-inner" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
          <div className="auth-logo auth-logo-mobile">
            <div className="brand-mark"><Brain size={20} /></div>
            <div>
              <strong>RFM Credit AI</strong>
              <small>Underwriting Suite</small>
            </div>
          </div>

          <div className="auth-switch" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              aria-selected={!isSignup}
              className={!isSignup ? 'active' : ''}
              onClick={() => switchMode(false)}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isSignup}
              className={isSignup ? 'active' : ''}
              onClick={() => switchMode(true)}
            >
              Create Account
            </button>
          </div>

          <div className="auth-heading">
            <h2 className="auth-title">{isSignup ? 'Create your account' : 'Welcome back'}</h2>
            <p className="auth-desc">
              {isSignup
                ? 'Register a new underwriter profile to start scoring clients.'
                : 'Sign in to access client profiles and run AI credit scoring.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            {isSignup && (
              <div className="auth-field">
                <label htmlFor="auth-name">Full name</label>
                <div className="auth-input-wrap">
                  <User size={17} className="lead-icon" />
                  <input
                    id="auth-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Lee"
                    autoComplete="name"
                  />
                </div>
              </div>
            )}

            <div className="auth-field">
              <label htmlFor="auth-email">Email address</label>
              <div className="auth-input-wrap">
                <Mail size={17} className="lead-icon" />
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="underwriter@rfm.com"
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="auth-password">Password</label>
              <div className="auth-input-wrap">
                <Lock size={17} className="lead-icon" />
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                />
                <button
                  type="button"
                  className="auth-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="auth-error" role="alert">
                <ShieldAlert size={15} />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" disabled={loading} className="auth-submit">
              {loading ? (
                <><LoaderCircle size={17} className="spin" /> Processing…</>
              ) : (
                <>{isSignup ? 'Create account' : 'Sign in'} <ArrowRight size={17} /></>
              )}
            </button>
          </form>

          <p className="auth-alt">
            {isSignup ? 'Already have an account? ' : 'New to RFM? '}
            <button type="button" onClick={() => switchMode(!isSignup)}>
              {isSignup ? 'Sign in' : 'Create one'}
            </button>
          </p>

          <p className="auth-legal">
            Protected workspace · Corporate credit underwriting
          </p>
        </motion.div>
      </main>
    </div>
  );
}
