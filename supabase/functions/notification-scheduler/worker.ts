export type Attempt = {
  id: string;
  token: string;
  title: string;
  body: string;
  type: 'DAILY_WORDS' | 'STREAK_AT_RISK';
  userId: string;
  expiresAt: number;
};
export type Ticket = {
  state: 'ticket_accepted' | 'send_rejected' | 'uncertain';
  ticketId?: string;
  error?: string;
};
export type Receipt = { status: 'ok' | 'error'; error?: string };
export type ReceiptTarget = { id: string; ticketId: string };
export type NotificationStore = {
  claim: () => Promise<{ attempts: Attempt[]; failed: number }>;
  authorize: (id: string) => Promise<boolean>;
  result: (id: string, ticket: Ticket) => Promise<void>;
  receipts: () => Promise<ReceiptTarget[]>;
  receipt: (target: ReceiptTarget, receipt: Receipt) => Promise<void>;
};
export type PushTransport = {
  send: (attempts: Attempt[]) => Promise<Ticket[]>;
  receipts: (ids: string[]) => Promise<Map<string, Receipt>>;
};

// A claimed attempt is NEVER returned by the database again, even after a crash.
// Only provider receipt reads are retried by later jobs. No provider send retry loop.
export async function runNotificationJob(store: NotificationStore, provider: PushTransport) {
  const counts = {
    attempted: 0,
    ticketAccepted: 0,
    rejected: 0,
    uncertain: 0,
    preparationFailures: 0,
    recordFailures: 0,
    receiptsChecked: 0,
    receiptFailures: 0,
  };
  const claimed = await store.claim();
  counts.attempted = claimed.attempts.length;
  counts.preparationFailures = claimed.failed;
  // One recipient per HTTP call isolates invalid/foreign-project tokens. Four
  // concurrent calls cap provider pressure without introducing send retries.
  for (let offset = 0; offset < claimed.attempts.length; offset += 4) {
    await Promise.all(
      claimed.attempts.slice(offset, offset + 4).map(async (attempt) => {
        let ticket: Ticket;
        try {
          const authorized = await store.authorize(attempt.id);
          const results = authorized
            ? await provider.send([attempt])
            : [{ state: 'send_rejected' as const, error: 'EligibilityChanged' }];
          ticket =
            results.length === 1 ? results[0] : { state: 'uncertain', error: 'MalformedResponse' };
        } catch {
          ticket = { state: 'uncertain', error: 'NetworkError' };
        }
        if (ticket.state === 'ticket_accepted') counts.ticketAccepted++;
        else if (ticket.state === 'send_rejected') counts.rejected++;
        else counts.uncertain++;
        try {
          await store.result(attempt.id, ticket);
        } catch {
          counts.recordFailures++;
        }
      }),
    );
  }
  const targets = await store.receipts();
  if (targets.length) {
    try {
      const receipts = await provider.receipts(targets.map((target) => target.ticketId));
      await Promise.all(
        targets.map(async (target) => {
          const receipt = receipts.get(target.ticketId);
          if (!receipt) return;
          counts.receiptsChecked++;
          try {
            await store.receipt(target, receipt);
          } catch {
            counts.recordFailures++;
          }
        }),
      );
    } catch {
      counts.receiptFailures++;
    }
  }
  return counts;
}
