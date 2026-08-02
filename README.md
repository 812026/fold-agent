# fold-agent

Minimal event-sourced agent runtime on Cloudflare Durable Objects.

Every action becomes an event.  
A pure reducer folds the ordered event log into current state.  
Clients stay in sync over a live WebSocket stream.

## Features

- One Durable Object = one agent session
- Append-only event log (source of truth)
- Pure reducer → deterministic state
- Live WebSocket streaming
- Clean projected UI

## Quick Start

```bash
npm install
npx wrangler login
npm run dev
