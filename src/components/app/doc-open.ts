import { tr } from "@/i18n";
import { useEffect, useState } from "react";
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

/** Resolves a stored file path to a displayable URL. */
export function useFileUrl(path: string | null | undefined) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (path) void resolveFileUrl(path).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [path]);
  return src;
}
