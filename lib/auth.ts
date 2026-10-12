// One-password site auth. The cookie holds a hash of the password, never the password itself.
export const AUTH_COOKIE = "jr_auth";

export async function authToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`job-radar:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
