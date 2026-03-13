import { NextResponse } from "next/server";

import { PlaneApiError, getCurrentUser } from "@/lib/plane-api";

export async function GET() {
  try {
    const user = await getCurrentUser();
    return NextResponse.json(user);
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
      error instanceof Error ? error.message : "Failed to fetch current user.";

    return NextResponse.json(
      { error: message },
      {
        status: 500,
      },
    );
  }
}
