"use client";

import Link from "next/link";
import { useState } from "react";

type CreatedTeam = {
  team_id: string;
  invite_code: string;
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
      setCreated({ team_id: data.team_id, invite_code: data.invite_code });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create team");
    } finally {
      setPending(false);
    }
  }

  async function copyInviteLink(code: string) {
    const url = `${window.location.origin}/join?code=${code}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  if (created) {
    const joinHref = `/join?code=${created.invite_code}`;

    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h1 className="text-xl font-semibold">Team created</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Share this code so others can join.
        </p>
        <p className="mt-6 font-mono text-3xl tracking-[0.2em] text-zinc-50">
          {created.invite_code}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => copyInviteLink(created.invite_code)}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800"
          >
            {copied ? "Copied" : "Copy invite link"}
          </button>
          <Link
            href={joinHref}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-center text-sm font-medium text-zinc-950 hover:bg-white"
          >
            Join this team
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6"
    >
      <h1 className="text-xl font-semibold">Create a team</h1>
      <p className="mt-2 text-sm text-zinc-400">
        You&apos;ll get an 8-character invite code to share.
      </p>
      <label className="mt-6 block text-sm text-zinc-300">
        Team name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          required
          placeholder="Team name"
          className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
        />
      </label>
      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-white disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create team"}
      </button>
      <p className="mt-4 text-center text-sm text-zinc-500">
        Already have a code?{" "}
        <Link href="/join" className="text-zinc-200 underline-offset-2 hover:underline">
          Join a team
        </Link>
      </p>
    </form>
  );
}
