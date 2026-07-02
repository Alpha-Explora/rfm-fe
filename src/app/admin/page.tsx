'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, Brain, CheckCircle2, ChevronRight, Coins, DollarSign, Eye, EyeOff, Layers, RotateCcw, Save, Settings, Shield, Sparkles, TrendingUp, Zap, Users } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type AgentConfigRow = {
  agentKey: string;
  agentName: string;
  description: string;
  model: string;
  enabled: boolean;
  updatedAt?: string;
};

type ModelOption = {
  id: string;
  label: string;
  costTier: string;
  inputPer1M: number;
  outputPer1M: number;
};

type TokenStats = {
  totals: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
    costUsd: number;
    runCount: number;
  } | null;
  byMode: { mode: string; totalTokens: number; costUsd: number; count: number }[];
  recent: {
    id: string;
    clientName?: string;
    runMode: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    success: boolean;
    createdAt: string;
  }[];
};

const COST_TIER_COLORS: Record<string, string> = {
  free: '#18a558',
  low: '#4f8cff',
  medium: '#e0922f',
  high: '#e0605f',
};

const COST_TIER_LABELS: Record<string, string> = {
  free: 'Free',
  low: 'Low cost',
  medium: 'Medium cost',
  high: 'High cost',
};

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState('');
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [configs, setConfigs] = useState<AgentConfigRow[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [tokenStats, setTokenStats] = useState<TokenStats | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [pendingModels, setPendingModels] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<'models' | 'tokens' | 'users'>('models');
  const [openCodeBaseUrl, setOpenCodeBaseUrl] = useState('https://opencode.ai/zen/v1');
  const [savingUrl, setSavingUrl] = useState(false);
  const [savedUrl, setSavedUrl] = useState(false);

  // Restore session on mount
  useEffect(() => {
    const storedKey = sessionStorage.getItem('rfm-admin-key');
    if (storedKey) {
      setAdminKey(storedKey);
      return;
    }

    const storedToken = localStorage.getItem('rfm-auth-token');
    if (storedToken) {
      fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${storedToken}` }
      }).then(res => {
        if (res.ok) return res.json();
      }).then(usr => {
        if (usr && usr.role === 'superadmin') {
          setAuthToken(storedToken);
        }
      }).catch(err => console.error(err));
    }
  }, []);

  const loadData = useCallback(async (keyOrToken: { key?: string; token?: string }) => {
    setDataLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (keyOrToken.key) headers['x-admin-key'] = keyOrToken.key;
      if (keyOrToken.token) headers['Authorization'] = `Bearer ${keyOrToken.token}`;

      const [cfgRes, tokRes, usrRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/config`, { headers }),
        fetch(`${API_BASE}/api/admin/token-usage`, { headers }),
        fetch(`${API_BASE}/api/admin/users`, { headers }),
      ]);
      if (!cfgRes.ok || !tokRes.ok) {
        setAdminKey('');
        setAuthToken(null);
        sessionStorage.removeItem('rfm-admin-key');
        return;
      }
      const cfg = await cfgRes.json();
      const tok = await tokRes.json();
      const usr = usrRes.ok ? await usrRes.json() : [];
      setConfigs(cfg.configs ?? []);
      setModels(cfg.models ?? []);
      setTokenStats(tok);
      setUsers(usr);
      setOpenCodeBaseUrl(cfg.openCodeBaseUrl ?? 'https://opencode.ai/zen/v1');
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (adminKey) {
      void loadData({ key: adminKey });
    } else if (authToken) {
      void loadData({ token: authToken });
    }
  }, [adminKey, authToken, loadData]);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/auth`, {
        method: 'POST',
        headers: { 'x-admin-key': keyInput },
      });
      if (res.ok) {
        sessionStorage.setItem('rfm-admin-key', keyInput);
        setAdminKey(keyInput);
        setKeyInput('');
      } else {
        setAuthError('Invalid admin key. Check the ADMIN_SECRET env var on the backend.');
      }
    } catch {
      setAuthError('Could not reach the backend. Is it running on :3001?');
    } finally {
      setAuthLoading(false);
    }
  }

  async function saveModel(agentKey: string) {
    const model = pendingModels[agentKey];
    if (!model) return;
    setSavingKey(agentKey);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (adminKey) headers['x-admin-key'] = adminKey;
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch(`${API_BASE}/api/admin/config/${agentKey}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ model, updatedBy: 'superadmin' }),
      });
      if (res.ok) {
        setConfigs((prev) => prev.map((c) => c.agentKey === agentKey ? { ...c, model } : c));
        setPendingModels((prev) => { const next = { ...prev }; delete next[agentKey]; return next; });
        setSavedKey(agentKey);
        setTimeout(() => setSavedKey(null), 2000);
      }
    } finally {
      setSavingKey(null);
    }
  }

  async function saveOpenCodeUrl(url: string) {
    setSavingUrl(true);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (adminKey) headers['x-admin-key'] = adminKey;
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch(`${API_BASE}/api/admin/config/opencode-url`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        setOpenCodeBaseUrl(url);
        setSavedUrl(true);
        setTimeout(() => setSavedUrl(false), 2000);
        // Reload configuration because switching base URLs changes the available models list
        await loadData(adminKey ? { key: adminKey } : { token: authToken! });
      }
    } finally {
      setSavingUrl(false);
    }
  }

  // ── Auth gate ─────────────────────────────────────────────────────────────
  if (!adminKey && !authToken) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
        <div style={{ width: '100%', maxWidth: 400, padding: 40, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 20, boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
            <div style={{ width: 44, height: 44, borderRadius: 13, background: 'linear-gradient(135deg, var(--red), var(--blue))', display: 'grid', placeItems: 'center', color: '#fff' }}>
              <Shield size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>RFM Superadmin</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>AI model & usage control panel</div>
            </div>
          </div>
          <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em' }}>
              Admin key
              <div style={{ position: 'relative', marginTop: 6 }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="Enter ADMIN_SECRET"
                  style={{ width: '100%', padding: '10px 36px 10px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 14 }}
                  autoFocus
                />
                <button type="button" onClick={() => setShowKey((v) => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 0, color: 'var(--muted)', padding: 2 }}>
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
            {authError && <div style={{ fontSize: 12, color: 'var(--red)', background: 'var(--red-soft)', border: '1px solid var(--red-line)', borderRadius: 8, padding: '8px 12px' }}>{authError}</div>}
            <button type="submit" disabled={!keyInput.trim() || authLoading} style={{ padding: '11px', borderRadius: 10, background: 'linear-gradient(135deg, var(--red), #e8736f)', color: '#fff', border: 0, fontWeight: 600, fontSize: 14, cursor: 'pointer', opacity: !keyInput.trim() ? .5 : 1 }}>
              {authLoading ? 'Verifying…' : 'Enter admin panel'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const totals = tokenStats?.totals;
  const recentLogs = tokenStats?.recent ?? [];
  const byMode = tokenStats?.byMode ?? [];

  // ── Admin UI ──────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-geist-sans, Arial, sans-serif)' }}>
      {/* Header */}
      <header style={{ background: 'var(--surface)', borderBottom: '1px solid var(--line)', padding: '18px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(135deg, var(--red), var(--blue))', display: 'grid', placeItems: 'center', color: '#fff', boxShadow: 'var(--shadow)' }}>
            <Shield size={18} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>RFM Superadmin</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>AI model configuration & token usage</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="admin-topbtn" onClick={() => loadData(adminKey ? { key: adminKey } : { token: authToken! })} disabled={dataLoading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)', color: 'var(--ink-soft)', fontSize: 12, cursor: 'pointer' }}>
            <RotateCcw size={13} style={dataLoading ? { animation: 'spin 1s linear infinite' } : {}} /> Refresh
          </button>
          <button className="admin-topbtn" onClick={() => { setAdminKey(''); setAuthToken(null); sessionStorage.removeItem('rfm-admin-key'); }} style={{ padding: '8px 14px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }}>
            Sign out
          </button>
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: '1px solid var(--red-line)', borderRadius: 10, background: 'var(--red-soft)', color: 'var(--red-bright)', fontSize: 12, textDecoration: 'none', fontWeight: 600 }}>
            <Brain size={13} /> Back to app
          </a>
        </div>
      </header>

      {/* Nav */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--line)', padding: '0 32px', display: 'flex', gap: 4 }}>
        <button className="admin-nav-btn" onClick={() => setActiveSection('models')} style={{ padding: '12px 18px', border: 0, background: 'transparent', color: activeSection === 'models' ? 'var(--red-bright)' : 'var(--muted)', fontSize: 13, fontWeight: 500, borderBottom: `2px solid ${activeSection === 'models' ? 'var(--red)' : 'transparent'}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Settings size={13} /> Model Configuration
        </button>
        <button className="admin-nav-btn" onClick={() => setActiveSection('tokens')} style={{ padding: '12px 18px', border: 0, background: 'transparent', color: activeSection === 'tokens' ? 'var(--red-bright)' : 'var(--muted)', fontSize: 13, fontWeight: 500, borderBottom: `2px solid ${activeSection === 'tokens' ? 'var(--red)' : 'transparent'}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Zap size={13} /> Token Usage & Cost
        </button>
        <button className="admin-nav-btn" onClick={() => setActiveSection('users')} style={{ padding: '12px 18px', border: 0, background: 'transparent', color: activeSection === 'users' ? 'var(--red-bright)' : 'var(--muted)', fontSize: 13, fontWeight: 500, borderBottom: `2px solid ${activeSection === 'users' ? 'var(--red)' : 'transparent'}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Users size={13} /> User Activity
        </button>
      </div>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '36px 32px' }}>

        {/* ── Model Configuration ────────────────────────────────────────── */}
        {activeSection === 'models' && (
          <div className="admin-section">
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: 19, color: 'var(--ink)', margin: 0 }}>Agent Model Configuration</h2>
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: '6px 0 0' }}>
                Select which AI model each agent uses. Changes are saved to the database and written to <code style={{ fontSize: 11, background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4, border: '1px solid var(--line)' }}>rfm-agents/.env</code> — restart the agents server to apply.
              </p>
            </div>

            {/* Restart reminder */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 16px', background: '#fff8ea', border: '1px solid #f3e0c2', borderRadius: 12, marginBottom: 28 }}>
              <AlertTriangle size={16} style={{ color: 'var(--amber)', marginTop: 1, flexShrink: 0 }} />
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--ink)' }}>Restart required.</strong> Agent models are loaded at startup from env vars. After saving a change here, run <code style={{ fontSize: 11, background: '#fef6e0', padding: '1px 5px', borderRadius: 4 }}>npm run dev</code> in the <code style={{ fontSize: 11, background: '#fef6e0', padding: '1px 5px', borderRadius: 4 }}>rfm-agents</code> folder to apply the new configuration.
              </div>
            </div>

            {/* OpenCode Base URL / Plan Selection */}
            <div className="admin-card" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '20px', marginBottom: 24, boxShadow: 'var(--shadow-sm)', display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Sparkles size={16} style={{ color: 'var(--blue)' }} />
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>OpenCode API Plan & Base URL</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                  Switch between OpenCode Zen (Pay-As-You-Go) and OpenCode Go (Flat-rate Subscription). Switching plans automatically migrates active agents to compatible models.
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <select
                    value={openCodeBaseUrl}
                    onChange={(e) => saveOpenCodeUrl(e.target.value)}
                    disabled={savingUrl}
                    style={{ padding: '8px 12px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 13, cursor: 'pointer', minWidth: 320 }}
                  >
                    <option value="https://opencode.ai/zen/v1">OpenCode Zen (PAYG) — https://opencode.ai/zen/v1</option>
                    <option value="https://opencode.ai/zen/go/v1">OpenCode Go (Subscription) — https://opencode.ai/zen/go/v1</option>
                  </select>
                  {savingUrl && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Updating plan…</span>}
                  {savedUrl && <span style={{ fontSize: 12, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={13} /> Updated successfully</span>}
                </div>
              </div>
            </div>

            {/* Model cost legend */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
              {Object.entries(COST_TIER_COLORS).map(([tier, color]) => (
                <span key={tier} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 99, border: `1px solid ${color}33`, background: `${color}0d`, fontSize: 11, color }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
                  {COST_TIER_LABELS[tier]}
                </span>
              ))}
            </div>

            {dataLoading && configs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)', fontSize: 13 }}>Loading configuration…</div>
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                {configs.map((cfg) => {
                  const pending = pendingModels[cfg.agentKey];
                  const activeModel = pending ?? cfg.model;
                  const modelInfo = models.find((m) => m.id === activeModel);
                  const tierColor = COST_TIER_COLORS[modelInfo?.costTier ?? 'free'];
                  const isDirty = !!pending && pending !== cfg.model;
                  const isSaving = savingKey === cfg.agentKey;
                  const isSaved = savedKey === cfg.agentKey;

                  return (
                    <div className="admin-card" key={cfg.agentKey} style={{ background: 'var(--surface)', border: `1px solid ${isDirty ? 'var(--blue-line)' : 'var(--line)'}`, borderRadius: 14, padding: '18px 20px', display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center', boxShadow: isDirty ? '0 0 0 3px rgba(79,140,255,.08)' : 'var(--shadow-sm)', transition: 'all .18s' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{cfg.agentName}</span>
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: `${tierColor}15`, color: tierColor, border: `1px solid ${tierColor}30`, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                            {COST_TIER_LABELS[modelInfo?.costTier ?? 'free']}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Consolas, monospace' }}>{cfg.agentKey}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{cfg.description}</div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <select
                            value={activeModel}
                            onChange={(e) => setPendingModels((prev) => ({ ...prev, [cfg.agentKey]: e.target.value }))}
                            style={{ padding: '8px 12px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)', fontSize: 13, cursor: 'pointer', minWidth: 240 }}
                          >
                            {models.map((m) => (
                              <option key={m.id} value={m.id}>{m.label} {m.inputPer1M === 0 ? '(free)' : `— $${m.inputPer1M}/$${m.outputPer1M} per 1M`}</option>
                            ))}
                          </select>
                          {modelInfo && modelInfo.inputPer1M > 0 && (
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                              <DollarSign size={11} style={{ verticalAlign: 'middle', marginRight: 2 }} />
                              ${modelInfo.inputPer1M}/1M in · ${modelInfo.outputPer1M}/1M out
                            </span>
                          )}
                          {modelInfo && modelInfo.inputPer1M === 0 && (
                            <span style={{ fontSize: 11, color: 'var(--green)' }}>No cost</span>
                          )}
                        </div>
                        {cfg.updatedAt && (
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>
                            Last updated: {new Date(cfg.updatedAt).toLocaleString()}
                          </div>
                        )}
                      </div>
                      <button
                        className="admin-save"
                        disabled={!isDirty || isSaving}
                        onClick={() => saveModel(cfg.agentKey)}
                        style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 10, border: 0, background: isSaved ? 'var(--green)' : isDirty ? 'var(--blue)' : 'var(--line)', color: isDirty || isSaved ? '#fff' : 'var(--muted)', fontWeight: 600, fontSize: 13, cursor: isDirty ? 'pointer' : 'default', transition: 'all .16s', minWidth: 100, justifyContent: 'center' }}
                      >
                        {isSaved ? <><CheckCircle2 size={14} /> Saved</> : isSaving ? 'Saving…' : <><Save size={14} /> Save</>}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Token Usage & Cost ─────────────────────────────────────────── */}
        {activeSection === 'tokens' && (
          <div className="admin-section">
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: 19, color: 'var(--ink)', margin: 0 }}>Token Usage & Cost</h2>
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: '6px 0 0' }}>
                Aggregated token counts and estimated cost across all completed runs. Logged by the client app at the end of each session.
              </p>
            </div>

            {/* Totals */}
            {totals && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 32 }}>
                <StatCard icon={<Zap size={16} />} label="Total Tokens" value={fmtNum(totals.totalTokens)} sub={`${fmtNum(totals.inputTokens)} in · ${fmtNum(totals.outputTokens)} out`} color="blue" />
                <StatCard icon={<Coins size={16} />} label="Est. Total Cost" value={`$${totals.costUsd.toFixed(4)}`} sub="based on director model pricing" color="amber" />
                <StatCard icon={<Activity size={16} />} label="Total Runs" value={String(totals.runCount)} sub="logged assessments & overviews" color="red" />
                <StatCard icon={<TrendingUp size={16} />} label="Cached Tokens" value={fmtNum(totals.cachedTokens)} sub="prompt cache savings" color="green" />
              </div>
            )}

            {!totals && !dataLoading && (
              <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>
                <Layers size={32} style={{ marginBottom: 12, opacity: .4 }} />
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-soft)' }}>No token data yet</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Run an assessment from the main app — usage is logged automatically when a session ends.</div>
              </div>
            )}

            {/* By run mode */}
            {byMode.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 32 }}>
                {byMode.map((m) => (
                  <div className="admin-stat" key={m.mode} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 18px', boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--muted)', fontWeight: 600, marginBottom: 8 }}>{m.mode} runs</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>{fmtNum(m.totalTokens)}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
                      <span>{m.count} runs</span>
                      <span>${m.costUsd.toFixed(4)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Recent runs table */}
            {recentLogs.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 13, color: 'var(--ink)' }}>Recent Runs</strong>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{recentLogs.length} entries</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--surface-2)' }}>
                        {['Client', 'Mode', 'Tokens In', 'Tokens Out', 'Total', 'Est. Cost', 'Status', 'Time'].map((h) => (
                          <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {recentLogs.map((log, i) => (
                        <tr className="admin-trow" key={log.id} style={{ background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)', borderBottom: '1px solid var(--line-soft)' }}>
                          <td style={{ padding: '10px 14px', color: 'var(--ink)', fontWeight: 500 }}>{log.clientName ?? '—'}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', background: log.runMode === 'assessment' ? 'var(--red-soft)' : 'var(--blue-soft)', color: log.runMode === 'assessment' ? 'var(--red-bright)' : 'var(--blue-bright)' }}>{log.runMode}</span>
                          </td>
                          <td style={{ padding: '10px 14px', color: 'var(--muted)', fontFamily: 'Consolas, monospace' }}>{fmtNum(log.inputTokens)}</td>
                          <td style={{ padding: '10px 14px', color: 'var(--muted)', fontFamily: 'Consolas, monospace' }}>{fmtNum(log.outputTokens)}</td>
                          <td style={{ padding: '10px 14px', color: 'var(--ink)', fontWeight: 600, fontFamily: 'Consolas, monospace' }}>{fmtNum(log.totalTokens)}</td>
                          <td style={{ padding: '10px 14px', color: 'var(--amber)', fontFamily: 'Consolas, monospace' }}>${log.costUsd.toFixed(5)}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ color: log.success ? 'var(--green)' : 'var(--red)', fontSize: 11, fontWeight: 600 }}>{log.success ? 'Success' : 'Failed'}</span>
                          </td>
                          <td style={{ padding: '10px 14px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{new Date(log.createdAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── User Activity ─────────────────────────────────────────────── */}
        {activeSection === 'users' && (
          <div className="admin-section">
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: 19, color: 'var(--ink)', margin: 0 }}>User Activity & Accounts</h2>
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: '6px 0 0' }}>
                Summary of all registered underwriters, their authentication profiles, and aggregated AI token usage metrics.
              </p>
            </div>

            {/* User Stats Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 32 }}>
              <div className="admin-stat" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 18px', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--muted)', fontWeight: 600, marginBottom: 8 }}>Total Underwriters</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>{users.length}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Registered accounts</div>
              </div>
              <div className="admin-stat" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 18px', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--muted)', fontWeight: 600, marginBottom: 8 }}>Active This Session</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>
                  {users.filter(u => u.lastActiveAt).length}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Accounts with recorded logs</div>
              </div>
              <div className="admin-stat" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 18px', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--muted)', fontWeight: 600, marginBottom: 8 }}>Total User Cost</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--blue-bright)' }}>
                  ${users.reduce((acc, u) => acc + (u.totals?.cost ?? 0), 0).toFixed(4)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Sum of all query sessions</div>
              </div>
            </div>

            {/* Users Table */}
            {users.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--line)' }}>
                <Users size={32} style={{ marginBottom: 12, opacity: .4, margin: '0 auto' }} />
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-soft)', marginTop: 12 }}>No registered users yet</div>
              </div>
            ) : (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 13, color: 'var(--ink)' }}>All Registered Accounts</strong>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{users.length} users</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--surface-2)' }}>
                        {['Name / Email', 'Role', 'Date Joined', 'Total Runs', 'Total Tokens', 'Est. Cost', 'Last Active'].map((h) => (
                          <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u, i) => (
                        <tr className="admin-trow" key={u.id} style={{ background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)', borderBottom: '1px solid var(--line-soft)' }}>
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, var(--red-soft), var(--blue-soft))', color: 'var(--blue-bright)', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, border: '1px solid var(--line-soft)' }}>
                                {(u.name || u.email).substring(0, 2).toUpperCase()}
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <strong style={{ color: 'var(--ink)', fontSize: 12 }}>{u.name || 'Underwriter'}</strong>
                                <span style={{ color: 'var(--muted)', fontSize: 10 }}>{u.email}</span>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', background: u.role === 'admin' ? 'linear-gradient(135deg, var(--red-soft), #fff3f3)' : 'var(--line-soft)', color: u.role === 'admin' ? 'var(--red-bright)' : 'var(--ink-soft)' }}>
                              {u.role}
                            </span>
                          </td>
                          <td style={{ padding: '14px 16px', color: 'var(--muted)' }}>
                            {new Date(u.createdAt).toLocaleDateString()}
                          </td>
                          <td style={{ padding: '14px 16px', color: 'var(--ink)', fontWeight: 500, fontFamily: 'Consolas, monospace' }}>
                            {u.totals?.runs ?? 0}
                          </td>
                          <td style={{ padding: '14px 16px', color: 'var(--muted)', fontFamily: 'Consolas, monospace' }}>
                            {fmtNum(u.totals?.total ?? 0)}
                          </td>
                          <td style={{ padding: '14px 16px', color: 'var(--amber)', fontFamily: 'Consolas, monospace', fontWeight: 600 }}>
                            ${(u.totals?.cost ?? 0).toFixed(4)}
                          </td>
                          <td style={{ padding: '14px 16px', color: 'var(--muted)' }}>
                            {u.lastActiveAt ? (
                              <span style={{ color: 'var(--ink-soft)' }}>{new Date(u.lastActiveAt).toLocaleString()}</span>
                            ) : (
                              <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>Never</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes adminRise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }
        body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--font-geist-sans, Arial, sans-serif); -webkit-font-smoothing: antialiased; }
        :root {
          --bg: #f6f7f9; --surface: #ffffff; --surface-2: #fbfcfd; --ink: #1c2230; --ink-soft: #3a4356; --muted: #8a93a6; --line: #e9ebf1; --line-soft: #f1f2f6;
          --red: #e0605f; --red-bright: #d34a49; --red-soft: #fdf1f1; --red-line: #f6dcdc;
          --blue: #4f8cff; --blue-bright: #2f6fe6; --blue-soft: #eef4ff; --blue-line: #dbe7fc;
          --green: #18a558; --amber: #e0922f;
          --shadow-sm: 0 1px 2px rgba(28,34,48,.05); --shadow: 0 4px 16px rgba(28,34,48,.06); --shadow-lg: 0 18px 50px rgba(28,34,48,.12);
        }
        button, input, select { font: inherit; }
        select { appearance: none; background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%238a93a6' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; padding-right: 28px !important; }
        /* Round-2 admin polish — hover lift, entrance, nav underline */
        .admin-section { animation: adminRise .4s cubic-bezier(.22,1,.36,1) both; }
        .admin-card { transition: border-color .18s, box-shadow .2s, transform .14s; }
        .admin-card:hover { transform: translateY(-3px); box-shadow: var(--shadow); }
        .admin-stat { transition: box-shadow .2s, transform .14s; }
        .admin-stat:hover { transform: translateY(-3px); box-shadow: var(--shadow); }
        .admin-nav-btn { position: relative; transition: color .15s; }
        .admin-nav-btn:hover { color: var(--ink-soft) !important; }
        .admin-topbtn { transition: border-color .15s, color .15s, background .15s, transform .1s, box-shadow .16s; }
        .admin-topbtn:hover { border-color: var(--red-line) !important; color: var(--red-bright) !important; }
        .admin-topbtn:active { transform: scale(.97); }
        .admin-save:not(:disabled):hover { filter: brightness(1.05); transform: translateY(-1px); box-shadow: 0 8px 20px rgba(79,140,255,.28); }
        .admin-trow { transition: background .14s; }
        .admin-trow:hover { background: var(--blue-soft) !important; }
        @media (prefers-reduced-motion: reduce) {
          .admin-section { animation: none; }
          .admin-card:hover, .admin-stat:hover, .admin-save:not(:disabled):hover, .admin-topbtn:active { transform: none; }
        }
      `}</style>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub: string; color: string }) {
  const palette: Record<string, { bg: string; border: string; text: string; icon: string }> = {
    blue: { bg: 'var(--blue-soft)', border: 'var(--blue-line)', text: 'var(--blue-bright)', icon: 'var(--blue)' },
    red: { bg: 'var(--red-soft)', border: 'var(--red-line)', text: 'var(--red-bright)', icon: 'var(--red)' },
    amber: { bg: '#fff8ea', border: '#f3e0c2', text: 'var(--amber)', icon: 'var(--amber)' },
    green: { bg: '#ecf8f0', border: '#c4ead3', text: '#18a558', icon: '#18a558' },
  };
  const p = palette[color] ?? palette.blue;
  return (
    <div className="admin-stat" style={{ background: p.bg, border: `1px solid ${p.border}`, borderRadius: 14, padding: '18px 20px', boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ color: p.icon }}>{icon}</span>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--muted)' }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: p.text, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>
    </div>
  );
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
