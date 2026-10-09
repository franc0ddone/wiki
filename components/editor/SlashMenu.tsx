"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { SearchX } from "lucide-react";
import type { SlashItem } from "@/components/editor/slashItems";
import { cx } from "@/lib/utils";

/**
 * The slash-command listbox. Rendered by the suggestion plugin through a
 * {@link ReactRenderer}; the plugin drives keyboard input through the
 * `onKeyDown` handle this component exposes via ref.
 *
 * It is a real listbox: `role="listbox"` with `aria-activedescendant`, so a
 * screen reader announces the highlighted command as the author arrows through
 * the list. ↑/↓ (and Home/End) move with wrap-around, Enter and Tab insert,
 * Escape is left to the suggestion plugin (which dismisses the menu).
 */

export interface SlashMenuHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export interface SlashMenuProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(function SlashMenu({ items, command }, ref) {
  const [selected, setSelected] = useState(0);

  // Every new result set starts back at the top of the list.
  useEffect(() => {
    setSelected(0);
  }, [items]);

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          setSelected((current) => (items.length === 0 ? 0 : (current - 1 + items.length) % items.length));
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelected((current) => (items.length === 0 ? 0 : (current + 1) % items.length));
          return true;
        }
        if (event.key === "Home") {
          setSelected(0);
          return true;
        }
        if (event.key === "End") {
          setSelected(Math.max(0, items.length - 1));
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const item = items[selected];
          if (item) {
            command(item);
            return true;
          }
          return false;
        }
        return false;
      },
    }),
    [items, selected, command],
  );

  const activeId = items.length > 0 ? `slash-item-${items[selected]?.id ?? 0}` : undefined;

  return (
    <div
      role="listbox"
      aria-label="Insert block"
      aria-activedescendant={activeId}
      data-testid="slash-menu"
      className="z-40 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-[0_12px_40px_-12px_rgba(24,24,27,0.28),0_2px_6px_rgba(24,24,27,0.08)]"
    >
      {items.length === 0 ? (
        <p className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-zinc-500" role="status">
          <SearchX size={14} strokeWidth={1.75} aria-hidden="true" />
          No matching commands
        </p>
      ) : (
        <ul className="max-h-72 overflow-y-auto">
          {items.map((item, index) => {
            const Icon = item.icon;
            const isSelected = index === selected;
            return (
              <li key={item.id}>
                <button
                  id={`slash-item-${item.id}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  // The listbox keeps focus in the editor; the pointer only highlights.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => command(item)}
                  className={cx(
                    "flex w-full items-center gap-3 px-3 py-2 text-left",
                    isSelected ? "bg-teal-50" : "bg-transparent hover:bg-zinc-50",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
                      isSelected ? "border-teal-600/30 bg-white text-[#0F766E]" : "border-zinc-200 bg-zinc-50 text-zinc-600",
                    )}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-zinc-900">{item.label}</span>
                    <span className="block truncate text-xs text-zinc-500">{item.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});

export default SlashMenu;
