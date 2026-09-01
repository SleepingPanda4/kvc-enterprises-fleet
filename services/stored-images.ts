import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { storedImages } from "../db/schema";
const types: Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};export const MAX_STORED_IMAGE_BYTES=5*1024*1024;
function valid(bytes:Buffer,type:string){return (type==="image/jpeg"&&bytes.subarray(0,3).equals(Buffer.from([255,216,255])))||(type==="image/png"&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))||(type==="image/webp"&&bytes.subarray(0,4).toString()==="RIFF"&&bytes.subarray(8,12).toString()==="WEBP")}
const root=()=>process.env.STORED_IMAGE_UPLOAD_ROOT||"/var/lib/kvc-fleet/uploads";
export async function saveStoredImage(file:File,kind:"profile"|"branding"){if(!types[file.type]||file.size>MAX_STORED_IMAGE_BYTES)throw new Error("Choose a JPEG, PNG, or WebP image up to 5 MB.");const bytes=Buffer.from(await file.arrayBuffer());if(!valid(bytes,file.type))throw new Error("The uploaded file is not a valid raster image.");const id=randomUUID(),filename=`${id}.${types[file.type]}`,dir=path.join(root(),kind);await mkdir(dir,{recursive:true,mode:0o750});await writeFile(path.join(dir,filename),bytes,{mode:0o640});await getDb().insert(storedImages).values({id,kind,storedFilename:filename,mimeType:file.type,sizeBytes:bytes.length});return{id,mimeType:file.type}}
export async function readStoredImage(id:string){const[row]=await getDb().select().from(storedImages).where(eq(storedImages.id,id)).limit(1);if(!row)return null;const file=path.resolve(root(),row.kind,row.storedFilename),base=path.resolve(root(),row.kind);if(!file.startsWith(`${base}${path.sep}`))return null;try{return{image:row,content:await readFile(file)}}catch{return null}}
export async function removeStoredImage(id:string|null){if(!id)return;const[row]=await getDb().select().from(storedImages).where(eq(storedImages.id,id)).limit(1);if(!row)return;await rm(path.join(root(),row.kind,row.storedFilename),{force:true}).catch(()=>undefined);await getDb().delete(storedImages).where(eq(storedImages.id,id));}
