/**
 * 极简 PNG 解码器，只做测试用：支持 8 位深、非隔行的 RGB / RGBA。
 * 用途是从截图里取真实像素，验证滤镜是否真的把页面渲染成暗色。
 * （getComputedStyle 读到的是滤镜前的颜色，看不出效果）
 */
'use strict';

const zlib = require('zlib');

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decode(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG 文件');

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  let interlace = 0;
  const idat = [];

  while (offset < buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.slice(offset + 8, offset + 8 + len);
    offset += 12 + len;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8) throw new Error('只支持 8 位深，实际 ' + bitDepth);
  if (interlace !== 0) throw new Error('不支持隔行 PNG');
  if (colorType !== 2 && colorType !== 6) throw new Error('只支持 RGB/RGBA，实际 colorType=' + colorType);

  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const srcStart = y * (stride + 1) + 1;
    const dstStart = y * stride;

    for (let x = 0; x < stride; x++) {
      const rawByte = raw[srcStart + x];
      const left = x >= channels ? out[dstStart + x - channels] : 0;
      const up = y > 0 ? out[dstStart - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? out[dstStart - stride + x - channels] : 0;

      let value;
      switch (filter) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + left;
          break;
        case 2:
          value = rawByte + up;
          break;
        case 3:
          value = rawByte + ((left + up) >> 1);
          break;
        case 4:
          value = rawByte + paeth(left, up, upLeft);
          break;
        default:
          throw new Error('未知的行过滤类型 ' + filter + '（第 ' + y + ' 行）');
      }
      out[dstStart + x] = value & 0xff;
    }
  }

  return { width, height, channels, data: out };
}

/** 取某点亮度（0-255 感知亮度） */
function luminanceAt(img, x, y) {
  const px = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  const i = (py * img.width + px) * img.channels;
  return (img.data[i] * 299 + img.data[i + 1] * 587 + img.data[i + 2] * 114) / 1000;
}

/** 区域内亮度的最小/最大/平均 */
function regionStats(img, rect) {
  let min = 255;
  let max = 0;
  let sum = 0;
  let count = 0;

  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(img.width - 1, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(img.height - 1, Math.ceil(rect.y + rect.h));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const lum = luminanceAt(img, x, y);
      if (lum < min) min = lum;
      if (lum > max) max = lum;
      sum += lum;
      count += 1;
    }
  }
  if (count === 0) return { min: 0, max: 0, avg: 0, count: 0 };
  return { min, max, avg: sum / count, count };
}

/** 整图平均亮度 */
function imageMean(img) {
  return regionStats(img, { x: 0, y: 0, w: img.width - 1, h: img.height - 1 }).avg;
}

module.exports = { decode, luminanceAt, regionStats, imageMean };
