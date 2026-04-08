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
import { z } from "zod";

const API_URL = "https://interface.xbtfx.com";
const API_KEY = process.env.XBTFX_API_KEY;

if (!API_KEY) {
  console.error("Error: XBTFX_API_KEY environment variable is required");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const API_TIMEOUT_MS = 15_000;

interface ApiResponse {
  status: number;
  data: any;
  rateLimitRemaining?: number;
  rateLimitBudget?: number;
}

async function apiGet(path: string, params?: Record<string, string>): Promise<ApiResponse> {
  const url = new URL(`${API_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${API_KEY}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body}`);
    }
    return {
      status: res.status,
      data: await res.json(),
      rateLimitRemaining: Number(res.headers.get("X-RateLimit-Remaining")) || undefined,
      rateLimitBudget: Number(res.headers.get("X-RateLimit-Budget")) || undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function apiPost(
  path: string,
  data: Record<string, any>,
  idempotencyKey?: string,
): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    // Allow 207 through for reverse partial-failure
    if (!res.ok && res.status !== 207) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body}`);
    }
    return {
      status: res.status,
      data: await res.json(),
      rateLimitRemaining: Number(res.headers.get("X-RateLimit-Remaining")) || undefined,
      rateLimitBudget: Number(res.headers.get("X-RateLimit-Budget")) || undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

function textResult(resp: ApiResponse) {
  let text = JSON.stringify(resp.data, null, 2);
  if (resp.rateLimitRemaining !== undefined && resp.rateLimitBudget !== undefined) {
    text += `\n\n[Rate limit: ${resp.rateLimitRemaining}/${resp.rateLimitBudget} remaining]`;
  }
  return {
    content: [{ type: "text" as const, text }],
  };
}

function warnResult(resp: ApiResponse, warning: string) {
  let text = `⚠️ ${warning}\n\n${JSON.stringify(resp.data, null, 2)}`;
  if (resp.rateLimitRemaining !== undefined && resp.rateLimitBudget !== undefined) {
    text += `\n\n[Rate limit: ${resp.rateLimitRemaining}/${resp.rateLimitBudget} remaining]`;
  }
  return {
    content: [{ type: "text" as const, text }],
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
  version: "1.1.0",
});

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

server.tool(
  "get_auth_status",
  "Check API key status — returns login, margin mode (hedging/netting), permissions, and tier. Call this once at session start.",
  {},
  { readOnlyHint: true, destructiveHint: false },
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
  "Get account balance, equity, margin, free margin, unrealized P&L, and leverage",
  {},
  { readOnlyHint: true, destructiveHint: false },
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
  "List open positions with ticket, symbol, side, volume, entry/current price, SL/TP, and P&L. Optionally filter by symbol.",
  {
    symbol: z.string().optional().describe("Filter by symbol (e.g. EURUSD). Omit to list all."),
  },
  { readOnlyHint: true, destructiveHint: false },
  async ({ symbol }) => {
    try {
      const params: Record<string, string> = {};
      if (symbol) params.symbol = symbol;
      return textResult(await apiGet("/v1/positions", Object.keys(params).length ? params : undefined));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "get_orders",
  "List pending limit/stop orders with ticket, symbol, type, volume, and trigger price",
  {},
  { readOnlyHint: true, destructiveHint: false },
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
  "Get trade deal history. Use EITHER a preset period OR a from/to date range, not both. Custom ranges limited to 90 days. Costs 2 weight.",
  {
    period: z
      .enum(["today", "last_3_days", "last_week", "last_month", "last_3_months", "last_6_months", "all"])
      .optional()
      .describe("Preset period. Do not combine with from/to."),
    from: z.string().optional().describe("Start date YYYY-MM-DD (use with 'to', not with 'period')"),
    to: z.string().optional().describe("End date YYYY-MM-DD (use with 'from', not with 'period')"),
  },
  { readOnlyHint: true, destructiveHint: false },
  async ({ period, from, to }) => {
    try {
      if (period && (from || to)) {
        return errorResult("Use either 'period' or 'from'+'to', not both.");
      }
      if ((from && !to) || (to && !from)) {
        return errorResult("Both 'from' and 'to' are required for custom date range.");
      }
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
  "List all 400+ tradeable symbols with bid/ask. Warning: large response, costs 2 weight. Prefer get_symbol for a single instrument.",
  {},
  { readOnlyHint: true, destructiveHint: false },
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
  "Get detailed spec for one symbol — digits, contract size, volume min/max/step, spread, margin rate, swap rates, trading sessions, and live bid/ask. Call before trading to validate volume.",
  {
    symbol: z.string().describe("Symbol name, e.g. EURUSD, XAUUSD, NDXUSD"),
  },
  { readOnlyHint: true, destructiveHint: false },
  async ({ symbol }) => {
    try {
      return textResult(await apiGet(`/v1/symbols/${symbol}`));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "get_quote",
  "Get the current live bid/ask price for one or more symbols. Returns prices from the Continuum feed. Use this to check prices before trading or to monitor price levels.",
  {
    symbols: z.array(z.string()).min(1).max(20).describe("Array of symbol names, e.g. [\"EURUSD\", \"XAUUSD\"]. Max 20."),
  },
  { readOnlyHint: true, destructiveHint: false },
  async ({ symbols }) => {
    try {
      if (symbols.length === 1) {
        const resp = await apiGet(`/v1/symbols/${symbols[0]}`);
        const d = resp.data;
        resp.data = {
          symbol: d.symbol,
          bid: d.bid,
          ask: d.ask,
          spread: d.spread,
          digits: d.digits,
        };
        return textResult(resp);
      }
      // Multiple symbols — fetch full list and filter
      const resp = await apiGet("/v1/symbols");
      const requested = new Set(symbols.map((s: string) => s.toUpperCase()));
      const quotes = resp.data.symbols
        .filter((s: any) => requested.has(s.name))
        .map((s: any) => ({
          symbol: s.name,
          bid: s.bid,
          ask: s.ask,
          spread: s.spread,
          digits: s.digits,
        }));
      resp.data = { quotes, count: quotes.length };
      return textResult(resp);
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

// ---------------------------------------------------------------------------
// Trading tools
// ---------------------------------------------------------------------------

server.tool(
  "trade",
  "Open a new position (market order). Call get_symbol first to check volume_min/max/step. Confirm with user before executing.",
  {
    symbol: z.string().describe("Trading symbol, e.g. EURUSD"),
    side: z.enum(["buy", "sell"]).describe("Trade direction"),
    volume: z.number().positive().describe("Lot size (e.g. 0.01). Must respect symbol volume constraints."),
    sl: z.number().optional().describe("Stop loss price"),
    tp: z.number().optional().describe("Take profit price"),
    comment: z.string().max(27).optional().describe("Trade comment, max 27 ASCII chars. Prefixed with -API in MT5."),
    idempotency_key: z
      .string()
      .optional()
      .describe("Unique key to prevent duplicate trades on retry. Auto-generated if omitted."),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async ({ symbol, side, volume, sl, tp, comment, idempotency_key }) => {
    try {
      const data: Record<string, any> = { symbol, side, volume };
      if (sl !== undefined) data.sl = sl;
      if (tp !== undefined) data.tp = tp;
      if (comment !== undefined) data.comment = comment;
      const idem = idempotency_key ?? `mcp-trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      return textResult(await apiPost("/v1/trade", data, idem));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "close_position",
  "Close an open position by ticket. Omit volume for full close, or specify volume for partial close.",
  {
    ticket: z.number().int().positive().describe("Position ticket number"),
    volume: z.number().positive().optional().describe("Partial close volume in lots (omit for full close)"),
    comment: z.string().max(27).optional().describe("Close comment, max 27 ASCII chars"),
    idempotency_key: z.string().optional().describe("Unique key to prevent duplicate close on retry. Auto-generated if omitted."),
  },
  { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async ({ ticket, volume, comment, idempotency_key }) => {
    try {
      const data: Record<string, any> = { ticket };
      if (volume !== undefined) data.volume = volume;
      if (comment !== undefined) data.comment = comment;
      const idem = idempotency_key ?? `mcp-close-${ticket}-${Date.now()}`;
      return textResult(await apiPost("/v1/close", data, idem));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "modify_position",
  "Update SL and/or TP on an open position. Pass 0 to remove SL or TP. At least one of sl or tp is required.",
  {
    ticket: z.number().int().positive().describe("Position ticket number"),
    sl: z.number().optional().describe("New stop loss price (0 to remove)"),
    tp: z.number().optional().describe("New take profit price (0 to remove)"),
  },
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async ({ ticket, sl, tp }) => {
    try {
      if (sl === undefined && tp === undefined) {
        return errorResult("At least one of 'sl' or 'tp' must be provided.");
      }
      const data: Record<string, any> = { ticket };
      if (sl !== undefined) data.sl = sl;
      if (tp !== undefined) data.tp = tp;
      const idem = `mcp-modify-${ticket}-${Date.now()}`;
      return textResult(await apiPost("/v1/modify", data, idem));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "close_by",
  "Close two opposing positions against each other (saves spread on smaller side). Hedging accounts only — check get_auth_status first. Returns 400 on netting accounts.",
  {
    position: z.number().int().positive().describe("First position ticket"),
    position_by: z.number().int().positive().describe("Opposing position ticket (same symbol, opposite side)"),
    comment: z.string().max(27).optional().describe("Close-by comment, max 27 ASCII chars"),
    idempotency_key: z.string().optional().describe("Unique key to prevent duplicate close-by on retry. Auto-generated if omitted."),
  },
  { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async ({ position, position_by, comment, idempotency_key }) => {
    try {
      const data: Record<string, any> = { position, position_by };
      if (comment !== undefined) data.comment = comment;
      const idem = idempotency_key ?? `mcp-closeby-${position}-${position_by}-${Date.now()}`;
      return textResult(await apiPost("/v1/close-by", data, idem));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "reverse_position",
  "Close a position and immediately open the opposite side with same volume. Two-step composite — if the re-open fails (207), the position is already closed. Costs 2 weight.",
  {
    ticket: z.number().int().positive().describe("Position ticket to reverse"),
    comment: z.string().max(27).optional().describe("Reverse comment, max 27 ASCII chars"),
    idempotency_key: z.string().optional().describe("Unique key to prevent duplicate reverse on retry. Auto-generated if omitted."),
  },
  { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async ({ ticket, comment, idempotency_key }) => {
    try {
      const data: Record<string, any> = { ticket };
      if (comment !== undefined) data.comment = comment;
      const idem = idempotency_key ?? `mcp-reverse-${ticket}-${Date.now()}`;
      const resp = await apiPost("/v1/reverse", data, idem);
      if (resp.status === 207) {
        return warnResult(
          resp,
          "PARTIAL FAILURE: The position was closed but the reverse open failed. " +
          "The user may need to re-enter manually. Do NOT retry automatically.",
        );
      }
      return textResult(resp);
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "close_all",
  "Close ALL open positions on the account. Destructive bulk operation — confirm with user first. Costs 10 weight.",
  {
    comment: z.string().max(27).optional().describe("Applied to all close operations"),
    idempotency_key: z.string().optional().describe("Unique key to prevent duplicate bulk close. Auto-generated if omitted."),
  },
  { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async ({ comment, idempotency_key }) => {
    try {
      const data: Record<string, any> = {};
      if (comment !== undefined) data.comment = comment;
      const idem = idempotency_key ?? `mcp-closeall-${Date.now()}`;
      return textResult(await apiPost("/v1/close-all", data, idem));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

server.tool(
  "close_symbol",
  "Close all positions for a specific symbol. Destructive — confirm with user first. Costs 10 weight.",
  {
    symbol: z.string().describe("Symbol to close all positions for, e.g. EURUSD"),
    comment: z.string().max(27).optional().describe("Applied to all close operations"),
    idempotency_key: z.string().optional().describe("Unique key to prevent duplicate. Auto-generated if omitted."),
  },
  { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async ({ symbol, comment, idempotency_key }) => {
    try {
      const data: Record<string, any> = { symbol };
      if (comment !== undefined) data.comment = comment;
      const idem = idempotency_key ?? `mcp-closesym-${symbol}-${Date.now()}`;
      return textResult(await apiPost("/v1/close-symbol", data, idem));
    } catch (e: any) {
      return errorResult(e.message);
    }
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
