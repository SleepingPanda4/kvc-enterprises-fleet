import { createCsvExport, createXlsxExport, getIssueExportRows, issueExportFilename, type IssueExportFormat, type IssueExportScope } from "../../../../services/issue-export";
import { requireManager } from "../../../auth/server";

export async function GET(request: Request) {
  const auth = await requireManager(request); if (auth instanceof Response) return auth;
  const url = new URL(request.url); const format = url.searchParams.get("format"); const scope = url.searchParams.get("scope");
  if ((format !== "csv" && format !== "xlsx") || (scope !== "all" && scope !== "open" && scope !== "resolved")) return Response.json({ error: "Export format must be csv or xlsx, and scope must be all, open, or resolved." }, { status: 400 });
  const typedFormat = format as IssueExportFormat, typedScope = scope as IssueExportScope;
  const rows = await getIssueExportRows(typedScope);
  const content = typedFormat === "csv" ? createCsvExport(rows) : createXlsxExport(rows, typedScope);
  return new Response(content, { headers: { "Content-Type": typedFormat === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${issueExportFilename(typedScope, typedFormat)}"`, "Cache-Control": "no-store" } });
}
