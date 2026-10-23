/** Minimal Vapi REST client: only what the server needs (assistant sync and outbound phone calls). */
export class VapiClient {
  constructor(
    private readonly privateKey: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl = "https://api.vapi.ai",
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.privateKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Vapi ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Create the assistant, or update it in place when we already have its id. */
  async upsertAssistant(assistant: object, existingId?: string | null): Promise<{ id: string }> {
    if (existingId) return this.request("PATCH", `/assistant/${existingId}`, assistant);
    return this.request("POST", "/assistant", assistant);
  }

  async createPhoneCall(input: {
    assistantId: string;
    phoneNumberId: string;
    customerNumber: string;
    assistantOverrides: object;
  }): Promise<{ id: string }> {
    return this.request("POST", "/call", {
      assistantId: input.assistantId,
      phoneNumberId: input.phoneNumberId,
      customer: { number: input.customerNumber },
      assistantOverrides: input.assistantOverrides,
    });
  }
}
