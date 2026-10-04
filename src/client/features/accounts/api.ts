import { ApiError, record, request } from "../../api/request";
export type Player = {
  id: string;
  username: string;
  createdAt: string;
  isActive: boolean;
  tokens: number;
};
export async function account(
  command: "me" | "login" | "register",
  credentials?: { username: string; password: string },
): Promise<Player> {
  const user = record(
    record(await request(`/api/auth/${command}`, credentials)).user,
  );
  if (
    typeof user.id !== "string" ||
    typeof user.username !== "string" ||
    !user.username ||
    typeof user.createdAt !== "string" ||
    !Number.isFinite(Date.parse(user.createdAt)) ||
    typeof user.isActive !== "boolean" ||
    typeof user.tokens !== "number" ||
    !Number.isSafeInteger(user.tokens) ||
    user.tokens < 0
  )
    throw new ApiError("Something went wrong. Please try again.");
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    isActive: user.isActive,
    tokens: user.tokens,
  };
}
export async function logout(): Promise<void> {
  await request("/api/auth/logout", {});
}
