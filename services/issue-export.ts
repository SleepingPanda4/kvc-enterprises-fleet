import { asc, eq, inArray } from "drizzle-orm";
import { getDb, type Database } from "../db";
import { issueAttachments, issues, vehicles } from "../db/schema";

export type IssueExportScope = "all" | "open" | "resolved";
export type IssueExportFormat = "csv" | "xlsx";
type ExportRow = Record<string, string | number>;

const columns = ["Issue ID", "Reported Date", "Reported Time", "Reported By", "Vehicle Number", "Route", "Issue Type", "Issue Description", "Status", "Service Scheduled", "Resolved Date", "Resolved Time", "Resolution Information", "Attachment Count", "Attachment Filenames", "Attachment Types", "Report Attachments", "Resolution Attachments", "Later/Edit Attachments"];
const chicagoDate = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit", year: "numeric" });
const chicagoTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });

function safeSpreadsheetText(value: string | null | undefined) {
  const text = value || "";
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function datePart(value: string | null) { return value ? chicagoDate.format(new Date(value)) : ""; }
function timePart(value: string | null) { return value ? chicagoTime.format(new Date(value)) : ""; }

export async function getIssueExportRows(scope: IssueExportScope, database: Database = getDb()) {
  const ticketRows = await database.select({ id: issues.id, vehicleNumber: vehicles.number, routeNumber: vehicles.routeNumber, type: issues.type, notes: issues.notes, status: issues.status, serviceScheduled: issues.serviceScheduled, createdAt: issues.createdAt, resolvedAt: issues.resolvedAt, resolutionNotes: issues.resolutionNotes, reportedByName: issues.reportedByName }).from(issues).innerJoin(vehicles, eq(issues.vehicleId, vehicles.id));
  const filtered = ticketRows.filter(issue => scope === "all" || issue.status === scope).sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() || left.vehicleNumber.localeCompare(right.vehicleNumber, undefined, { numeric: true }) || left.id - right.id);
  const attachmentRows = filtered.length === 0 ? [] : await database.select().from(issueAttachments).where(inArray(issueAttachments.issueId, filtered.map(issue => issue.id))).orderBy(asc(issueAttachments.id));
  const grouped = new Map<number, typeof attachmentRows>();
  for (const attachment of attachmentRows) grouped.set(attachment.issueId, [...(grouped.get(attachment.issueId) || []), attachment]);
  return filtered.map(issue => {
    const attachments = grouped.get(issue.id) || [];
    const attachmentNames = (context: "report" | "resolution" | "update") => attachments.filter(attachment => attachment.context === context).map(attachment => safeSpreadsheetText(attachment.originalFilename)).join("; ");
    return {
      "Issue ID": issue.id, "Reported Date": datePart(issue.createdAt), "Reported Time": timePart(issue.createdAt), "Reported By": safeSpreadsheetText(issue.reportedByName), "Vehicle Number": safeSpreadsheetText(issue.vehicleNumber), "Route": safeSpreadsheetText(issue.routeNumber), "Issue Type": safeSpreadsheetText(issue.type), "Issue Description": safeSpreadsheetText(issue.notes), "Status": issue.status === "resolved" ? "Resolved" : "Open", "Service Scheduled": issue.serviceScheduled ? "Yes" : "No", "Resolved Date": datePart(issue.resolvedAt), "Resolved Time": timePart(issue.resolvedAt), "Resolution Information": safeSpreadsheetText(issue.resolutionNotes), "Attachment Count": attachments.length, "Attachment Filenames": attachments.map(attachment => safeSpreadsheetText(attachment.originalFilename)).join("; "), "Attachment Types": attachments.map(attachment => attachment.mimeType).join("; "), "Report Attachments": attachmentNames("report"), "Resolution Attachments": attachmentNames("resolution"), "Later/Edit Attachments": attachmentNames("update"),
    } satisfies ExportRow;
  });
}

export function issueExportFilename(scope: IssueExportScope, format: IssueExportFormat, now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now).replaceAll("/", "-");
  return `kvc-vehicle-issues-${scope}-${date}.${format}`;
}

export function createCsvExport(rows: ExportRow[]) {
  const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  return `\uFEFF${[columns, ...rows.map(row => columns.map(column => row[column] ?? ""))].map(row => row.map(cell).join(",")).join("\r\n")}`;
}

// eslint-disable-next-line no-control-regex -- XML 1.0 explicitly forbids these control characters.
function escapeXml(value: string | number) { return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function excelColumn(index: number) { let result = ""; for (let value = index; value >= 0; value = Math.floor(value / 26) - 1) result = String.fromCharCode(value % 26 + 65) + result; return result; }
function xmlCell(reference: string, value: string | number, style?: number) { return `<c r="${reference}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`; }

const crcTable = (() => { const table = new Uint32Array(256); for (let index = 0; index < 256; index += 1) { let value = index; for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; table[index] = value >>> 0; } return table; })();
function crc32(buffer: Buffer) { let value = 0xffffffff; for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
function zip(files: Array<{ name: string; content: string }>) { const chunks: Buffer[] = []; const central: Buffer[] = []; let offset = 0; for (const file of files) { const name = Buffer.from(file.name); const content = Buffer.from(file.content, "utf8"); const crc = crc32(content); const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(content.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26); chunks.push(local, name, content); const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(content.length, 20); entry.writeUInt32LE(content.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42); central.push(entry, name); offset += local.length + name.length + content.length; } const centralSize = central.reduce((total, entry) => total + entry.length, 0); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...chunks, ...central, end]); }

export function createXlsxExport(rows: ExportRow[], scope: IssueExportScope, now = new Date()) {
  const historyRows = [columns, ...rows.map(row => columns.map(column => row[column] ?? ""))].map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => xmlCell(`${excelColumn(columnIndex)}${rowIndex + 1}`, value, rowIndex === 0 ? 1 : [6, 11, 13, 15, 16, 17].includes(columnIndex) ? 2 : undefined)).join("")}</row>`).join("");
  const widths = [10, 14, 12, 15, 10, 18, 42, 12, 18, 14, 12, 42, 16, 35, 28, 35, 35, 35].map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const history = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${historyRows}</sheetData><autoFilter ref="A1:${excelColumn(columns.length - 1)}${Math.max(rows.length + 1, 1)}"/></worksheet>`;
  const open = rows.filter(row => row.Status === "Open").length, resolved = rows.filter(row => row.Status === "Resolved").length, withAttachments = rows.filter(row => Number(row["Attachment Count"]) > 0).length;
  const summaryValues = [["Export Scope", scope], ["Generated", `${datePart(now.toISOString())} ${timePart(now.toISOString())}`], ["Total Issues", rows.length], ["Open Issues", open], ["Resolved Issues", resolved], ["Vehicles Represented", new Set(rows.map(row => row["Vehicle Number"])).size], ["Issues with Attachments", withAttachments]];
  const summary = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="26" customWidth="1"/></cols><sheetData><row r="1">${xmlCell("A1", "Issue History Summary", 1)}</row>${summaryValues.map((row, index) => `<row r="${index + 2}">${xmlCell(`A${index + 2}`, row[0])}${xmlCell(`B${index + 2}`, row[1])}</row>`).join("")}</sheetData></worksheet>`;
  return zip([
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Issue History" sheetId="1" r:id="rId1"/><sheet name="Summary" sheetId="2" r:id="rId2"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf xfId="0"/><xf fontId="1" fillId="0" borderId="0" applyFont="1"/><xf xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    { name: "xl/worksheets/sheet1.xml", content: history }, { name: "xl/worksheets/sheet2.xml", content: summary },
  ]);
}
