export interface ScreenshotOutline { left:number; top:number; width:number; height:number }
export function screenshotOutline(report:unknown, filename:string, imageWidth:number, imageHeight:number):ScreenshotOutline | null;
