import type { DB } from "../db/index.js";
import { logEvent } from "../db/index.js";
import type { Lead } from "./leads.js";

/** Where leads go besides the local CRM view. */
export interface CrmAdapter {
  readonly name: string;
  pushLead(lead: Lead, context: { profileName: string; event: string }): Promise<void>;
}

/** Leads stay in SQLite only (the dashboard's CRM view). */
export class LocalCrm implements CrmAdapter {
  readonly name = "local";
  constructor(private readonly db: DB) {}
  async pushLead(lead: Lead) {
    this.db.prepare("UPDATE leads SET crm_pushed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(lead.id);
  }
}

/**
 * POSTs each lead as JSON to a webhook (Zapier, Make, n8n, HubSpot workflow...). One retry, then the
 * failure is logged and the call carries on: a CRM hiccup must never break a live conversation.
 */
export class WebhookCrm implements CrmAdapter {
  readonly name = "webhook";
  constructor(
    private readonly db: DB,
    private readonly url: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async pushLead(lead: Lead, context: { profileName: string; event: string }) {
    const payload = {
      event: context.event,
      business: context.profileName,
      lead: {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        interest: lead.interest,
        status: lead.status,
        qualified: lead.qualified,
        notFitReason: lead.notFitReason,
        answers: lead.qualification,
      },
    };
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await this.fetchFn(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          this.db.prepare("UPDATE leads SET crm_pushed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(lead.id);
          return;
        }
      } catch {
        // retry below
      }
    }
    logEvent(this.db, { profileId: lead.profileId, kind: "system", name: "crm_push_failed", detail: { leadId: lead.id } });
  }
}
