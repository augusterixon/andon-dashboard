"use client";

import { useMemo, useState } from "react";
import { buildAndonJoinHref } from "@/lib/andon-url";

type Props = {
  inviteCode: string;
  teamId: string;
  teamName: string;
};

export function TeamInviteShare({ inviteCode, teamId, teamName }: Props) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const inviteLink = useMemo(
    () =>
      buildAndonJoinHref({
        inviteCode,
        teamId,
        teamName,
      }),
    [inviteCode, teamId, teamName],
  );

  async function copy(key: "code" | "link", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => {
        setCopied((current) => (current === key ? null : current));
      }, 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-2 sm:flex-row sm:items-center sm:gap-0">
      <div className="flex items-center gap-2 sm:pr-3">
        <p className="text-[10px] font-medium tracking-[0.16em] text-muted uppercase">
          Code
        </p>
        <p className="font-mono text-sm tracking-[0.18em] text-foreground">
          {inviteCode}
        </p>
        <CopyButton
          label="Copy invite code"
          copied={copied === "code"}
          onClick={() => copy("code", inviteCode)}
        />
      </div>
      <div className="hidden h-4 w-px bg-border sm:block" />
      <div className="flex min-w-0 items-center gap-2 sm:flex-1 sm:pl-3">
        <p className="shrink-0 text-[10px] font-medium tracking-[0.16em] text-muted uppercase">
          Link
        </p>
        <p
          title={inviteLink}
          className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80"
        >
          {inviteLink}
        </p>
        <CopyButton
          label="Copy invite link"
          copied={copied === "link"}
          onClick={() => copy("link", inviteLink)}
        />
      </div>
    </div>
  );
}

function CopyButton({
  label,
  copied,
  onClick,
}: {
  label: string;
  copied: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copied ? `${label} copied` : label}
      className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-foreground/70 transition hover:bg-surface-2 hover:text-foreground"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
