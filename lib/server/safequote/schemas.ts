import { z } from "zod";

export const SafeQuoteSummarySchema = z.object({
  range: z
    .object({
      from: z.string().nullable().optional(),
      to: z.string().nullable().optional(),
    })
    .default({ from: null, to: null }),
  submitted: z.coerce.number().default(0),
  validated: z.coerce.number().default(0),
  closeRate: z.coerce.number().default(0),
  returned: z.coerce.number().default(0),
  rejected: z.coerce.number().default(0),
  activeClosers: z.coerce.number().default(0),
  premium: z
    .object({
      total: z.coerce.number().default(0),
      average: z.coerce.number().default(0),
    })
    .default({ total: 0, average: 0 }),
});

export type SafeQuoteSummary = z.infer<typeof SafeQuoteSummarySchema>;

export const SafeQuoteCloserItemSchema = z.object({
  rank: z.coerce.number().default(0),
  userCode: z.string().default(""),
  name: z.string().default("Unknown"),
  submitted: z.coerce.number().default(0),
  validated: z.coerce.number().default(0),
  closeRate: z.coerce.number().default(0),
  returned: z.coerce.number().default(0),
  rejected: z.coerce.number().default(0),
  premiumTotal: z.coerce.number().default(0),
  premiumAverage: z.coerce.number().default(0),
});

export type SafeQuoteCloserItem = z.infer<typeof SafeQuoteCloserItemSchema>;

export const SafeQuoteClosersResponseSchema = z.object({
  closers: z.array(SafeQuoteCloserItemSchema).default([]),
});

export type SafeQuoteClosersResponse = z.infer<typeof SafeQuoteClosersResponseSchema>;

export const SafeQuoteStateItemSchema = z.object({
  state: z.string().default(""),
  submitted: z.coerce.number().default(0),
  validated: z.coerce.number().default(0),
  closeRate: z.coerce.number().default(0),
  premiumTotal: z.coerce.number().default(0),
});

export type SafeQuoteStateItem = z.infer<typeof SafeQuoteStateItemSchema>;

export const SafeQuoteStatesResponseSchema = z.object({
  states: z.array(SafeQuoteStateItemSchema).default([]),
});

export type SafeQuoteStatesResponse = z.infer<typeof SafeQuoteStatesResponseSchema>;

export const SafeQuoteCloserRefSchema = z.union([
  z.string(),
  z.object({
    userCode: z.string().optional(),
    code: z.string().optional(),
    name: z.string().optional(),
  }),
]);

export const SafeQuoteSaleItemSchema = z.object({
  caseId: z.union([z.string(), z.number()]).transform(String),
  closer: SafeQuoteCloserRefSchema,
  state: z.string().default(""),
  carrier: z.string().default("Standard"),
  coverage: z.union([z.string(), z.number()]).default(""),
  premium: z.coerce.number().default(0),
  validatedAt: z.string(),
});

export type SafeQuoteSaleItem = z.infer<typeof SafeQuoteSaleItemSchema>;

export const SafeQuoteRecentSalesResponseSchema = z.object({
  sales: z.array(SafeQuoteSaleItemSchema).default([]),
});

export type SafeQuoteRecentSalesResponse = z.infer<typeof SafeQuoteRecentSalesResponseSchema>;

export const NormalizedSaleEventSchema = z.object({
  eventId: z.string().optional(),
  eventType: z.enum(["sale.validated", "sale.submitted", "sale.returned", "sale.rejected", "heartbeat", "unknown"]),
  caseId: z.string(),
  userCode: z.string(),
  closerName: z.string().optional(),
  state: z.string().optional(),
  carrier: z.string().optional(),
  premium: z.number().default(0),
  coverage: z.union([z.string(), z.number()]).optional(),
  timestamp: z.string(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export type NormalizedSaleEvent = z.infer<typeof NormalizedSaleEventSchema>;
