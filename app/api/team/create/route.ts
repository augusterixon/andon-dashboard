import { NextResponse } from "next/server";
import { createTeam } from "@/lib/db";
import { handleRouteError, HttpError, readJson } from "@/lib/http";

type CreateTeamBody = {
  name?: string;
};

export async function POST(request: Request) {
  try {
    const body = await readJson<CreateTeamBody>(request);
    const name = body.name?.trim();

    if (!name) {
      throw new HttpError(400, "Team name is required");
    }
    if (name.length > 80) {
      throw new HttpError(400, "Team name must be 80 characters or less");
    }

    const team = await createTeam(name);
    return NextResponse.json({
      team_id: team.id,
      invite_code: team.invite_code,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
