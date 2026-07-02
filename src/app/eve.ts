// Eve agent-runtime client.
// Talks to the Eve server (proxied same-origin via Next rewrite at /eve/*).
// Creates a durable session, then streams its NDJSON lifecycle events.

export type EveEvent = {
  type: string;
  data?: Record<string, unknown>;
  meta?: { at?: string };
};

// Create a session and stream its events. Calls onEvent for each parsed NDJSON line.
export async function runEveSession(
  message: string,
  onEvent: (event: EveEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const created = await fetch(`/eve/v1/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  });
  if (!created.ok) throw new Error(`Eve session create failed: ${created.status}`);
  const sessionId = created.headers.get('x-eve-session-id');
  if (!sessionId) throw new Error('Eve did not return a session id');

  const stream = await fetch(`/eve/v1/session/${sessionId}/stream`, { signal });
  if (!stream.ok || !stream.body) throw new Error(`Eve stream failed: ${stream.status}`);

  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { onEvent(JSON.parse(trimmed) as EveEvent); } catch { /* ignore keep-alives / partials */ }
    }
    if (done) break;
  }
}

// Build the assessment prompt sent to the Director agent.
// Drives the ORCHESTRATED Mode A workflow: the Director delegates each stage to a
// specialist subagent instead of calling the one-shot run_assessment tool, so the
// analytics, risk, and reporting subagents genuinely run.
export function buildAssessmentMessage(clientName: string, data: string, industry?: string, documentNames?: string[], webhookUrl?: string, clientId?: string, userId?: string): string {
  return [
    `Run a FULL credit assessment for "${clientName}" using the ORCHESTRATED multi-agent workflow.`,
    `Do NOT call run_assessment. You must orchestrate by delegating each stage to its specialist subagent, in this exact order:`,
    ``,
    clientId
      ? `1. Call \`parse_financials\` with clientId "${clientId}" (omit raw — it fetches the client's documents). It returns { parsed, clientName, industry, documentNames }.`
      : `1. Call \`parse_financials\` with the raw financial data below. It returns { parsed, clientName, industry, documentNames }.`,
    `2. Delegate to the \`analytics\` subagent — pass it the \`parsed\` object; it returns ComputedMetrics.`,
    `3. Delegate to the \`risk\` subagent — pass it the ComputedMetrics; it returns the RiskAssessment.`,
    `4. Delegate to the \`reporting\` subagent — pass it parsed + metrics + risk; it returns the CreditReport.`,
    `5. Call \`run_intelligence\` with parsed, metrics, risk${industry ? `, industry` : ''}, documentNames, clientName — it returns { intelligence, recommendation } (compliance, fraud, loan options, decision).`,
    ...(clientId ? [`6. Call \`save_assessment\` with clientId "${clientId}" and the parsed, metrics, risk, report, intelligence, and recommendation to persist the result.`] : []),
    ...(webhookUrl ? [`7. Call \`trigger_webhook\` with webhookUrl "${webhookUrl}" and a payload of { clientName, recommendation, report }.`] : []),
    `Finally, write a tight 3–5 sentence executive summary from the recommendation, noting any compliance or fraud flag. Use ONLY values the tools returned.`,
    ``,
    `Context:`,
    `- clientName: ${clientName}`,
    ...(clientId ? [`- clientId: ${clientId}`] : []),
    ...(userId ? [`- userId: ${userId} (load your director memories for this user)`] : []),
    ...(industry ? [`- industry: ${industry}`] : []),
    ...(documentNames?.length ? [`- documentNames: ${JSON.stringify(documentNames)}`] : []),
    ...(webhookUrl ? [`- webhookUrl: ${webhookUrl}`] : []),
    ...(data ? [`- raw (financial data):\n${data}`] : []),
  ].join('\n');
}

// True when the financial-data blob has no usable fields (empty / "{}" / whitespace).
function hasNoInlineData(data?: string): boolean {
  if (!data) return true;
  const trimmed = data.trim();
  return trimmed === '' || trimmed === '{}' || trimmed === 'n/a';
}

// Build a lightweight overview prompt — summary only, no full pipeline.
export function buildOverviewMessage(clientName: string, data: string, userId?: string, clientId?: string): string {
  const needsFetch = clientId && hasNoInlineData(data);
  return [
    `Give a brief credit OVERVIEW for client "${clientName}".`,
    ...(clientId ? [`This client is in the database — clientId: ${clientId}.`] : []),
    ...(needsFetch
      ? [`No inline financial data was provided, so FIRST call fetch_client with clientId "${clientId}" to load the client's profile and documents, then base your overview on what it returns.`]
      : []),
    `Summarize the key financial highlights and likely risk indicators in 3-5 short bullet points (start each line with "- ").`,
    `Do NOT run the full four-step assessment pipeline — this is a quick read, not a full report.`,
    `If, after fetching, there is genuinely no financial data on file, say so plainly and suggest running a full assessment or adding documents.`,
    ...(userId ? [`[User ID: ${userId}]`] : []),
    ``,
    `Financial data:`,
    data || '{}',
  ].join('\n');
}

// Build a conversational chat prompt, optionally with active-client context.
export function buildChatMessage(text: string, clientName?: string, data?: string, userId?: string, clientId?: string): string {
  if (!clientName) {
    return userId ? `${text}\n\n[User ID: ${userId}]` : text;
  }
  const needsFetch = clientId && hasNoInlineData(data);
  return [
    text,
    ``,
    `[Context — active client "${clientName}".`,
    ...(clientId ? [`clientId: ${clientId} (in database).`] : []),
    `Inline financial data: ${data || 'n/a'}.`,
    ...(needsFetch
      ? [`Since no inline financial data was provided, if you need this client's numbers or documents to answer, call fetch_client with clientId "${clientId}" first — do not claim you have no data without trying to fetch it.`]
      : []),
    ...(userId ? [`User ID: ${userId}.`] : []),
    `Answer conversationally and concisely. Only run the full assessment pipeline if the user explicitly asks for a full assessment.]`,
  ].join('\n');
}
