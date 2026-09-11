import { NextResponse } from "next/server";
import { updateMemberState } from "@/lib/db";
import { handleRouteError, HttpError, readJson } from "@/lib/http";
import { isAndonState } from "@/lib/types";

type UpdateStateBody = {
  team_id?: string;
  member_id?: string;
  state?: string;
  auth_token?: string;
};

export async function POST(request: Request) {
  try {
    const body = await readJson<UpdateStateBody>(request);
    const teamId = body.team_id?.trim();
    const memberId = body.member_id?.trim();
    const authToken = body.auth_token?.trim();

    if (!teamId || !memberId || !authToken) {
      throw new HttpError(400, "team_id, member_id, and auth_token are required");
    }
    if (!isAndonState(body.state)) {
      throw new HttpError(400, "state must be green, yellow, or red");
    }

    await updateMemberState({
      teamId,
      memberId,
      state: body.state,
      authToken,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
