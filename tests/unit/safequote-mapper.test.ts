import { describe, expect, it } from "vitest";
import {
  extractCloserIdentity,
  mapCloserToAgent,
  mapClosersToCloserRows,
  mapRecentSaleToDomainSale,
  parseSseSaleEvent,
} from "@/lib/server/safequote/mapper";

describe("Safe Quote Mapper", () => {
  describe("extractCloserIdentity", () => {
    it("extracts name and code when closer is formatted as 'Name (CODE)'", () => {
      const res = extractCloserIdentity("Ali Khan (CLS-9901)");
      expect(res.name).toBe("Ali Khan");
      expect(res.userCode).toBe("CLS-9901");
    });

    it("handles closer code as a plain code string", () => {
      const res = extractCloserIdentity("CLS-ABCD");
      expect(res.userCode).toBe("CLS-ABCD");
    });

    it("derives deterministic userCode when only closer name is provided", () => {
      const res1 = extractCloserIdentity("Umar Farooq");
      const res2 = extractCloserIdentity("Umar Farooq");
      expect(res1.name).toBe("Umar Farooq");
      expect(res1.userCode).toMatch(/^CLS-[A-F0-9]{8}$/);
      expect(res1.userCode).toBe(res2.userCode);
    });

    it("extracts from closer object", () => {
      const res = extractCloserIdentity({ userCode: "CLS-55", name: "Sara Lee" });
      expect(res.name).toBe("Sara Lee");
      expect(res.userCode).toBe("CLS-55");
    });
  });

  describe("mapCloserToAgent", () => {
    it("maps closer item to full domain Agent object", () => {
      const agent = mapCloserToAgent({
        rank: 1,
        userCode: "CLS-ALPHA",
        name: "Alpha Closer",
        submitted: 20,
        validated: 12,
        closeRate: 60,
        returned: 4,
        rejected: 4,
        premiumTotal: 5000,
        premiumAverage: 416.6,
      });

      expect(agent.id).toBe("agt_cls_alpha");
      expect(agent.name).toBe("Alpha Closer");
      expect(agent.initials).toBe("AC");
      expect(agent.active).toBe(true);
      expect(agent.title).toBe("Top Closer");
      expect(agent.hue).toBeGreaterThanOrEqual(0);
      expect(agent.hue).toBeLessThan(360);
    });
  });

  describe("mapClosersToCloserRows", () => {
    it("maps closer items into ranked CloserRow array", () => {
      const rows = mapClosersToCloserRows([
        {
          rank: 1,
          userCode: "CLS-1",
          name: "Top Closer",
          submitted: 10,
          validated: 7,
          closeRate: 70,
          returned: 2,
          rejected: 1,
          premiumTotal: 3000,
          premiumAverage: 428.5,
        },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].rank).toBe(1);
      expect(rows[0].code).toBe("CLS-1");
      expect(rows[0].counts.submitted).toBe(10);
      expect(rows[0].counts.validated).toBe(7);
      expect(rows[0].rate).toBe(70);
    });
  });

  describe("mapRecentSaleToDomainSale", () => {
    it("maps Safe Quote recent sale item to domain Sale", () => {
      const sale = mapRecentSaleToDomainSale({
        caseId: "CASE-9021",
        closer: "Ali Khan (CLS-9021)",
        state: "TX",
        carrier: "StateFarm",
        coverage: "50000",
        premium: 240.5,
        validatedAt: "2026-10-28T14:30:00Z",
      });

      expect(sale.id).toBe("sale_CASE-9021");
      expect(sale.agentId).toBe("agt_cls_9021");
      expect(sale.status).toBe("approved");
      expect(sale.value).toBe(240.5);
      expect(sale.approvedAt).toBe("2026-10-28T14:30:00Z");
    });
  });

  describe("parseSseSaleEvent", () => {
    it("parses and normalizes a sale.validated event", () => {
      const normalized = parseSseSaleEvent("sale.validated", {
        caseId: "CASE-112",
        closer: { userCode: "CLS-112", name: "Zainab Malik" },
        state: "FL",
        carrier: "Aetna",
        premium: 350,
        validatedAt: "2026-10-29T10:00:00Z",
      });

      expect(normalized).not.toBeNull();
      expect(normalized?.eventType).toBe("sale.validated");
      expect(normalized?.caseId).toBe("CASE-112");
      expect(normalized?.userCode).toBe("CLS-112");
      expect(normalized?.closerName).toBe("Zainab Malik");
      expect(normalized?.premium).toBe(350);
    });

    it("parses heartbeat event", () => {
      const normalized = parseSseSaleEvent("heartbeat", { type: "ping" });
      expect(normalized?.eventType).toBe("heartbeat");
    });
  });
});
