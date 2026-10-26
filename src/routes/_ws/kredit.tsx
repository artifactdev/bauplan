import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { CreditCalculator } from "@/components/app/CreditCalculator";

export const Route = createFileRoute("/_ws/kredit")({
  head: () => ({
    meta: [
      { title: tr("Kredit – Bauplan") },
      {
        name: "description",
        content: tr("Kreditkonditionen, Zinskosten und Rückzahlungen im Blick."),
      },
    ],
  }),
  component: CreditPage,
});

function CreditPage() {
  return <CreditCalculator />;
}
