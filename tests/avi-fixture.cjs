// Minimal uncompressed AVI with a checkerboard, no external encoder required.
function aviFixture(n=128,frames=3){
 const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
 const chunk=(tag,b)=>Buffer.concat([Buffer.from(tag),u32(b.length),b,b.length%2?Buffer.alloc(1):Buffer.alloc(0)]);
 const list=(tag,items)=>chunk('LIST',Buffer.concat([Buffer.from(tag),...items]));
 const header=Buffer.alloc(56);[100000,0,0,16,frames,0,1,n*n*3,n,n].forEach((v,i)=>header.writeUInt32LE(v,i*4));
 const stream=Buffer.alloc(56);stream.write('vids',0);stream.write('DIB ',4);stream.writeUInt32LE(1,20);stream.writeUInt32LE(10,24);stream.writeUInt32LE(frames,32);stream.writeUInt32LE(n*n*3,36);stream.writeUInt32LE(0xffffffff,40);stream.writeInt16LE(n,52);stream.writeInt16LE(n,54);
 const format=Buffer.alloc(40);format.writeUInt32LE(40);format.writeInt32LE(n,4);format.writeInt32LE(n,8);format.writeUInt16LE(1,12);format.writeUInt16LE(24,14);format.writeUInt32LE(n*n*3,20);
 const images=[],index=[];let offset=4;
 for(let f=0;f<frames;f++){const image=Buffer.alloc(n*n*3);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const v=Math.round(128+55*Math.cos(Math.PI/8*(x+y)+f*.05)+55*Math.cos(Math.PI/8*(x-y)));for(let c=0;c<3;c++)image[((n-1-y)*n+x)*3+c]=v;}const data=chunk('00db',image);images.push(data);const idx=Buffer.alloc(16);idx.write('00db');idx.writeUInt32LE(16,4);idx.writeUInt32LE(offset,8);idx.writeUInt32LE(image.length,12);index.push(idx);offset+=data.length;}
 return chunk('RIFF',Buffer.concat([Buffer.from('AVI '),list('hdrl',[chunk('avih',header),list('strl',[chunk('strh',stream),chunk('strf',format)])]),list('movi',images),chunk('idx1',Buffer.concat(index))]));
}
module.exports={aviFixture};
