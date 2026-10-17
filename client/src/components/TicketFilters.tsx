import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ticketCategories,
  ticketCategoryLabel,
  ticketStatuses,
  ticketStatusLabel,
  type TicketCategoryFilter,
  type TicketStatus,
} from "@/lib/tickets";

export type TicketFilterValues = {
  status?: TicketStatus;
  category?: TicketCategoryFilter;
  search?: string;
};

type Props = {
  filters: TicketFilterValues;
  onChange: (filters: TicketFilterValues) => void;
};

// Wait for a pause in typing before searching, so each keystroke isn't a request.
const SEARCH_DEBOUNCE_MS = 300;

const statusItems = [
  { value: null, label: "All statuses" },
  ...ticketStatuses.map((value) => ({ value, label: ticketStatusLabel[value] })),
];

const categoryItems = [
  { value: null, label: "All categories" },
  ...ticketCategories.map((value) => ({ value, label: ticketCategoryLabel[value] })),
  { value: "uncategorized", label: "Uncategorized" },
] as { value: TicketCategoryFilter | null; label: string }[];

export default function TicketFilters({ filters, onChange }: Props) {
  const [search, setSearch] = useState(filters.search ?? "");

  // Follow outside changes to the search (e.g. "Clear filters", back/forward navigation).
  // Leaves the input alone when it already matches, so a trailing space mid-typing survives.
  useEffect(() => {
    const next = filters.search ?? "";
    setSearch((current) => (current.trim() === next ? current : next));
  }, [filters.search]);

  useEffect(() => {
    const value = search.trim() || undefined;
    if (value === filters.search) return;
    const timeout = setTimeout(() => onChange({ ...filters, search: value }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [search, filters, onChange]);

  const active = Boolean(filters.status || filters.category || filters.search);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-72">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Search tickets"
          placeholder="Search subject or sender…"
          className="pl-8"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <Select
        items={statusItems}
        value={filters.status ?? null}
        onValueChange={(status) => onChange({ ...filters, status: status ?? undefined })}
      >
        <SelectTrigger aria-label="Status" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statusItems.map((item) => (
            <SelectItem key={item.label} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        items={categoryItems}
        value={filters.category ?? null}
        onValueChange={(category) => onChange({ ...filters, category: category ?? undefined })}
      >
        <SelectTrigger aria-label="Category" className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {categoryItems.map((item) => (
            <SelectItem key={item.label} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {active && (
        <Button variant="ghost" onClick={() => onChange({})}>
          <X data-icon="inline-start" aria-hidden />
          Clear filters
        </Button>
      )}
    </div>
  );
}
