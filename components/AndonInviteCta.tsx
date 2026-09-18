"use client";

import { useMemo, useState } from "react";
import { buildAndonJoinHref } from "@/lib/andon-url";

type Props = {
  inviteCode: string;
  teamId: string;
  teamName: string;
};

export function AndonInviteCta({ inviteCode, teamId, teamName }: Props) {
  const [copied, setCopied] = useState(false);
  const href = useMemo(
    () =>
      buildAndonJoinHref({
        inviteCode,
        teamId,
        teamName,
      }),
    [inviteCode, teamId, teamName],
  );

  async function copyHref() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="rounded-2xl border border-accent/45 bg-accent/12 p-5 shadow-[0_0_36px_rgba(232,195,106,0.12)]">
      <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
        Install Andon and join this team
      </p>
      <a
        href={href}
        className="mt-4 block rounded-xl bg-accent px-4 py-3 text-center text-sm font-semibold text-background hover:opacity-90"
      >
        Click to install Andon and join this team
      </a>
      <div className="mt-3 flex items-start gap-2">
        <a
          href={href}
          className="min-w-0 flex-1 break-all font-mono text-xs leading-5 text-foreground underline-offset-2 hover:underline"
        >
          {href}
        </a>
        <button
          type="button"
          onClick={copyHref}
          className="shrink-0 rounded-lg border border-accent/40 bg-background/40 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/15"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">
        If Andon is already installed, this joins the team directly. Otherwise install
        first, then click the link again.
      </p>
      <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-lg bg-background/60 px-3 py-2 font-mono text-[11px] leading-5 text-foreground/85">
        curl -fsSL https://raw.githubusercontent.com/augusterixon/andon/main/curl-install.sh | bash
      </code>
    </section>
  );
}
