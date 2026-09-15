import { NextRequest, NextResponse } from "next/server";
import { getLeaderboard, isLeaderboardPeriod } from "@/lib/analytics";
import { handleRouteError, HttpError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const teamId = request.nextUrl.searchParams.get("team_id")?.trim();
    if (!teamId) {
      throw new HttpError(400, "team_id is required");
    }

    const periodParam = request.nextUrl.searchParams.get("period") ?? "today";
    if (!isLeaderboardPeriod(periodParam)) {
      throw new HttpError(400, "period must be today or month");
    }

    const board = await getLeaderboard(teamId, periodParam);
    return NextResponse.json(board);
  } catch (error) {
    return handleRouteError(error);
  }
}
