import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { CreditCalculator } from "@/components/app/CreditCalculator";

export const Route = createFileRoute("/_ws/kredit")({
  head: () => ({
    meta: [
      { title: tr("credit.loan_bauplan") },
      {
        name: "description",
        content: tr("shared.keep_track_loan_terms"),
      },
    ],
  }),
  component: CreditPage,
});

function CreditPage() {
  return <CreditCalculator />;
}
