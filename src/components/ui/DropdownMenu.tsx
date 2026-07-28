"use client";
import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";


interface DropdownMenuContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenu() {
  const ctx = useContext(DropdownMenuContext);
  if (!ctx) throw new Error("DropdownMenu compound components must be used inside <DropdownMenu>");
  return ctx;
}


interface DropdownMenuProps {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DropdownMenu({ children, open: controlledOpen, onOpenChange }: DropdownMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = useCallback(
    (v: boolean) => {
      if (!isControlled) setUncontrolledOpen(v);
      onOpenChange?.(v);
    },
    [isControlled, onOpenChange],
  );

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inContent = contentRef.current?.contains(target);
      const inTrigger = triggerRef.current?.contains(target);
      if (!inContent && !inTrigger) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, setOpen]);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen, triggerRef, contentRef }}>
      {children}
    </DropdownMenuContext.Provider>
  );
}


interface DropdownMenuTriggerProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  asChild?: boolean;
}

export function DropdownMenuTrigger({ children, className, style, asChild }: DropdownMenuTriggerProps) {
  const { open, setOpen, triggerRef } = useDropdownMenu();

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  };

  if (asChild) {
    return <>{children}</>;
  }

  return (
    <button
      ref={triggerRef}
      type="button"
      className={className}
      style={style}
      onClick={() => setOpen(!open)}
      onKeyDown={handleKeyDown}
      aria-haspopup="menu"
      aria-expanded={open}
    >
      {children}
    </button>
  );
}


type Align = "start" | "center" | "end";
type Side = "top" | "bottom";

interface DropdownMenuContentProps {
  children: ReactNode;
  className?: string;
  align?: Align;
  side?: Side;
  sideOffset?: number;
  fixed?: boolean;
  style?: React.CSSProperties;
}

export function DropdownMenuContent({
  children,
  className,
  align = "end",
  side = "bottom",
  sideOffset = 4,
  fixed,
  style,
}: DropdownMenuContentProps) {
  const { open, setOpen, triggerRef, contentRef } = useDropdownMenu();
  const focusableRef = useRef<HTMLElement[]>([]);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) { setPos(null); return; }
    if (fixed) return; // fixed mode uses style prop directly

    const compute = () => {
      const trigger = triggerRef.current;
      const content = contentRef.current;
      if (!trigger) return;

      const tr = trigger.getBoundingClientRect();
      const cw = content?.offsetWidth ?? 0;
      const ch = content?.offsetHeight ?? 0;

      let top: number;
      if (side === "bottom") {
        top = tr.bottom + sideOffset;
        if (top + ch > window.innerHeight && tr.top - sideOffset - ch > 0) {
          top = tr.top - sideOffset - ch;
        }
      } else {
        top = tr.top - sideOffset - ch;
        if (top < 0 && tr.bottom + sideOffset + ch <= window.innerHeight) {
          top = tr.bottom + sideOffset;
        }
      }

      let left: number;
      if (align === "end") {
        left = tr.right - cw;
      } else if (align === "start") {
        left = tr.left;
      } else {
        left = tr.left + tr.width / 2 - cw / 2;
      }

      if (left + cw > window.innerWidth) left = window.innerWidth - cw - 8;
      if (left < 8) left = 8;
      if (top + ch > window.innerHeight) top = window.innerHeight - ch - 8;
      if (top < 8) top = 8;

      setPos({ top, left });
    };

    compute();
    requestAnimationFrame(compute);
  }, [open, fixed, side, align, sideOffset, triggerRef, contentRef]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const el = contentRef.current;
      if (!el) return;
      focusableRef.current = Array.from(
        el.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
      );
      focusableRef.current[0]?.focus();
    });
  }, [open, contentRef]);

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    const items = focusableRef.current;
    if (!items.length) return;
    const active = document.activeElement as HTMLElement;
    const idx = items.indexOf(active);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = idx < items.length - 1 ? idx + 1 : 0;
      items[next]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = idx > 0 ? idx - 1 : items.length - 1;
      items[prev]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  if (!open) return null;

  const computedStyle: React.CSSProperties = fixed
    ? { position: "fixed", ...style }
    : { position: "fixed", ...pos, ...style };

  const content = (
    <div
      ref={(el) => { (contentRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }}
      role="menu"
      aria-orientation="vertical"
      onKeyDown={handleKeyDown}
      className={cn(
        "z-[200] min-w-[180px] bg-bg3 border border-scroll-thumb rounded-lg shadow-xl shadow-black/50 p-1 text-[12px]",
        className,
      )}
      style={computedStyle}
    >
      {children}
    </div>
  );

  return createPortal(content, document.body);
}


interface DropdownMenuItemProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onSelect?: () => void;
  shortcut?: string;
}

export function DropdownMenuItem({ children, className, disabled, onSelect, shortcut }: DropdownMenuItemProps) {
  const { setOpen } = useDropdownMenu();

  const handleClick = () => {
    if (disabled) return;
    onSelect?.();
    setOpen(false);
  };

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <button
      role="menuitem"
      type="button"
      tabIndex={disabled ? -1 : 0}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-disabled={disabled || undefined}
      className={cn(
        "flex items-center justify-between w-full px-2.5 py-1.5 rounded-md outline-none",
        disabled
          ? "text-t5 cursor-default"
          : "text-t3 hover:bg-selection hover:text-t1 focus-visible:bg-selection focus-visible:text-t1 cursor-pointer",
        className,
      )}
    >
      <span className="flex items-center gap-2 min-w-0">{children}</span>
      {shortcut && (
        <span className="text-[11px] text-t5 font-mono ml-6 shrink-0">{shortcut}</span>
      )}
    </button>
  );
}


export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn("h-px bg-scroll-thumb mx-2 my-1", className)} />;
}


interface DropdownMenuLabelProps {
  children: ReactNode;
  className?: string;
}

export function DropdownMenuLabel({ children, className }: DropdownMenuLabelProps) {
  return (
    <div role="none" className={cn("px-2.5 py-1.5 text-[11px] text-t4 font-medium select-none", className)}>
      {children}
    </div>
  );
}


export function DropdownMenuGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div role="group" className={className}>{children}</div>;
}


interface DropdownMenuSubContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
}

const DropdownMenuSubContext = createContext<DropdownMenuSubContextValue | null>(null);

export function DropdownMenuSub({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenuSubContext.Provider value={{ open, setOpen }}>
      <div className="relative" onMouseLeave={() => setOpen(false)}>
        {children}
      </div>
    </DropdownMenuSubContext.Provider>
  );
}

export function DropdownMenuSubTrigger({ children, className }: { children: ReactNode; className?: string }) {
  const ctx = useContext(DropdownMenuSubContext);
  if (!ctx) return null;

  return (
    <button
      role="menuitem"
      type="button"
      tabIndex={0}
      aria-haspopup="menu"
      aria-expanded={ctx.open}
      onMouseEnter={() => ctx.setOpen(true)}
      onFocus={() => ctx.setOpen(true)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "Enter") {
          e.preventDefault();
          ctx.setOpen(true);
        }
      }}
      className={cn(
        "flex items-center justify-between w-full px-2.5 py-1.5 rounded-md outline-none text-t3 hover:bg-selection hover:text-t1 focus-visible:bg-selection focus-visible:text-t1 cursor-pointer",
        className,
      )}
    >
      <span className="flex items-center gap-2 min-w-0">{children}</span>
      <svg width="10" height="10" viewBox="0 0 10 10" className="text-t5 shrink-0"><path d="M3.5 2L7 5L3.5 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

export function DropdownMenuSubContent({ children, className }: { children: ReactNode; className?: string }) {
  const ctx = useContext(DropdownMenuSubContext);
  if (!ctx?.open) return null;

  return (
    <div
      role="menu"
      aria-orientation="vertical"
      className={cn(
        "absolute left-full top-0 ml-1 z-[201] min-w-[180px] bg-bg3 border border-scroll-thumb rounded-lg shadow-xl shadow-black/50 p-1 text-[12px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
