"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { usernameToEmail } from "../../lib/username";

async function destinationFor(userId) {
  const { data } = await supabase
    .from("admins")
    .select("auth_user_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  return data ? "/admin" : "/cliente";
}

export default function Login() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session?.user) router.replace(await destinationFor(data.session.user.id));
    });
  }, [router]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const rawLogin = login.trim();
    const email = rawLogin.includes("@") ? rawLogin.toLowerCase() : usernameToEmail(rawLogin);

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (signInError || !data.user) {
      setError("Usuario o contraseña incorrectos.");
      setLoading(false);
      return;
    }

    router.replace(await destinationFor(data.user.id));
    router.refresh();
  }

  return (
    <main className="page center">
      <form className="card form" onSubmit={submit}>
        <img className="brandLogo loginLogo" src="/logo.jpg" alt="Juan Cuentas Streaming AXM" />
        <div className="badge">JUAN CUENTAS</div>
        <h1>Iniciar sesión</h1>
        <p className="muted">Clientes: ingresa con tu usuario. Administrador: puedes seguir usando tu correo.</p>
        <input placeholder="Usuario" type="text" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
        <input placeholder="Contraseña" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="errorBox">{error}</div>}
        <button className="button primary" disabled={loading}>{loading ? "Ingresando..." : "Entrar"}</button>
      </form>
    </main>
  );
}
