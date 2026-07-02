'use client';

import { motion } from 'framer-motion';
import { CreditReport } from '@/app/types';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  Clock,
  BarChart3,
  Cpu,
} from 'lucide-react';

interface Props {
  report: CreditReport;
}

export default function CreditReportView({ report }: Props) {
  const { customer_summary, calculated_metrics, risk_assessment } = report;
  const isLow = risk_assessment.tier === 'Low Risk';
  const isHigh = risk_assessment.tier === 'High Risk';

  const riskColor = isLow ? 'emerald' : isHigh ? 'red' : 'amber';
  const RiskIcon = isLow ? ShieldCheck : isHigh ? ShieldX : ShieldAlert;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-2xl mx-auto space-y-6"
    >
      {/* Risk Badge Header */}
      <div
        className={`rounded-2xl p-6 bg-${riskColor}-500/10 border border-${riskColor}-500/30`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-xl bg-${riskColor}-500/20`}>
              <RiskIcon className={`w-6 h-6 text-${riskColor}-400`} />
            </div>
            <div>
              <p className="text-sm text-slate-400">Risk Assessment</p>
              <p className={`text-2xl font-bold text-${riskColor}-400`}>
                {risk_assessment.tier}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-400">Repayment Terms</p>
            <p className="text-2xl font-bold text-slate-100">
              {risk_assessment.repayment_days} Days
            </p>
          </div>
        </div>
        {risk_assessment.flag_for_manual_review && (
          <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <p className="text-sm text-red-300">Flagged for manual review</p>
          </div>
        )}
        {risk_assessment.reasons.length > 0 && (
          <div className="mt-4 space-y-1">
            {risk_assessment.reasons.map((r, i) => (
              <p key={i} className="text-xs text-slate-500 flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-slate-600" />
                {r}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Metrics Grid */}
      {calculated_metrics.is_corporate ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <MetricCard
            icon={TrendingUp}
            label="DSCR"
            value={calculated_metrics.dscr || 'N/A'}
            color="blue"
          />
          <MetricCard
            icon={BarChart3}
            label="Current Ratio"
            value={calculated_metrics.current_ratio || 'N/A'}
            color="purple"
          />
          <MetricCard
            icon={ShieldCheck}
            label="Debt to Equity"
            value={calculated_metrics.debt_to_equity || 'N/A'}
            color="amber"
          />
          <MetricCard
            icon={DollarSign}
            label="Net Profit Margin"
            value={calculated_metrics.net_profit_margin || 'N/A'}
            color="emerald"
          />
          <MetricCard
            icon={TrendingUp}
            label="Operating Margin"
            value={calculated_metrics.operating_margin || 'N/A'}
            color="blue"
          />
          <MetricCard
            icon={ShieldCheck}
            label="Corporate Score"
            value={calculated_metrics.fico_score.toString()}
            color="pink"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            icon={TrendingUp}
            label="Debt-to-Income"
            value={calculated_metrics.dti}
            color="blue"
          />
          <MetricCard
            icon={BarChart3}
            label="Utilization"
            value={calculated_metrics.utilization}
            color="purple"
          />
          <MetricCard
            icon={DollarSign}
            label="Cash Flow Margin"
            value={calculated_metrics.cash_flow_margin}
            color="emerald"
          />
          <MetricCard
            icon={ShieldCheck}
            label="FICO Score"
            value={calculated_metrics.fico_score.toString()}
            color="amber"
          />
        </div>
      )}

      {/* Customer/Corporate Summary */}
      <div className="rounded-xl bg-slate-900/50 border border-slate-800 p-5">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-300">
            {calculated_metrics.is_corporate ? 'Corporate Financial Summary' : 'Customer Summary'}
          </h3>
        </div>
        {calculated_metrics.is_corporate ? (
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <SummaryRow label="Annual Revenue" value={customer_summary.revenue ? `$${customer_summary.revenue.toLocaleString()}` : 'N/A'} />
            <SummaryRow label="EBITDA" value={customer_summary.ebitda ? `$${customer_summary.ebitda.toLocaleString()}` : 'N/A'} />
            <SummaryRow label="Net Income" value={customer_summary.net_income ? `$${customer_summary.net_income.toLocaleString()}` : 'N/A'} />
            <SummaryRow label="Current Assets" value={customer_summary.current_assets ? `$${customer_summary.current_assets.toLocaleString()}` : 'N/A'} />
            <SummaryRow label="Current Liabilities" value={customer_summary.current_liabilities ? `$${customer_summary.current_liabilities.toLocaleString()}` : 'N/A'} />
            <SummaryRow label="Total Assets" value={customer_summary.total_assets ? `$${customer_summary.total_assets.toLocaleString()}` : 'N/A'} />
            <SummaryRow label="Total Liabilities" value={customer_summary.total_liabilities ? `$${customer_summary.total_liabilities.toLocaleString()}` : 'N/A'} />
            <SummaryRow label="Shareholders' Equity" value={customer_summary.equity ? `$${customer_summary.equity.toLocaleString()}` : 'N/A'} />
            <SummaryRow label="Generated" value={report.report_metadata.generated_at ? new Date(report.report_metadata.generated_at).toLocaleString() : 'N/A'} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <SummaryRow label="Monthly Income" value={`$${customer_summary.gross_monthly_income.toLocaleString()}`} />
            <SummaryRow label="Monthly Debt" value={`$${customer_summary.total_monthly_debt_payments.toLocaleString()}`} />
            <SummaryRow label="Available Credit" value={`$${customer_summary.total_available_credit.toLocaleString()}`} />
            <SummaryRow label="Outstanding Credit" value={`$${customer_summary.total_outstanding_credit.toLocaleString()}`} />
            <SummaryRow label="Monthly Expenses" value={`$${customer_summary.total_monthly_expenses.toLocaleString()}`} />
            <SummaryRow label="Generated" value={report.report_metadata.generated_at ? new Date(report.report_metadata.generated_at).toLocaleString() : 'N/A'} />
          </div>
        )}
      </div>

      {/* Models Used */}
      {report.report_metadata.models_used && Object.keys(report.report_metadata.models_used).length > 0 && (
        <div className="rounded-xl bg-slate-900/50 border border-slate-800 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Cpu className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-300">Models Used</h3>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2">
            {Object.entries(report.report_metadata.models_used).map(([agent, model]) => (
              <div key={agent} className="flex justify-between items-center">
                <span className="text-xs text-slate-500 capitalize">{agent}</span>
                <span className="text-xs text-slate-400 font-mono">{model}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pipeline footer */}
      <div className="flex items-center justify-center gap-2 text-xs text-slate-600">
        <Clock className="w-3 h-3" />
        Pipeline v{report.report_metadata.pipeline_version}
      </div>
    </motion.div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className={`rounded-xl bg-${color}-500/5 border border-${color}-500/10 p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 text-${color}-400`} />
        <p className="text-xs text-slate-500">{label}</p>
      </div>
      <p className={`text-xl font-bold text-${color}-300`}>{value}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm text-slate-300 font-medium">{value}</span>
    </div>
  );
}
