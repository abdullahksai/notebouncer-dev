// Install entry. Hands off to the backend's OAuth start, which sets the state
// cookie on the BACKEND origin (so the callback can read it back) and bounces
// the user to Zoom.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const backend = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backend) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_BACKEND_URL not set" },
      { status: 500 }
    );
  }
  return NextResponse.redirect(`${backend.replace(/\/$/, "")}/oauth/install`);
}
