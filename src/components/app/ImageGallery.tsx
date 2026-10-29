import { tr } from "@/i18n";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { useFileUrl } from "./doc-open";

export type GalleryImage = { id: string; path: string; name: string };

function Slide({ image, alt }: { image: GalleryImage; alt: string }) {
  const src = useFileUrl(image.path);
  return (
    <div className="relative flex h-[70vh] items-center justify-center">
      {src ? (
        <>
          <img src={src} alt={alt} className="max-h-full max-w-full rounded-md object-contain" />
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            aria-label={tr("collections.open_original")}
            className="absolute right-2 top-2 rounded-full bg-background/80 p-2 text-foreground backdrop-blur hover:bg-background"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </>
      ) : (
        <div className="h-full w-full animate-pulse rounded-md bg-muted" />
      )}
    </div>
  );
}

export function ImageGallery({
  images,
  title,
  startIndex,
  open,
  onOpenChange,
}: {
  images: GalleryImage[];
  title: string;
  startIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [api, setApi] = useState<CarouselApi>();
  const [index, setIndex] = useState(startIndex);
  useEffect(() => {
    if (!api) return;
    const onSelect = () => setIndex(api.selectedScrollSnap());
    onSelect();
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(64rem,calc(100vw-1rem))] gap-3 p-3 sm:p-4">
        <DialogTitle className="pr-8 text-base">{title}</DialogTitle>
        <DialogDescription className="text-xs">
          {tr("collections.image_position", { index: index + 1, count: images.length })}
        </DialogDescription>
        <Carousel setApi={setApi} opts={{ startIndex }} className="w-full" tabIndex={0}>
          <CarouselContent>
            {images.map((image, i) => (
              <CarouselItem key={image.id}>
                <Slide image={image} alt={tr("collections.image_alt", { title, index: i + 1 })} />
              </CarouselItem>
            ))}
          </CarouselContent>
          {images.length > 1 && (
            <>
              <CarouselPrevious
                aria-label={tr("collections.previous_image")}
                className="left-2 h-10 w-10 bg-background/80 backdrop-blur"
              />
              <CarouselNext
                aria-label={tr("collections.next_image")}
                className="right-2 h-10 w-10 bg-background/80 backdrop-blur"
              />
            </>
          )}
        </Carousel>
      </DialogContent>
    </Dialog>
  );
}
