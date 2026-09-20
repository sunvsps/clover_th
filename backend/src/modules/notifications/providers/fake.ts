import type { NotificationProvider, OutboundMessage, SendResult } from '../types.js';

/** In-memory provider for tests and local dev. Outcomes can be scripted (consumed in order, default ok). */
export class FakeProvider implements NotificationProvider {
  sent: OutboundMessage[] = [];
  attempts: OutboundMessage[] = [];
  private script: SendResult[] = [];
  private byTarget = new Map<'DM' | 'CHANNEL', SendResult[]>();

  queue(...results: SendResult[]) {
    this.script.push(...results);
  }
  queueFor(target: 'DM' | 'CHANNEL', ...results: SendResult[]) {
    this.byTarget.set(target, [...(this.byTarget.get(target) ?? []), ...results]);
  }
  reset() {
    this.sent = [];
    this.attempts = [];
    this.script = [];
    this.byTarget.clear();
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    this.attempts.push(msg);
    const r = this.byTarget.get(msg.target)?.shift() ?? this.script.shift() ?? { ok: true as const };
    if (r.ok) this.sent.push(msg);
    return r;
  }
}

export const fakeProvider = new FakeProvider();
