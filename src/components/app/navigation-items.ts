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
  { to: "/", label: () => tr("shared.overview"), icon: LayoutDashboard },
  { to: "/budget", label: () => tr("shared.budget"), icon: Wallet },
  { to: "/angebote", label: () => tr("navigation.quotes"), icon: Receipt },
  { to: "/ausgaben", label: () => tr("shared.expenses"), icon: ShoppingCart },
  { to: "/dokumente", label: () => tr("shared.documents"), icon: FileText },
  { to: "/aufgaben", label: () => tr("shared.tasks"), icon: ListChecks },
  { to: "/kalender", label: () => tr("shared.calendar"), icon: CalendarDays },
  { to: "/sammlungen", label: () => tr("shared.collections"), icon: Bookmark },
  { to: "/kontakte", label: () => tr("shared.contacts"), icon: Contact },
  { to: "/kredit", label: () => tr("shared.loan"), icon: CreditCard },
] as const;

export function navigationItem(path: (typeof NAV_PATHS)[number]) {
  return NAV_ITEMS.find((item) => item.to === path)!;
}
