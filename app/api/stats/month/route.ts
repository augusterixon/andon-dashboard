import { NextRequest, NextResponse } from "next/server";
import { getMonthStats, serializeMemberStats } from "@/lib/analytics";
import { handleRouteError, HttpError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const teamId = request.nextUrl.searchParams.get("team_id")?.trim();
    if (!teamId) {
      throw new HttpError(400, "team_id is required");
    }

    const now = new Date();
    const yearParam = request.nextUrl.searchParams.get("year");
    const monthParam = request.nextUrl.searchParams.get("month");
    const year = yearParam ? Number(yearParam) : now.getUTCFullYear();
    const month = monthParam ? Number(monthParam) : now.getUTCMonth() + 1;

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new HttpError(400, "year must be a valid number");
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new HttpError(400, "month must be between 1 and 12");
    }

    const members = await getMonthStats(teamId, year, month);
    return NextResponse.json({
      year,
      month,
      members: members.map(serializeMemberStats),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
