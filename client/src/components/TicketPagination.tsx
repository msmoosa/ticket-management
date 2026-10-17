import { useId } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ticketPageSizes } from "@/lib/tickets";

type Props = {
  /** 1-based. */
  page: number;
  pageSize: number;
  /** Tickets matching the filters, across all pages. */
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

const pageSizeItems = ticketPageSizes.map((value) => ({ value, label: String(value) }));

const countFormat = new Intl.NumberFormat();

export function pageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

export default function TicketPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: Props) {
  const pageSizeLabel = useId();
  const pages = pageCount(total, pageSize);
  const first = Math.min((page - 1) * pageSize + 1, total);
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm"
    >
      <p className="text-muted-foreground" aria-live="polite">
        {total === 0
          ? "No tickets"
          : `Showing ${countFormat.format(first)}–${countFormat.format(last)} of ${countFormat.format(total)}`}
      </p>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground" id={pageSizeLabel}>
            Rows per page
          </span>
          <Select
            items={pageSizeItems}
            value={pageSize}
            onValueChange={(value) => {
              if (value !== null) onPageSizeChange(value);
            }}
          >
            <SelectTrigger aria-labelledby={pageSizeLabel} size="sm" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <span>
          Page {countFormat.format(page)} of {countFormat.format(pages)}
        </span>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="First page"
            disabled={page <= 1}
            onClick={() => onPageChange(1)}
          >
            <ChevronsLeft aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(Math.min(page - 1, pages))}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Last page"
            disabled={page >= pages}
            onClick={() => onPageChange(pages)}
          >
            <ChevronsRight aria-hidden />
          </Button>
        </div>
      </div>
    </nav>
  );
}
