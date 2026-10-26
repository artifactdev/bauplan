import { tr } from "@/i18n";
import { toast } from "sonner";
import { getFileUrl } from "@/lib/data.functions";

export async function resolveFileUrl(path: string | null) {
  if (!path) return null;
  try {
    return (await getFileUrl({ data: { path } })).url;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : tr("doc-open.file_not_available"));
    return null;
  }
}
