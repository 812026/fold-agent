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
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);

      server.send(
        JSON.stringify({
          type: "snapshot",
          events: this.events,
          state: this.state,
        })
      );

      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === "POST" && url.pathname === "/command") {
      const body = (await request.json()) as { content: string };
      if (!body.content?.trim()) {
        return new Response("Missing content", { status: 400 });
      }

      const ts = Date.now();

      await this.append({
        type: "user_message",
        id: crypto.randomUUID(),
        content: body.content.trim(),
        ts,
      });

      await this.append({
        type: "agent_thought",
        id: crypto.randomUUID(),
        content: "Thinking...",
        ts: Date.now(),
      });

      const replies = [
        "Got it. I've updated the state.",
        "Interesting. Event log has been folded.",
        "Understood. Here's my response.",
        "State reduced successfully from the durable log.",
        "Processing complete."
      ];
      const reply = replies[Math.floor(Math.random() * replies.length)];

      await this.append({
        type: "agent_response",
        id: crypto.randomUUID(),
        content: reply,
        ts: Date.now(),
      });

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const session = url.searchParams.get("session") || "demo";

    if (url.pathname === "/ws" || url.pathname === "/command") {
      const id = env.AGENT_SESSION.idFromName(session);
      const stub = env.AGENT_SESSION.get(id);
      return stub.fetch(request);
    }

    return new Response(getHTML(session), {
      headers: { "Content-Type": "text/html" },
    });
  },
};

function getHTML(session: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>fold-agent</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0c0c0f;
      color: #e4e4e7;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      padding: 14px 20px;
      border-bottom: 1px solid #27272a;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    h1 { font-size: 16px; font-weight: 600; }
    .status { font-size: 13px; color: #71717a; }
    main {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 1fr;
      overflow: hidden;
    }
    .panel {
      display: flex;
      flex-direction: column;
      border-right: 1px solid #27272a;
    }
    .panel:last-child { border-right: none; }
    .panel-header {
      padding: 10px 16px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #a1a1aa;
      background: #18181b;
      border-bottom: 1px solid #27272a;
    }
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }
    .msg {
      margin-bottom: 12px;
      padding: 10px 14px;
      border-radius: 10px;
      max-width: 85%;
      font-size: 14px;
      line-height: 1.4;
    }
    .msg.user {
      background: #1d4ed8;
      margin-left: auto;
    }
    .msg.agent {
      background: #27272a;
    }
    .event {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      padding: 8px 0;
      border-bottom: 1px solid #1f1f23;
      color: #a1a1aa;
    }
    .event .type { color: #38bdf8; font-weight: 500; }
    footer {
      padding: 14px 16px;
      border-top: 1px solid #27272a;
      display: flex;
      gap: 10px;
    }
    input {
      flex: 1;
      background: #18181b;
      border: 1px solid #3f3f46;
      color: white;
      padding: 11px 14px;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
    }
    input:focus { border-color: #52525b; }
    button {
      background: #2563eb;
      color: white;
      border: none;
      padding: 0 18px;
      border-radius: 8px;
      font-weight: 500;
      cursor: pointer;
    }
    button:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <header>
    <h1>fold-agent</h1>
    <div class="status" id="status">Connecting...</div>
  </header>

  <main>
    <div class="panel">
      <div class="panel-header">Chat (Projected State)</div>
      <div class="content" id="chat"></div>
    </div>
    <div class="panel">
      <div class="panel-header">Event Log (Source of Truth)</div>
      <div class="content" id="events"></div>
    </div>
  </main>

  <footer>
    <input id="input" placeholder="Type a message..." autocomplete="off" />
    <button onclick="send()">Send</button>
  </footer>

  <script>
    const session = "${session}";
    const chatEl = document.getElementById("chat");
    const eventsEl = document.getElementById("events");
    const statusEl = document.getElementById("status");
    const input = document.getElementById("input");

    let ws;

    function connect() {
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(protocol + "://" + location.host + "/ws?session=" + session);

      ws.onopen = () => {
        statusEl.textContent = "Connected • session: " + session;
      };

      ws.onclose = () => {
        statusEl.textContent = "Disconnected – reconnecting...";
        setTimeout(connect, 1500);
      };

      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === "snapshot") {
          eventsEl.innerHTML = "";
          data.events.forEach(addEvent);
          renderState(data.state);
        } else if (data.type === "event") {
          addEvent(data.event);
          renderState(data.state);
        }
      };
    }

    function addEvent(ev) {
      const div = document.createElement("div");
      div.className = "event";
      div.innerHTML = '<span class="type">' + ev.type + '</span> · ' + ev.content;
      eventsEl.appendChild(div);
      eventsEl.scrollTop = eventsEl.scrollHeight;
    }

    function renderState(state) {
      chatEl.innerHTML = "";
      state.messages.forEach((m) => {
        const div = document.createElement("div");
        div.className = "msg " + m.role;
        div.textContent = m.content;
        chatEl.appendChild(div);
      });
      chatEl.scrollTop = chatEl.scrollHeight;
    }

    async function send() {
      const content = input.value.trim();
      if (!content) return;
      input.value = "";

      await fetch("/command?session=" + session, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") send();
    });

    connect();
  </script>
</body>
</html>`;
}