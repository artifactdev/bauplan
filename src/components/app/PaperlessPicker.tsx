import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PaperlessError, PaperlessSelect } from "./paperless-ui";
import { DocumentPreview } from "./DocumentPreview";

type Option = { id: number; name: string };
export type PaperlessSearchFilters = {
  query: string;
  page: number;
  tag?: number;
  documentType?: number;
  correspondent?: number;
  dateFrom?: string;
  dateUntil?: string;
};
export type PaperlessSearchResults = {
  count: number;
  results: { id: number; title: string; created?: string | null }[];
  hasNext: boolean;
};

export function PaperlessPicker({
  userId,
  instanceKey,
  metadata,
  reconcile = false,
  onClose,
  search,
  preview,
  choose,
}: {
  userId: string;
  instanceKey: string;
  metadata: { tags: Option[]; documentTypes: Option[]; correspondents: Option[] };
  reconcile?: boolean;
  onClose: () => void;
  search: (filters: PaperlessSearchFilters) => Promise<PaperlessSearchResults>;
  preview: (id: number) => Promise<Blob>;
  choose: (id: number) => Promise<void>;
}) {
  const { t } = useTranslation("paperless");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [correspondent, setCorrespondent] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateUntil, setDateUntil] = useState("");
  const [filters, setFilters] = useState<PaperlessSearchFilters>({ query: "", page: 1 });
  const [acknowledged, setAcknowledged] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ url: string; mime: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const results = useQuery({
    queryKey: ["paperless", userId, instanceKey, "search", filters],
    queryFn: () => search(filters),
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
  const select = useMutation({ mutationFn: choose });
  const view = useMutation({
    mutationFn: preview,
    onSuccess: (blob) => {
      if (mounted.current) setPreviewFile({ url: URL.createObjectURL(blob), mime: blob.type });
    },
  });
  useEffect(
    () => () => {
      if (previewFile) URL.revokeObjectURL(previewFile.url);
    },
    [previewFile],
  );
  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t(reconcile ? "reconcileTitle" : "importTitle")}</DialogTitle>
            <DialogDescription>{t(reconcile ? "reconcileHint" : "sharing")}</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setFilters({
                query,
                page: 1,
                ...(tag ? { tag: Number(tag) } : {}),
                ...(documentType ? { documentType: Number(documentType) } : {}),
                ...(correspondent ? { correspondent: Number(correspondent) } : {}),
                ...(dateFrom ? { dateFrom } : {}),
                ...(dateUntil ? { dateUntil } : {}),
              });
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="paperless-search">{t("query")}</Label>
              <Input
                id="paperless-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <PaperlessSelect
                id="paperless-search-tag"
                label={t("tags")}
                options={metadata.tags}
                empty={t("any")}
                value={tag}
                onChange={(event) => setTag(event.target.value)}
              />
              <PaperlessSelect
                id="paperless-search-type"
                label={t("documentType")}
                options={metadata.documentTypes}
                empty={t("any")}
                value={documentType}
                onChange={(event) => setDocumentType(event.target.value)}
              />
              <PaperlessSelect
                id="paperless-search-correspondent"
                label={t("correspondent")}
                options={metadata.correspondents}
                empty={t("any")}
                value={correspondent}
                onChange={(event) => setCorrespondent(event.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="paperless-search-from">{t("from")}</Label>
                <Input
                  id="paperless-search-from"
                  type="date"
                  value={dateFrom}
                  max={dateUntil || undefined}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="paperless-search-until">{t("until")}</Label>
                <Input
                  id="paperless-search-until"
                  type="date"
                  value={dateUntil}
                  min={dateFrom || undefined}
                  onChange={(event) => setDateUntil(event.target.value)}
                />
              </div>
            </div>
            <Button type="submit" variant="outline" disabled={results.isFetching}>
              <Search data-icon="inline-start" />
              {t("search")}
            </Button>
          </form>
          {!reconcile && (
            <Label className="flex items-start gap-2">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(checked) => setAcknowledged(checked === true)}
              />
              <span>{t("sharing")}</span>
            </Label>
          )}
          <PaperlessError error={results.error ?? select.error ?? view.error} />
          {results.isPending && <p role="status">{t("loading")}</p>}
          {results.isError && (
            <Button variant="outline" onClick={() => results.refetch()}>
              {t("retry")}
            </Button>
          )}
          <ul className="flex flex-col gap-3">
            {results.data?.results.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <span className="min-w-0 flex-1 break-words text-sm font-medium">
                  {document.title}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={view.isPending}
                    onClick={() => view.mutate(document.id)}
                  >
                    {t("preview")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={select.isPending || (!reconcile && !acknowledged)}
                    onClick={() => select.mutate(document.id)}
                  >
                    {t(reconcile ? "linkExisting" : "choose")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {results.data?.count === 0 && <p>{t("empty")}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {t("page", { page: filters.page, count: results.data?.count ?? 0 })}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={filters.page === 1 || results.isFetching}
                onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
              >
                {t("previous")}
              </Button>
              <Button
                variant="outline"
                disabled={!results.data?.hasNext || results.isFetching}
                onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
              >
                {t("next")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {previewFile && (
        <DocumentPreview
          name={t("previewTitle")}
          mime={previewFile.mime}
          url={previewFile.url}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </>
  );
}
