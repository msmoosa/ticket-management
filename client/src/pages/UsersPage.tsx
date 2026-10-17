import { useQuery } from "@tanstack/react-query";
import CreateUserDialog from "@/components/CreateUserDialog";
import DeleteUserDialog from "@/components/DeleteUserDialog";
import EditUserDialog from "@/components/EditUserDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, apiErrorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import type { User } from "@/lib/users";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export default function UsersPage() {
  const { data: session } = authClient.useSession();
  const {
    data: users,
    error,
    isPending,
  } = useQuery({
    queryKey: ["users"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<{ users: User[] }>("/users", { signal });
      return data.users;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            Everyone who can sign in to the help desk.
          </p>
        </div>
        <CreateUserDialog />
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {apiErrorMessage(error, "Failed to load users")}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody aria-busy={isPending}>
              {isPending ? (
                Array.from({ length: 3 }, (_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }, (_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground"
                  >
                    No users yet.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          user.role === "admin" ? "default" : "secondary"
                        }
                      >
                        {user.role === "admin" ? "Admin" : "Agent"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.banned ? (
                        <Badge variant="destructive">Banned</Badge>
                      ) : (
                        <Badge variant="outline">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {dateFormat.format(new Date(user.createdAt))}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <EditUserDialog user={user} />
                        <DeleteUserDialog
                          user={user}
                          isCurrentUser={user.id === session?.user.id}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
