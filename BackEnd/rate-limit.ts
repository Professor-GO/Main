// A simple in-memory rate limiter, shared by the Express website server and the oRPC API.

/**
 * Creates a counter that allows each key (usually an IP address) a set number of
 * attempts per minute. Counts reset a minute after a key's first attempt.
 * @param maximum - The number of attempts allowed per key each minute.
 * @returns A function to call once per attempt. It returns true while the key is within
 * the limit, and false once it has gone over.
 */
export function createAttemptLimiter(maximum: number): (key: string | undefined) => boolean {
    const attempts = new Map<string | undefined, { count: number; until: number }>();
    return (key) => {
        const now = Date.now();
        for (const [oldKey, value] of attempts) if (value.until <= now) attempts.delete(oldKey);
        const entry = attempts.get(key) ?? { count: 0, until: now + 60_000 };
        attempts.set(key, entry);
        return ++entry.count <= maximum;
    };
}
