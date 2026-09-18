"use client";

import Link from "next/link";
import { useState } from "react";

type CreatedTeam = {
  team_id: string;
  invite_code: string;
  team_name: string;
};

export function CreateTeamForm() {
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedTeam | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/team/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await response.json()) as CreatedTeam & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Could not create team");
      }
      setCreated({
        team_id: data.team_id,
        invite_code: data.invite_code,
        team_name: data.team_name || name.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create team");
    } finally {
      setPending(false);
    }
  }

  async function copyInviteLink(code: string) {
    const url = `${window.location.origin}/join?code=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (created) {
    const joinHref = `/join?code=${created.invite_code}`;
    const boardHref = `/dashboard?team_id=${encodeURIComponent(created.team_id)}`;

    return (
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h1 className="text-xl font-semibold">Team created</h1>
        <p className="mt-2 text-sm text-muted">
          Share this code so others can join.
        </p>
        <p className="mt-6 font-mono text-3xl tracking-[0.2em] text-foreground">
          {created.invite_code}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => copyInviteLink(created.invite_code)}
            className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-surface-2"
          >
            {copied ? "Copied" : "Copy web invite link"}
          </button>
          <Link
            href={joinHref}
            className="rounded-xl border border-border px-4 py-2 text-center text-sm hover:bg-surface-2"
          >
            Join in the browser
          </Link>
          <Link
            href={boardHref}
            className="rounded-xl border border-border px-4 py-2 text-center text-sm hover:bg-surface-2"
          >
            View team board
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-border bg-surface p-6"
    >
      <h1 className="text-xl font-semibold">Create a team</h1>
      <p className="mt-2 text-sm text-muted">
        You&apos;ll get an 8-character invite code to share.
      </p>
      <label className="mt-6 block text-sm text-foreground/80">
        Team name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          required
          placeholder="Team name"
          className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground outline-none placeholder:text-muted/70 focus:border-accent"
        />
      </label>
      {error ? <p className="mt-3 text-sm text-andon-red">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create team"}
      </button>
      <p className="mt-4 text-center text-sm text-muted">
        Already have a code?{" "}
        <Link href="/join" className="text-foreground underline-offset-2 hover:underline">
          Join a team
        </Link>
      </p>
    </form>
  );
}
