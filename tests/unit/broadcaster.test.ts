import { describe, expect, it } from "vitest";
import { arenaBroadcaster } from "@/lib/server/events/broadcaster";

describe("ArenaBroadcaster", () => {
  it("delivers broadcast events to subscribers", () => {
    const received: unknown[] = [];
    const unsubscribe = arenaBroadcaster.subscribe((event) => {
      received.push(event);
    });

    arenaBroadcaster.broadcast("sale.validated", { caseId: "TEST-01", closer: "Ali" });

    expect(received).toHaveLength(1);
    expect((received[0] as { type: string }).type).toBe("sale.validated");
    expect((received[0] as { payload: { caseId: string } }).payload.caseId).toBe("TEST-01");

    unsubscribe();
    arenaBroadcaster.broadcast("sale.validated", { caseId: "TEST-02" });
    expect(received).toHaveLength(1);
  });
});
