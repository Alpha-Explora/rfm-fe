export interface CreditReport {
  customer_summary: {
    gross_monthly_income: number;
    total_monthly_debt_payments: number;
    total_available_credit: number;
    total_outstanding_credit: number;
    total_monthly_expenses: number;
  };
  calculated_metrics: {
    dti: string;
    utilization: string;
    cash_flow_margin: string;
    fico_score: number;
  };
  risk_assessment: {
    tier: string;
    repayment_days: number;
    flag_for_manual_review: boolean;
    reasons: string[];
  };
  report_metadata: {
    generated_at: string;
    pipeline_version: string;
    models_used?: Record<string, string>;
  };
}

export interface PipelineResult {
  success: boolean;
  report?: CreditReport;
  error?: string;
  step?: string;
}
