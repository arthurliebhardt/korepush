"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signUp } from "@/lib/auth-client";

export function AuthForm({ mode }: { mode: "setup" | "login" }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isSetup = mode === "setup";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Setup creates the one admin account — confirm the password to catch typos.
    if (isSetup && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);

    const { error } = isSetup
      ? await signUp.email({ name, email, password })
      : await signIn.email({ email, password });

    setLoading(false);
    if (error) {
      setError(error.message ?? "Something went wrong");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">
          {isSetup ? "Create your admin account" : "Sign in to korepush"}
        </h1>
        <p className="text-sm text-muted">
          {isSetup
            ? "This is the first user and becomes the platform admin."
            : "Welcome back."}
        </p>
      </div>

      {isSetup && (
        <div>
          <label className="label" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />
        </div>
      )}

      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete={isSetup ? "new-password" : "current-password"}
        />
      </div>

      {isSetup && (
        <div>
          <label className="label" htmlFor="confirmPassword">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            className="input"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <button type="submit" className="btn-primary w-full" disabled={loading}>
        {loading
          ? "Please wait…"
          : isSetup
            ? "Create admin & continue"
            : "Sign in"}
      </button>
    </form>
  );
}
