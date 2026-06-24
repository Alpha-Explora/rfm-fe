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
export function buildAssessmentMessage(clientName: string, data: string): string {
  return [
    `Run a full credit assessment for "${clientName}" using the RFM pipeline.`,
    `Delegate to ingest -> analytics -> risk -> reporting, then return the final CreditReport JSON.`,
    ``,
    `Raw financial data:`,
    data || '{}',
  ].join('\n');
}
