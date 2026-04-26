import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { isSecureRequest } from "../../../../lib/auth";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  cookieStore.set("ironclaw_session", "", {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return NextResponse.json({ success: true });
}
