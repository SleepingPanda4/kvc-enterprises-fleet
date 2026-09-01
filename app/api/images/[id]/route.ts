import { readStoredImage } from "../../../../services/stored-images";
import { getCurrentUser } from "../../../auth/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await getCurrentUser(request)) return new Response("Authentication required", { status: 401 });
  const image = await readStoredImage((await params).id);
  return image
    ? new Response(image.content, { headers: { "Content-Type": image.image.mimeType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } })
    : new Response("Not found", { status: 404 });
}
