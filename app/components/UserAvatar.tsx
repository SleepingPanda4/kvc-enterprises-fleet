/* eslint-disable @next/next/no-img-element */
"use client";
import { useState } from "react";
export function initials(name:string){return name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join("").toUpperCase()||"KV"}
export function UserAvatar({name,imageId,size=34}:{name:string;imageId?:string|null;size?:number}){const[failed,setFailed]=useState(false);return imageId&&!failed?<img className="user-avatar" src={`/api/images/${encodeURIComponent(imageId)}`} alt={`${name} avatar`} onError={()=>setFailed(true)} style={{width:size,height:size}}/>:<span className="user-avatar avatar" style={{width:size,height:size}} aria-label={`${name} initials`}>{initials(name)}</span>}
