"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  notifyLocalAndon,
  writeAndonConfiguredFlash,
} from "@/lib/andon-local";
import { writeSession } from "@/lib/session";

type JoinResponse = {
  team_id: string;
  member_id: string;
  auth_token: string;
  member_name: string;
  team_name: string;
  error?: string;
};

export function JoinTeamForm({ initialCode }: { initialCode: string }) {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invite_code: inviteCode,
          name: name.trim() || undefined,
        }),
      });
      const data = (await response.json()) as JoinResponse;
      if (!response.ok) {
        throw new Error(data.error || "Could not join team");
      }

      writeSession({
        team_id: data.team_id,
        member_id: data.member_id,
        auth_token: data.auth_token,
        member_name: data.member_name,
      });

      const configured = await notifyLocalAndon({
        team_id: data.team_id,
        member_id: data.member_id,
        auth_token: data.auth_token,
        team_name: data.team_name,
      });
      if (configured) {
        writeAndonConfiguredFlash();
      }

      router.push(`/dashboard?team_id=${data.team_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join team");
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6"
    >
      <h1 className="text-xl font-semibold">Join a team</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Paste the invite code. Name is optional — we can make one up.
      </p>
      <label className="mt-6 block text-sm text-zinc-300">
        Invite code
        <input
          value={inviteCode}
          onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
          maxLength={8}
          required
          placeholder="ABC12XYZ"
          className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono tracking-[0.2em] text-zinc-100 outline-none placeholder:tracking-normal placeholder:text-zinc-600 focus:border-zinc-500"
        />
      </label>
      <label className="mt-4 block text-sm text-zinc-300">
        Your name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          placeholder="Member-3847"
          className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
        />
      </label>
      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-white disabled:opacity-60"
      >
        {pending ? "Joining…" : "Join team"}
      </button>
      <p className="mt-4 text-center text-sm text-zinc-500">
        Need a new board?{" "}
        <Link href="/" className="text-zinc-200 underline-offset-2 hover:underline">
          Create a team
        </Link>
      </p>
    </form>
  );
}
