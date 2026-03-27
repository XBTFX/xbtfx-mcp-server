#!/usr/bin/env node

/**
 * XBTFX Trading API — MCP Server
 *
 * Exposes the XBTFX Trading API as MCP tools so AI agents
 * (Claude Code, Cursor, etc.) can trade forex, metals, indices,
 * and crypto directly.
 *
 * Configuration:
 *   Set XBTFX_API_KEY environment variable before starting.
 *
 * Usage with Claude Code:
 *   claude mcp add xbtfx-trading -- npx @xbtfx/mcp-trading
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";

const API_URL = "https://interface.xbtfx.com";
const API_KEY = process.env.XBTFX_API_KEY;

if (!API_KEY) {
  console.error("Error: XBTFX_API_KEY environment variable is required");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function apiGet(path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${API_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

async function apiPost(
  path: string,
  data: Record<string, any>,
  idempotencyKey?: string,
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

function textResult(data: any) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(msg: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: msg }],
  };
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "xbtfx-trading",
  version: "1.0.0",
});

// ── Read tools ─────────────────────────────────────────────────────────────

server.tool(
  "get_auth_status",
  "Check API key status — returns login number, margin mode, permissions, and rate limit tier",
  {},
  async () => {
    try {
      return textResult(await apiGet("/v1/auth/status"));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "get_account",
  "Get account balance, equity, margin, free margin, open P&L, and leverage",
  {},
  async () => {
    try {
      return textResult(await apiGet("/v1/account"));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "get_positions",
  "List all open positions with ticket, symbol, side, volume, prices, SL/TP, and P&L",
  {},
  async () => {
    try {
      return textResult(await apiGet("/v1/positions"));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "get_orders",
  "List all pending orders (limit/stop) with ticket, symbol, type, volume, and trigger price",
  {},
  async () => {
    try {
      return textResult(await apiGet("/v1/orders"));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "get_history",
  "Get deal history. Period: today, last_week, last_month, last_3_months, or a custom date range",
  {
    period: z
      .enum(["today", "last_week", "last_month", "last_3_months"])
      .optional()
      .describe("Predefined period (default: today)"),
    from: z.string().optional().describe("Start date ISO 8601 (e.g. 2026-03-01T00:00:00Z)"),
    to: z.string().optional().describe("End date ISO 8601"),
  },
  async ({ period, from, to }) => {
    try {
      const params: Record<string, string> = {};
      if (period) params.period = period;
      if (from) params.from = from;
      if (to) params.to = to;
      return textResult(await apiGet("/v1/history", params));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "get_symbols",
  "List all available trading symbols with current bid/ask prices. Returns 400+ instruments",
  {},
  async () => {
    try {
      return textResult(await apiGet("/v1/symbols"));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "get_symbol",
  "Get detailed specification for a single symbol — digits, contract size, volume limits, spread, tradeable status",
  {
    symbol: z.string().describe("Symbol name, e.g. EURUSD, XAUUSD, NDXUSD"),
  },
  async ({ symbol }) => {
    try {
      return textResult(await apiGet(`/v1/symbols/${symbol}`));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

// ── Trading tools ──────────────────────────────────────────────────────────

server.tool(
  "trade",
  "Open a new position. Supports optional SL/TP. Volume must respect the symbol's volume_min/volume_max/volume_step",
  {
    symbol: z.string().describe("Trading symbol, e.g. EURUSD"),
    side: z.enum(["buy", "sell"]).describe("Trade direction"),
    volume: z.number().positive().describe("Lot size (e.g. 0.01)"),
    sl: z.number().optional().describe("Stop loss price"),
    tp: z.number().optional().describe("Take profit price"),
    idempotency_key: z
      .string()
      .optional()
      .describe("Unique key to prevent duplicate trades (recommended)"),
  },
  async ({ symbol, side, volume, sl, tp, idempotency_key }) => {
    try {
      const data: Record<string, any> = { symbol, side, volume };
      if (sl !== undefined) data.sl = sl;
      if (tp !== undefined) data.tp = tp;
      const idem = idempotency_key ?? `mcp-trade-${Date.now()}`;
      return textResult(await apiPost("/v1/trade", data, idem));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "close_position",
  "Close an open position by ticket number. Optionally close only a partial volume",
  {
    ticket: z.number().int().positive().describe("Position ticket number"),
    volume: z.number().positive().optional().describe("Partial close volume (omit to close full position)"),
  },
  async ({ ticket, volume }) => {
    try {
      const data: Record<string, any> = { ticket };
      if (volume !== undefined) data.volume = volume;
      return textResult(await apiPost("/v1/close", data));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "modify_position",
  "Modify SL and/or TP on an existing position. Pass 0 to remove SL or TP",
  {
    ticket: z.number().int().positive().describe("Position ticket number"),
    sl: z.number().optional().describe("New stop loss price (0 to remove)"),
    tp: z.number().optional().describe("New take profit price (0 to remove)"),
  },
  async ({ ticket, sl, tp }) => {
    try {
      const data: Record<string, any> = { ticket };
      if (sl !== undefined) data.sl = sl;
      if (tp !== undefined) data.tp = tp;
      return textResult(await apiPost("/v1/modify", data));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "close_by",
  "Close a position against an opposite position on the same symbol (hedging mode only)",
  {
    ticket: z.number().int().positive().describe("Position to close"),
    close_by_ticket: z.number().int().positive().describe("Opposite position to close against"),
  },
  async ({ ticket, close_by_ticket }) => {
    try {
      return textResult(
        await apiPost("/v1/close-by", { ticket, close_by_ticket }),
      );
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "reverse_position",
  "Reverse a position — closes current and opens opposite direction with same volume",
  {
    ticket: z.number().int().positive().describe("Position ticket to reverse"),
  },
  async ({ ticket }) => {
    try {
      return textResult(await apiPost("/v1/reverse", { ticket }));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "close_all",
  "Close ALL open positions on the account. Use with caution",
  {},
  async () => {
    try {
      return textResult(await apiPost("/v1/close-all", {}));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "close_symbol",
  "Close all positions for a specific symbol",
  {
    symbol: z.string().describe("Symbol to close all positions for, e.g. EURUSD"),
  },
  async ({ symbol }) => {
    try {
      return textResult(await apiPost("/v1/close-symbol", { symbol }));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

// ── Start ──────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
