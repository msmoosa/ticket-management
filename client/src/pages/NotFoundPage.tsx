import { Link } from "react-router";

export default function NotFoundPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-sm text-muted-foreground">The address may be mistyped, or the page has moved.</p>
      <Link to="/" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}
