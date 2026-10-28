import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { activeNavIndex, nextBarVisibility } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type Item = { to: string; label: string; icon: ComponentType<{ className?: string }> };

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function MobileNav({ items, label }: { items: Item[]; label: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const listRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const [visible, setVisible] = useState(true);
  const [edges, setEdges] = useState({ start: false, end: false });
  const active = activeNavIndex(items, pathname);

  useEffect(() => {
    const el = listRef.current;
    const tab = active >= 0 ? (el?.children[active] as HTMLElement | undefined) : undefined;
    tab?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: firstRender.current || prefersReducedMotion() ? "auto" : "smooth",
    });
    firstRender.current = false;
    setVisible(true);
  }, [active, pathname]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () =>
      setEdges({
        start: el.scrollLeft > 4,
        end: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [items.length]);

  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setVisible((v) => nextBarVisibility(v, lastY, y));
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const mask =
    edges.start && edges.end
      ? "linear-gradient(to right, transparent, #000 1.5rem, #000 calc(100% - 1.5rem), transparent)"
      : edges.start
        ? "linear-gradient(to right, transparent, #000 1.5rem)"
        : edges.end
          ? "linear-gradient(to left, transparent, #000 1.5rem)"
          : undefined;

  return (
    <nav
      aria-label={label}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t bg-card/60 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1 shadow-card backdrop-blur-xl md:hidden",
        "transition-transform duration-200 motion-reduce:transition-none",
        !visible && "translate-y-full",
      )}
      onFocusCapture={() => setVisible(true)}
    >
      <div
        ref={listRef}
        className="flex snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      >
        {items.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.to === "/" }}
            className="flex min-h-16 min-w-[18%] shrink-0 snap-center flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs text-muted-foreground transition-colors"
            activeProps={{ className: "bg-primary/10 text-primary font-semibold" }}
            onFocus={(e) => e.currentTarget.scrollIntoView({ inline: "center", block: "nearest" })}
          >
            <n.icon className="h-5 w-5" aria-hidden="true" />
            <span className="whitespace-nowrap">{n.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
