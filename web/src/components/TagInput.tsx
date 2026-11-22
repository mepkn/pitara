import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { XIcon } from "lucide-react";
import { LIMITS } from "@shared/limits";
import { isValidTagName, normalizeTagName } from "@shared/tags";
import { Badge } from "@/components/ui/badge";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";

type Props = {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Existing tag names, offered as suggestions. */
  suggestions: string[];
  id?: string;
  autoFocus?: boolean;
  disabled?: boolean;
};

/** Chips + an input. Enter or comma adds, Backspace on an empty input removes the last chip. */
export function TagInput({ value, onChange, suggestions, id, autoFocus, disabled }: Props) {
  const [text, setText] = useState("");
  const listId = useId();
  const typed = normalizeTagName(text);
  const matches = useMemo(
    () => (typed === "" ? [] : suggestions.filter((s) => s.includes(typed) && !value.includes(s)).slice(0, 6)),
    [typed, suggestions, value],
  );

  function add(raw: string) {
    const name = normalizeTagName(raw);
    if (!isValidTagName(name) || value.includes(name) || value.length >= LIMITS.tagsPerBookmark) {
      setText("");
      return;
    }
    onChange([...value, name]);
    setText("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      if (text.trim() === "") return; // let Enter submit the form
      e.preventDefault();
      e.stopPropagation();
      add(text);
    } else if (e.key === "Backspace" && text === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="relative">
      <div
        className={cn(
          "flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-2 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          disabled && "opacity-50",
        )}
      >
        {value.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1 pr-1">
            {tag}
            <button
              type="button"
              disabled={disabled}
              aria-label={strings.tagInput.remove(tag)}
              className="rounded-sm hover:text-destructive"
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          id={id}
          value={text}
          autoFocus={autoFocus}
          disabled={disabled}
          maxLength={LIMITS.tagNameMax + 1}
          placeholder={value.length === 0 ? strings.tagInput.placeholder : ""}
          className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => text.trim() !== "" && add(text)}
          aria-controls={listId}
          autoComplete="off"
        />
      </div>
      {matches.length > 0 && (
        <ul id={listId} className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg border bg-popover p-1 text-sm shadow-md">
          {matches.map((m) => (
            <li key={m}>
              <button
                type="button"
                className="w-full rounded-md px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground"
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus; the blur handler would add the half-typed text
                  add(m);
                }}
              >
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
