import {
  Bookmark,
  Contact,
  CalendarDays,
  FileText,
  ShoppingCart,
  LayoutDashboard,
  ListChecks,
  Receipt,
  Wallet,
  CreditCard,
} from "lucide-react";
import { tr } from "@/i18n";
import type { NAV_PATHS } from "@/lib/navigation";

export const NAV_ITEMS = [
  { to: "/", label: () => tr("Übersicht"), icon: LayoutDashboard },
  { to: "/budget", label: () => tr("Budget"), icon: Wallet },
  { to: "/angebote", label: () => tr("Angebote"), icon: Receipt },
  { to: "/ausgaben", label: () => tr("Ausgaben"), icon: ShoppingCart },
  { to: "/dokumente", label: () => tr("Dokumente"), icon: FileText },
  { to: "/aufgaben", label: () => tr("Aufgaben"), icon: ListChecks },
  { to: "/kalender", label: () => tr("Kalender"), icon: CalendarDays },
  { to: "/sammlungen", label: () => tr("Sammlungen"), icon: Bookmark },
  { to: "/kontakte", label: () => tr("Kontakte"), icon: Contact },
  { to: "/kredit", label: () => tr("Kredit"), icon: CreditCard },
] as const;

export function navigationItem(path: (typeof NAV_PATHS)[number]) {
  return NAV_ITEMS.find((item) => item.to === path)!;
}
