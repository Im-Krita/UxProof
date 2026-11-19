export interface ScreenshotOutline { left:number; top:number; width:number; height:number }
export interface EvidenceGeometry {
  status: 'ok' | 'absent' | 'mismatch';
  geometry?: { x:number; y:number; width:number; height:number; viewportWidth:number; viewportHeight:number; deviceScaleFactor:number; scrollX:number; scrollY:number };
  outline?: ScreenshotOutline;
}
export function evidenceGeometry(report:unknown, filename:string, imageWidth:number, imageHeight:number):EvidenceGeometry;
export function evidenceCaption(geometry:unknown):string | null;
export function screenshotOutline(report:unknown, filename:string, imageWidth:number, imageHeight:number):ScreenshotOutline | null;
