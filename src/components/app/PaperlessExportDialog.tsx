import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Doc } from "@/lib/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PaperlessError, PaperlessSelect } from "./paperless-ui";

type Option = { id: number; name: string };
export type PaperlessExportDraft = {
  documentId: string;
  title: string;
  created?: string;
  tags: number[];
  documentType?: number;
  correspondent?: number;
};

export function PaperlessExportDialog({
  documents,
  metadata,
  destination,
  account,
  onClose,
  onSubmit,
}: {
  documents: Doc[];
  metadata: { tags: Option[]; documentTypes: Option[]; correspondents: Option[] };
  destination: string;
  account: string;
  onClose: () => void;
  onSubmit: (drafts: PaperlessExportDraft[]) => Promise<void>;
}) {
  const { t } = useTranslation("paperless");
  const [drafts, setDrafts] = useState(() =>
    documents.map((document) => ({
      documentId: document.id,
      title: document.name,
      date: "",
      documentType: "",
      correspondent: "",
    })),
  );
  const [tags, setTags] = useState<number[]>([]);
  const submit = useMutation({
    mutationFn: () =>
      onSubmit(
        drafts.map((draft) => ({
          documentId: draft.documentId,
          title: draft.title,
          ...(draft.date ? { created: draft.date } : {}),
          ...(draft.documentType ? { documentType: Number(draft.documentType) } : {}),
          ...(draft.correspondent ? { correspondent: Number(draft.correspondent) } : {}),
          tags,
        })),
      ),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("exportTitle")}</DialogTitle>
          <DialogDescription>{t("exportHint")}</DialogDescription>
        </DialogHeader>
        <p className="break-all text-sm">
          {destination} · {account}
        </p>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit.mutate();
          }}
        >
          <p className="text-xs text-muted-foreground">{t("dateHint")}</p>
          {drafts.map((draft, index) => {
            const change = (patch: Partial<typeof draft>) =>
              setDrafts((previous) =>
                previous.map((item, position) =>
                  position === index ? { ...item, ...patch } : item,
                ),
              );
            return (
              <fieldset
                key={draft.documentId}
                className="flex min-w-0 flex-col gap-3 rounded-lg border p-3"
                disabled={submit.isPending}
              >
                <legend className="max-w-full break-all px-1 text-sm font-medium">
                  {documents[index]?.name}
                </legend>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`paperless-export-title-${index}`}>{t("documentTitle")}</Label>
                  <Input
                    id={`paperless-export-title-${index}`}
                    value={draft.title}
                    required
                    maxLength={250}
                    onChange={(event) => change({ title: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`paperless-export-date-${index}`}>{t("documentDate")}</Label>
                  <Input
                    id={`paperless-export-date-${index}`}
                    type="date"
                    value={draft.date}
                    onChange={(event) => change({ date: event.target.value })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <PaperlessSelect
                    id={`paperless-export-type-${index}`}
                    label={t("documentType")}
                    options={metadata.documentTypes}
                    empty={t("none")}
                    value={draft.documentType}
                    onChange={(event) => change({ documentType: event.target.value })}
                  />
                  <PaperlessSelect
                    id={`paperless-export-correspondent-${index}`}
                    label={t("correspondent")}
                    options={metadata.correspondents}
                    empty={t("none")}
                    value={draft.correspondent}
                    onChange={(event) => change({ correspondent: event.target.value })}
                  />
                </div>
              </fieldset>
            );
          })}
          {metadata.tags.length > 0 && (
            <fieldset disabled={submit.isPending} className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t("tags")}</legend>
              <div className="flex max-h-40 flex-wrap gap-3 overflow-y-auto">
                {metadata.tags.map((tag) => (
                  <Label key={tag.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={tags.includes(tag.id)}
                      onCheckedChange={(checked) =>
                        setTags((previous) =>
                          checked ? [...previous, tag.id] : previous.filter((id) => id !== tag.id),
                        )
                      }
                    />
                    {tag.name}
                  </Label>
                ))}
              </div>
            </fieldset>
          )}
          <PaperlessError error={submit.error} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={submit.isPending || !drafts.length}>
              {t("startExport")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
