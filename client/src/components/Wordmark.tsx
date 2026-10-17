import { Inbox } from "lucide-react";
import { Link } from "react-router";

// The product name with its mark, linking home. Used in the sidebar and on the sign-in page.
export default function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2 rounded-md font-semibold tracking-tight">
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground"
      >
        <Inbox className="size-4" />
      </span>
      Ticket Management
    </Link>
  );
}
