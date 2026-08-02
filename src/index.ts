import { DurableObject } from "cloudflare:workers";

export interface Env {
  AGENT_SESSION: DurableObjectNamespace;
}

type Event =
  | { type: "user_message"; id: string; content: string; ts: number }
  | { type: "agent_thought"; id: string; content: string; ts: number }
  | { type: "agent_response"; id: string; content: string; ts: number };

interface State {
  messages: { role: "user" | "agent"; content: string; ts: number }[];
  status: "idle" | "thinking";
}

function reduce(state: State, event: Event): State {
  const next = { ...state, messages: [...state.messages] };

  switch (event.type) {
    case "user_message":
      next.messages.push({ role: "user", content: event.content, ts: event.ts });
      next.status = "thinking";
      break;
    case "agent_thought":
      break;
    case "agent_response":
      next.messages.push({ role: "agent", content: event.content, ts: event.ts });
      next.status = "idle";
      break;
  }
  return next;
}

const initialState: State = {
  messages: [],
  status: "idle",
};

export class AgentSession extends DurableObject {
  private events: Event[] = [];
  private state: State = initialState;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<{ events: Event[]; state: State }>("data");
      if (stored) {
        this.events = stored.events;
        this.state = stored.state;
      }
    });
  }

  private async persist() {
    await this.ctx.storage.put("data", {
      events: this.events,
      state: this.state,
    });
  }

  private async append(event: Event) {
    this.events.push(event);
    this.state = reduce(this.state, event);
    await this.persist();

    this.ctx.getWebSockets().forEach((ws) => {
      try {
        ws.send(JSON.stringify({ type: "event", event, state: this.state }));
      } catch (e) {}
    });
 