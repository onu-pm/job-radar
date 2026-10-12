import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, authToken } from "@/lib/auth";

async function login(formData: FormData) {
  "use server";
  const password = process.env.SITE_PASSWORD;
  if (!password || formData.get("password") !== password) redirect("/login?e=1");
  (await cookies()).set(AUTH_COOKIE, await authToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <main className="login">
      <form action={login} className="login-card">
        <h1>Job Radar</h1>
        <input type="password" name="password" placeholder="Password" autoFocus required />
        <button type="submit">Enter</button>
        {e && <p className="err">Wrong password.</p>}
      </form>
    </main>
  );
}
