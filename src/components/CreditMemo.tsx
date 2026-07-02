'use client';

import { motion } from 'framer-motion';
import { Printer, Download, ShieldCheck, ShieldAlert, ShieldX, FileText } from 'lucide-react';
import { CreditReport } from '@/app/types';

export interface AssessmentData {
  report: CreditReport;
  recommendation?: any;
  intelligence?: any;
  clientName: string;
  industry?: string;
}

const DECISION_CLASS: Record<string, string> = {
  'Approve': 'approve',
  'Approve with conditions': 'conditional',
  'Refer to manual review': 'review',
  'Decline': 'decline',
};

export default function CreditMemo({ data }: { data: AssessmentData }) {
  const { report, recommendation: rec, intelligence: intel, clientName, industry } = data;
  const { customer_summary: cs, calculated_metrics: cm, risk_assessment: ra } = report;
  const ref = `RFM-${new Date(report.report_metadata.generated_at).getTime().toString(36).toUpperCase()}`;
  const decisionClass = rec ? DECISION_CLASS[rec.decision] ?? 'review' : (ra.tier === 'Low Risk' ? 'approve' : ra.tier === 'High Risk' ? 'decline' : 'conditional');

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="memo">
      <div className="memo-head">
        <div className="memo-brand"><FileText size={16}/> RFM Credit AI · Credit Memorandum</div>
        <div className="memo-actions">
          <button onClick={() => printMemo(data)}><Printer size={13}/> Print / PDF</button>
          <button onClick={() => downloadMemo(data, ref)}><Download size={13}/> Download</button>
        </div>
      </div>

      <div className="memo-meta">
        <div><small>CLIENT</small><strong>{clientName}</strong></div>
        <div><small>INDUSTRY</small><strong>{industry || '—'}</strong></div>
        <div><small>MEMO REF</small><strong>{ref}</strong></div>
        <div><small>DATE</small><strong>{new Date(report.report_metadata.generated_at).toLocaleDateString()}</strong></div>
      </div>

      {/* Decision banner */}
      <div className={`memo-decision ${decisionClass}`}>
        <div className="memo-decision-icon">
          {decisionClass === 'approve' ? <ShieldCheck size={22}/> : decisionClass === 'decline' || decisionClass === 'review' ? <ShieldX size={22}/> : <ShieldAlert size={22}/>}
        </div>
        <div className="memo-decision-text">
          <small>RECOMMENDATION</small>
          <strong>{rec?.decision ?? ra.tier}{rec?.confidence ? ` · ${rec.confidence} confidence` : ''}</strong>
          <p>{rec?.headline ?? `${ra.tier} — ${ra.repayment_days}-day terms.`}</p>
        </div>
        <div className="memo-decision-terms"><small>TERMS</small><b>{ra.repayment_days > 0 ? `${ra.repayment_days} days` : 'On hold'}</b></div>
      </div>

      {/* Strengths / Concerns */}
      {rec && (
        <div className="memo-two">
          <Section title="Strengths" items={rec.strengths} tone="good"/>
          <Section title="Concerns" items={rec.concerns} tone="bad"/>
        </div>
      )}

      {/* Conditions */}
      {rec?.conditions?.length > 0 && <Section title="Conditions / next steps" items={rec.conditions} tone="cond" full/>}

      {/* Key metrics */}
      <div className="memo-section">
        <h4>Key metrics</h4>
        <div className="memo-metrics">
          <Metric label="Debt-to-Income" value={cm.dti}/>
          <Metric label="Utilization" value={cm.utilization}/>
          <Metric label="Cash-Flow Margin" value={cm.cash_flow_margin}/>
          <Metric label="FICO Score" value={String(cm.fico_score)}/>
        </div>
        {ra.reasons.length > 0 && <ul className="memo-reasons">{ra.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      </div>

      {/* Recommended structure */}
      {rec?.recommendedOption && (
        <div className="memo-section">
          <h4>Recommended structure</h4>
          <div className="memo-option"><strong>{rec.recommendedOption.name}</strong> <em>{rec.recommendedOption.pricing}</em><p>{rec.recommendedOption.note}</p></div>
          {intel?.loanOptions?.options?.length > 1 && (
            <div className="memo-option-list">{intel.loanOptions.options.map((o: any, i: number) => <div key={i}><b>{o.name}</b> ({o.pricing}) — {o.note}</div>)}</div>
          )}
        </div>
      )}

      {/* Compliance & fraud */}
      {intel && (
        <div className="memo-two">
          <div className="memo-section">
            <h4>Compliance / KYC <span className={`memo-tag ${intel.compliance?.status === 'CLEAR' ? 'good' : 'bad'}`}>{intel.compliance?.status}</span></h4>
            {intel.compliance?.flags?.length ? <ul className="memo-reasons">{intel.compliance.flags.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul> : <p className="memo-muted">All checks passed.</p>}
          </div>
          <div className="memo-section">
            <h4>Fraud screen <span className={`memo-tag ${intel.fraud?.riskLevel === 'Low' ? 'good' : 'bad'}`}>{intel.fraud?.riskLevel}</span></h4>
            {intel.fraud?.anomalies?.length ? <ul className="memo-reasons">{intel.fraud.anomalies.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul> : <p className="memo-muted">No anomalies detected.</p>}
          </div>
        </div>
      )}

      {/* Macro & portfolio */}
      {intel && (
        <div className="memo-two">
          <div className="memo-section"><h4>Macro context</h4><p className="memo-muted">{intel.macro?.note}</p></div>
          <div className="memo-section"><h4>Portfolio history</h4><p className="memo-muted">{intel.portfolio?.note}</p></div>
        </div>
      )}

      {/* Financial summary */}
      <div className="memo-section">
        <h4>Financial summary</h4>
        <div className="memo-fin">
          <Row label="Monthly income" value={money(cs.gross_monthly_income)}/>
          <Row label="Monthly debt" value={money(cs.total_monthly_debt_payments)}/>
          <Row label="Available credit" value={money(cs.total_available_credit)}/>
          <Row label="Outstanding credit" value={money(cs.total_outstanding_credit)}/>
          <Row label="Monthly expenses" value={money(cs.total_monthly_expenses)}/>
        </div>
      </div>

      <div className="memo-foot">Prepared by RFM Credit AI · {new Date(report.report_metadata.generated_at).toLocaleString()} · pipeline {report.report_metadata.pipeline_version}</div>
    </motion.div>
  );
}

function Section({ title, items, tone, full }: { title: string; items?: string[]; tone: string; full?: boolean }) {
  if (!items?.length) return full ? null : <div className="memo-section"><h4>{title}</h4><p className="memo-muted">None.</p></div>;
  return <div className={`memo-section ${full ? 'memo-full' : ''}`}><h4>{title}</h4><ul className={`memo-list ${tone}`}>{items.map((t, i) => <li key={i}>{t}</li>)}</ul></div>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="memo-metric"><small>{label}</small><strong>{value}</strong></div>;
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="memo-row"><span>{label}</span><b>{value}</b></div>;
}
function money(n: number) { return `$${Math.round(n).toLocaleString()}`; }

// ── Print / download (self-contained HTML) ──────────────────────────────────
function buildMemoHtml(d: AssessmentData, ref: string): string {
  const { report: r, recommendation: rec, intelligence: intel, clientName, industry } = d;
  const cs = r.customer_summary, cm = r.calculated_metrics, ra = r.risk_assessment;
  const li = (arr?: string[]) => (arr?.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">None.</p>');
  const decision = rec?.decision ?? ra.tier;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Credit Memo — ${esc(clientName)}</title>
<style>
  body{font:14px/1.55 -apple-system,Segoe UI,Arial,sans-serif;color:#1c2230;max-width:760px;margin:32px auto;padding:0 24px}
  h1{font-size:18px;margin:0 0 4px} h4{font-size:13px;margin:22px 0 8px;color:#3a4356;border-bottom:1px solid #e9ebf1;padding-bottom:6px}
  .meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0;font-size:12px}
  .meta b{display:block;color:#8a93a6;font-weight:600;font-size:9px;letter-spacing:.08em}
  .decision{padding:14px 16px;border-radius:10px;margin:14px 0;border:1px solid}
  .approve{background:#ecfdf3;border-color:#abefc6} .conditional{background:#fffaeb;border-color:#fedf89}
  .review{background:#eff8ff;border-color:#b2ddff} .decline{background:#fef3f2;border-color:#fecdca}
  .decision b{font-size:16px} .two{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px} .metric{border:1px solid #e9ebf1;border-radius:8px;padding:10px}
  .metric small{display:block;color:#8a93a6;font-size:10px} .metric b{font-size:16px}
  ul{margin:6px 0;padding-left:18px} li{margin:3px 0} .muted{color:#8a93a6}
  .row{display:flex;justify-content:space-between;border-bottom:1px solid #f1f2f6;padding:6px 0;font-size:13px}
  .foot{margin-top:24px;color:#8a93a6;font-size:11px;border-top:1px solid #e9ebf1;padding-top:10px}
  @media print{body{margin:0}}
</style></head><body>
<h1>RFM Credit AI — Credit Memorandum</h1>
<div class="meta"><div><b>CLIENT</b>${esc(clientName)}</div><div><b>INDUSTRY</b>${esc(industry || '—')}</div><div><b>REF</b>${ref}</div><div><b>DATE</b>${new Date(r.report_metadata.generated_at).toLocaleDateString()}</div></div>
<div class="decision ${DECISION_CLASS[decision] ?? 'review'}"><b>${esc(decision)}${rec?.confidence ? ` · ${esc(rec.confidence)} confidence` : ''}</b><div>${esc(rec?.headline ?? `${ra.tier} — ${ra.repayment_days}-day terms`)}</div></div>
${rec ? `<div class="two"><div><h4>Strengths</h4>${li(rec.strengths)}</div><div><h4>Concerns</h4>${li(rec.concerns)}</div></div>` : ''}
${rec?.conditions?.length ? `<h4>Conditions / next steps</h4>${li(rec.conditions)}` : ''}
<h4>Key metrics</h4><div class="metrics"><div class="metric"><small>DTI</small><b>${cm.dti}</b></div><div class="metric"><small>Utilization</small><b>${cm.utilization}</b></div><div class="metric"><small>Cash flow</small><b>${cm.cash_flow_margin}</b></div><div class="metric"><small>FICO</small><b>${cm.fico_score}</b></div></div>
${ra.reasons?.length ? li(ra.reasons) : ''}
${rec?.recommendedOption ? `<h4>Recommended structure</h4><p><b>${esc(rec.recommendedOption.name)}</b> — ${esc(rec.recommendedOption.pricing)}<br>${esc(rec.recommendedOption.note)}</p>` : ''}
${intel ? `<div class="two"><div><h4>Compliance / KYC — ${esc(intel.compliance?.status)}</h4>${li(intel.compliance?.flags)}</div><div><h4>Fraud — ${esc(intel.fraud?.riskLevel)}</h4>${li(intel.fraud?.anomalies)}</div></div>` : ''}
${intel ? `<div class="two"><div><h4>Macro context</h4><p class="muted">${esc(intel.macro?.note || '')}</p></div><div><h4>Portfolio history</h4><p class="muted">${esc(intel.portfolio?.note || '')}</p></div></div>` : ''}
<h4>Financial summary</h4>
<div class="row"><span>Monthly income</span><b>${money(cs.gross_monthly_income)}</b></div>
<div class="row"><span>Monthly debt</span><b>${money(cs.total_monthly_debt_payments)}</b></div>
<div class="row"><span>Available credit</span><b>${money(cs.total_available_credit)}</b></div>
<div class="row"><span>Outstanding credit</span><b>${money(cs.total_outstanding_credit)}</b></div>
<div class="row"><span>Monthly expenses</span><b>${money(cs.total_monthly_expenses)}</b></div>
<div class="foot">Prepared by RFM Credit AI · ${new Date(r.report_metadata.generated_at).toLocaleString()} · pipeline ${esc(r.report_metadata.pipeline_version)}</div>
</body></html>`;
}

function esc(s: unknown) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)); }

function printMemo(d: AssessmentData) {
  const ref = `RFM-${new Date(d.report.report_metadata.generated_at).getTime().toString(36).toUpperCase()}`;
  const blob = new Blob([buildMemoHtml(d, ref)], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank', 'width=820,height=1000');
  if (w) w.addEventListener('load', () => { w.focus(); w.print(); });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function downloadMemo(d: AssessmentData, ref: string) {
  const blob = new Blob([buildMemoHtml(d, ref)], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `credit-memo-${d.clientName.replace(/\s+/g, '-').toLowerCase()}-${ref}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
