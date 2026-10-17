import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api";

export type TicketFieldItem<T> = { value: T; label: string };

type Props<T extends string | null> = {
  /** Accessible name of the select. */
  label: string;
  items: TicketFieldItem<T>[];
  value: T;
  /** Called only when a different value is chosen. */
  onChange: (value: T) => void;
  disabled?: boolean;
  error?: unknown;
  errorFallback: string;
};

// A select for one editable ticket field (status, category, assignee), with its error below.
export default function TicketFieldSelect<T extends string | null>({
  label,
  items,
  value,
  onChange,
  disabled,
  error,
  errorFallback,
}: Props<T>) {
  return (
    <div className="space-y-2">
      <Select
        items={items}
        value={value}
        onValueChange={(next) => {
          if (next !== value) onChange(next as T);
        }}
        disabled={disabled}
      >
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value ?? "none"} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{apiErrorMessage(error, errorFallback)}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
