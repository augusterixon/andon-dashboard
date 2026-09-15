import { NextRequest, NextResponse } from "next/server";
import { getTodayStats } from "@/lib/analytics";
import { handleRouteError, HttpError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const teamId = request.nextUrl.searchParams.get("team_id")?.trim();
    if (!teamId) {
      throw new HttpError(400, "team_id is required");
    }

    const members = await getTodayStats(teamId);
    return NextResponse.json({
      members: members.map((member) => ({
        member_id: member.member_id,
        name: member.name,
        state: member.state,
        yellow_seconds: member.yellow_seconds,
        red_seconds: member.red_seconds,
        green_seconds: member.green_seconds,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
