import { NextResponse } from "next/server";

import { PlaneApiError, getProjects } from "@/lib/plane-api";

export async function GET() {
  const workspaceSlug = process.env.PLANE_WORKSPACE_SLUG;

  if (!workspaceSlug) {
    return NextResponse.json(
      { error: "PLANE_WORKSPACE_SLUG is not configured." },
      {
        status: 500,
      },
    );
  }

  try {
    const projects = await getProjects(workspaceSlug);
    return NextResponse.json(projects);
  } catch (error) {
    if (error instanceof PlaneApiError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: error.status,
        },
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to fetch projects.";

    return NextResponse.json(
      { error: message },
      {
        status: 500,
      },
    );
  }
}
