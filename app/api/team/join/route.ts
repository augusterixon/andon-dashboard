import { NextResponse } from "next/server";
import { joinTeam } from "@/lib/db";
import { handleRouteError, HttpError, readJson } from "@/lib/http";

type JoinTeamBody = {
  invite_code?: string;
  name?: string;
};

export async function POST(request: Request) {
  try {
    const body = await readJson<JoinTeamBody>(request);
    const inviteCode = body.invite_code?.trim();

    if (!inviteCode) {
      throw new HttpError(400, "Invite code is required");
    }

    const name = body.name?.trim();
    if (name && name.length > 40) {
      throw new HttpError(400, "Name must be 40 characters or less");
    }

    const result = await joinTeam(inviteCode, name);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
