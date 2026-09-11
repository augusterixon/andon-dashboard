import { NextRequest, NextResponse } from "next/server";
import { getTeamStatus } from "@/lib/db";
import { handleRouteError, HttpError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const teamId = request.nextUrl.searchParams.get("team_id")?.trim();
    if (!teamId) {
      throw new HttpError(400, "team_id is required");
    }

    const status = await getTeamStatus(teamId);
    return NextResponse.json({
      team: status.team,
      members: status.members.map((member) => ({
        id: member.id,
        name: member.name,
        state: member.state,
        updated_at: member.updated_at,
        created_at: member.created_at,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
