import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
const output = new URL('../outputs/ktx-special/public/', import.meta.url);
const colors = { navy: [23,51,75], white: [245,247,250], glass: [99,132,159], orange: [233,133,102], light: [223,231,238] };
const rounded = (x,y,l,t,w,h,r) => { const dx = Math.max(l+r-x,0,x-(l+w-r)), dy = Math.max(t+r-y,0,y-(t+h-r)); return x>=l&&x<=l+w&&y>=t&&y<=t+h&&dx*dx+dy*dy<=r*r; };
const circle = (x,y,cx,cy,r) => (x-cx)**2+(y-cy)**2<=r*r;
const line = (x,y,x1,y1,x2,y2,r) => { const t = Math.max(0,Math.min(1,((x-x1)*(x2-x1)+(y-y1)*(y2-y1))/((x2-x1)**2+(y2-y1)**2))); return circle(x,y,x1+t*(x2-x1),y1+t*(y2-y1),r); };
function pixel(x,y) {
 let c=colors.navy;
 if (line(x,y,47,102,55,89,3)||line(x,y,81,102,73,89,3)) c=colors.orange;
 if (rounded(x,y,34,24,60,68,18)) c=colors.white;
 if (rounded(x,y,44,35,40,21,7)) c=colors.glass;
 if (x>=62&&x<=66&&y>=35&&y<=56) c=colors.white;
 if (rounded(x,y,47,66,34,4,2)) c=colors.light;
 if (circle(x,y,49,79,4)||circle(x,y,79,79,4)) c=colors.orange;
 return c;
}
const table=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(b){let c=0xffffffff;for(const n of b)c=table[(c^n)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function chunk(name,data){const n=Buffer.from(name),len=Buffer.alloc(4),check=Buffer.alloc(4);len.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([n,data])));return Buffer.concat([len,n,data,check]);}
for(const size of [192,512]){
 const raw=Buffer.alloc((size*3+1)*size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const c=[0,0,0];for(let sy=0;sy<2;sy++)for(let sx=0;sx<2;sx++){const p=pixel((x+(sx+.5)/2)*128/size,(y+(sy+.5)/2)*128/size);for(let k=0;k<3;k++)c[k]+=p[k]/4;}
   const pos=y*(size*3+1)+1+x*3;for(let k=0;k<3;k++)raw[pos+k]=Math.round(c[k]);
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=2;
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
 await writeFile(new URL(`icon-${size}.png`,output),png);
}
