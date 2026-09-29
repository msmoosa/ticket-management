// A user as returned by GET /api/users.
export type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "agent";
  banned: boolean | null;
  createdAt: string;
};

// Body of POST /api/users and PATCH /api/users/:id (omit `password` to keep it).
export type UserInput = { name: string; email: string; password?: string };
