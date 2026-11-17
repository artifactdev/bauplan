import { DiaryPage } from "@/components/app/DiaryPage";
import { tr } from "@/i18n";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_ws/tagebuch")({
  head: () => ({
    meta: [
      { title: tr("diary.title") },
      { name: "description", content: tr("diary.description") },
      { property: "og:title", content: tr("diary.title") },
      { property: "og:description", content: tr("diary.description") },
    ],
  }),
  component: DiaryPage,
});
