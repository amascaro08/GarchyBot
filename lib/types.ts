import { z } from 'zod';

// Candle data structure
export const CandleSchema = z.object({
  ts: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

export type Candle = z.infer<typeof CandleSchema>;

// Levels request/response
export const LevelsRequestSchema = z.object({
  symbol: z.string(),
  kPct: z.number().min(0.01).max(0.1).optional(), // Optional - will be calculated from daily candles if not provided
  subdivisions: z.number().int().min(1).max(50),
});

export type LevelsRequest = z.infer<typeof LevelsRequestSchema>;

export const LevelsResponseSchema = z.object({
  symbol: z.string(),
  kPct: z.number(),
  dOpen: z.number(),
  upper: z.number(),
  lower: z.number(),
  upLevels: z.array(z.number()),
  dnLevels: z.array(z.number()),
  vwap: z.number(), // Current VWAP (for backward compatibility)
  vwapLine: z.array(z.number().nullable()), // Progressive VWAP values per candle
  dataSource: z.string().optional(), // For debugging
});

export type LevelsResponse = z.infer<typeof LevelsResponseSchema>;

// Signal request/response
export const SignalRequestSchema = z.object({
  symbol: z.string(),
  kPct: z.number().min(0.01).max(0.1),
  subdivisions: z.number().int().min(1).max(50),
  noTradeBandPct: z.number().min(0).max(0.01).default(0.001),
  candles: z.array(CandleSchema),
});

export type SignalRequest = z.infer<typeof SignalRequestSchema>;

export const SignalResponseSchema = z.object({
  symbol: z.string(),
  signal: z.enum(['LONG', 'SHORT']).nullable(),
  touchedLevel: z.number().nullable(),
  tp: z.number().nullable(),
  sl: z.number().nullable(),
  reason: z.string(),
});

export type SignalResponse = z.infer<typeof SignalResponseSchema>;

// Order request/response
export const OrderRequestSchema = z.object({
  symbol: z.string(),
  side: z.enum(['Buy', 'Sell']),
  qty: z.number().positive(),
  price: z.number().positive().optional(),
  testnet: z.boolean().default(true),
});

export type OrderRequest = z.infer<typeof OrderRequestSchema>;

export const OrderResponseSchema = z.object({
  ok: z.boolean(),
  details: z.any(),
});

export type OrderResponse = z.infer<typeof OrderResponseSchema>;

// Volatility request/response
export const VolRequestSchema = z.object({
  symbol: z.string(),
  closes: z.array(z.number()),
});

export type VolRequest = z.infer<typeof VolRequestSchema>;

export const VolResponseSchema = z.object({
  symbol: z.string(),
  k_pct: z.number(),
});

export type VolResponse = z.infer<typeof VolResponseSchema>;
