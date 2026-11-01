// Signs in to the test account with no Discord/Google step, for local development only. The account has no
// password: the service-role key makes a one-time sign-in token, which we swap for a session cookie right here.
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { devLoginEnabled, isLocalHost, TEST_USER_EMAIL } from "@/lib/dev-login";
import { safeNext } from "@/lib/safe-next";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  // The Host header, because nextUrl.hostname says localhost even for a request to this PC's network address.
  const hostname = (request.headers.get("host") ?? "").split(":")[0];
  if (!devLoginEnabled() || !isLocalHost(hostname)) return new NextResponse("Not found", { status: 404 });

  const admin = createAdminClient();
  const { error: createError } = await admin.auth.admin.createUser({ email: TEST_USER_EMAIL, email_confirm: true });
  if (createError && createError.code !== "email_exists") {
    return new NextResponse(`Test sign-in failed: ${createError.message}`, { status: 500 });
  }

  const { data, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: TEST_USER_EMAIL });
  if (linkError) return new NextResponse(`Test sign-in failed: ${linkError.message}`, { status: 500 });

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (error) return new NextResponse(`Test sign-in failed: ${error.message}`, { status: 500 });

  return NextResponse.redirect(`${origin}${safeNext(searchParams.get("next"))}`);
}
