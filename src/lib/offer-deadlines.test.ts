import { describe, expect, it } from "vitest";
import { offerDeadlines, offerDecisionTitle } from "./offer-deadlines";
import { buildIcs } from "./ics";
import type { Offer } from "./schema";

const offer: Offer = {
  id: "quote-1",
  contractor: "Roofing",
  title: "Roof",
  status: "received",
  amount: 30392,
  offer_date: "2026-10-27",
  valid_until: "2026-11-10",
  requested_date: null,
  trade_id: "trade-1",
  cost_item_id: null,
  document_id: "document-1",
  contact_id: null,
  notes: "Check scope",
};

describe("offer decision deadlines", () => {
  it("creates a stable all-day deadline only for a received offer with validity", () => {
    expect(offerDeadlines([offer])).toEqual([
      {
        id: "offer-quote-1",
        offer_id: "quote-1",
        title: offerDecisionTitle(offer),
        event_date: "2026-11-10",
        end_date: null,
        start_time: null,
        end_time: null,
        kind: "frist",
        trade_id: "trade-1",
        notes: "Check scope",
      },
    ]);
  });

  it("updates the date without creating another entry", () => {
    const initial = offerDeadlines([offer])[0]!;
    const updated = offerDeadlines([{ ...offer, valid_until: "2026-11-20" }]);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ id: initial.id, event_date: "2026-11-20" });
  });

  it.each(["requested", "accepted", "rejected"] as const)(
    "removes deadlines for %s offers",
    (status) => {
      expect(offerDeadlines([{ ...offer, status }])).toEqual([]);
    },
  );

  it("supports older offers without a validity date", () => {
    expect(offerDeadlines([{ ...offer, valid_until: null }])).toEqual([]);
    const { valid_until: _validity, ...legacy } = offer;
    expect(offerDeadlines([legacy])).toEqual([]);
  });

  it("exports the deadline to iCal and removes it once a decision has been made", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    const feed = buildIcs([], [], "Bauplan", now, [offer]);
    expect(feed).toContain("UID:offer-quote-1@bauplan");
    expect(feed).toContain("DTSTART;VALUE=DATE:20261110");
    expect(feed).toContain("DTEND;VALUE=DATE:20261111");
    expect(feed).toContain("CATEGORIES:Frist");
    expect(buildIcs([], [], "Bauplan", now, [{ ...offer, status: "accepted" }])).not.toContain(
      "BEGIN:VEVENT",
    );
  });
});
