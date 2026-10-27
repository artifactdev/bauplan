import { tr } from "@/i18n";
import type { CalEvent, Offer } from "./schema";

export function offerDecisionTitle(offer: Offer): string {
  return tr("quotes.decision_title", {
    name: [offer.contractor, offer.title].filter(Boolean).join(" – "),
  });
}

/** Derived from the offer so date/status edits never leave stale calendar entries. */
export function offerDeadlines(offers: Offer[]): CalEvent[] {
  return offers.flatMap((offer) =>
    offer.status === "received" && offer.valid_until
      ? [
          {
            id: `offer-${offer.id}`,
            title: offerDecisionTitle(offer),
            event_date: offer.valid_until,
            end_date: null,
            start_time: null,
            end_time: null,
            kind: "frist" as const,
            trade_id: offer.trade_id,
            notes: offer.notes,
          },
        ]
      : [],
  );
}
