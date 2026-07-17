export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    service: "ai-usage",
    status: "ok",
    desktopManaged: process.env.AI_USAGE_DESKTOP_MANAGED === "1",
  });
}
