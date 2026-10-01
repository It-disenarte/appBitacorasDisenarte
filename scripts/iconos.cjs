/* Genera todos los íconos de Bitácora a partir de la hoja en SVG.
   Uso: node scripts/iconos.cjs
   sharp se toma del Cotizador (esta app no tiene node_modules propios). */
const fs = require('fs');
const path = require('path');
const sharp = require(path.resolve(__dirname, '../../5.cotizador-disenarte/cotizador-disenarte/node_modules/sharp'));

const MORADO = '#7C07A6';
const OUT = path.resolve(__dirname, '../icons');

// Hoja de Diseñarte: esquinas superior izquierda e inferior derecha al 40 % del lado, las otras al 11 %.
const HOJA = 'M12,207.2 A195.2,195.2 0 0 1 207.2,12 H446.32 A53.68,53.68 0 0 1 500,65.68 V304.8 A195.2,195.2 0 0 1 304.8,500 H65.68 A53.68,53.68 0 0 1 12,446.32 Z';
// Pictograma: libreta con lomo y renglones.
const LIBRETA = (color, escala = 1) => `<g transform="translate(256 256) scale(${escala}) translate(-256 -256)" fill="none" stroke="${color}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"><rect x="178" y="160" width="156" height="192" rx="22"/><path d="M212 160v192M212 312h122M244 214h58M244 258h36"/></g>`;

const svg = (cuerpo) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${cuerpo}</svg>`;
const hoja = svg(`<path fill="${MORADO}" d="${HOJA}"/>${LIBRETA('#FFFFFF')}`);
const hojaBlanca = svg(`<path fill="#FFFFFF" d="${HOJA}"/>${LIBRETA(MORADO)}`);
// Cuadrado de color completo: maskable (pictograma dentro del 80 % central) y apple-touch (iOS pinta de negro lo transparente).
const lleno = svg(`<rect width="512" height="512" fill="${MORADO}"/>${LIBRETA('#FFFFFF', 1.15)}`);

function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ size, buf }, i) => {
    const o = 6 + 16 * i;
    head.writeUInt8(size, o); head.writeUInt8(size, o + 1);
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(buf.length, o + 8); head.writeUInt32LE(off, o + 12);
    off += buf.length;
  });
  return Buffer.concat([head, ...pngs.map(p => p.buf)]);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'hoja.svg'), hoja);
  fs.writeFileSync(path.join(OUT, 'hoja-blanca.svg'), hojaBlanca);
  const png = (s, size) => sharp(Buffer.from(s), { density: 384 }).resize(size, size).png().toBuffer();
  fs.writeFileSync(path.join(OUT, 'hoja-192.png'), await png(hoja, 192));
  fs.writeFileSync(path.join(OUT, 'hoja-512.png'), await png(hoja, 512));
  fs.writeFileSync(path.join(OUT, 'hoja-512-maskable.png'), await png(lleno, 512));
  fs.writeFileSync(path.join(OUT, 'hoja-apple-touch.png'), await png(lleno, 180));
  const tam = [16, 32, 48];
  fs.writeFileSync(path.resolve(__dirname, '../favicon.ico'), ico(await Promise.all(tam.map(async size => ({ size, buf: await png(hoja, size) })))));
  console.log('Íconos generados en icons/ y favicon.ico');
})();
