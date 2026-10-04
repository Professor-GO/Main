/** Same-origin transport; retries remain explicit user commands. */
export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError("Something went wrong. Please try again.");
  return value as Record<string, unknown>;
}
export async function request(path: string, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new ApiError(
      "We couldn’t reach the arena. Check your connection and try again.",
    );
  }
  const result: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      result && typeof result === "object" && "message" in result
        ? result.message
        : undefined;
    throw new ApiError(
      typeof message === "string"
        ? message
        : "Something went wrong. Please try again.",
      response.status,
    );
  }
  return result;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
