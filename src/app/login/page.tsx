import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  isPasswordCorrect,
} from "@/lib/auth";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";

  const password = String(formData.get("password") ?? "");

  if (!isPasswordCorrect(password)) {
    redirect("/login?hata=1");
  }

  cookies().set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  redirect("/");
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: { hata?: string };
}) {
  return (
    <main className={styles.page}>
      <div className={styles.box}>
        <h1 className={styles.title}>Antrenör</h1>
        <p className={styles.subtitle}>Devam etmek için şifreni gir.</p>

        <form action={login} className={styles.form}>
          <input
            type="password"
            name="password"
            placeholder="Şifre"
            autoFocus
            required
            className={styles.input}
          />
          <button type="submit" className={styles.button}>
            Giriş yap
          </button>
        </form>

        {searchParams.hata && <p className={styles.error}>Şifre hatalı.</p>}
      </div>
    </main>
  );
}
