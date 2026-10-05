// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// ABR tip extraction is adapted from Sable's MIT-licensed AbrReader by
// Drommedhar (2026), then bounded and translated for a browser worker. The
// original implementation and license are credited in THIRD_PARTY_LICENSES.

const MAX_TIP_EDGE = 512;
const MAX_SOURCE_PIXELS = 32 * 1024 * 1024;
const MAX_BRUSHES = 500;
const MAX_DESCRIPTOR_ITEMS = 10_000;

export interface AbrBrushTip {
  name: string;
  width: number;
  height: number;
  coverage: Uint8Array;
  diameter: number;
  hardness: number;
  spacing: number;
  angle: number;
  roundness: number;
  sampled: boolean;
  sourceId?: string;
}

export interface AbrImportResult {
  version: number;
  subversion: number;
  brushes: AbrBrushTip[];
  notes: string[];
}

interface SampledTip {
  id: string;
  coverage: Uint8Array;
  width: number;
  height: number;
}

class AbrReader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  pos = 0;

  constructor(buffer: ArrayBuffer) {
    this.bytes = new Uint8Array(buffer);
    this.view = new DataView(buffer);
  }

  private need(length: number) {
    if (!Number.isSafeInteger(length) || length < 0 || this.pos + length > this.bytes.length) {
      throw new Error('Unexpected end of ABR data.');
    }
  }

  seek(position: number) {
    if (!Number.isSafeInteger(position) || position < 0 || position > this.bytes.length) {
      throw new Error('Invalid ABR offset.');
    }
    this.pos = position;
  }

  skip(length: number) {
    this.need(length);
    this.pos += length;
  }

  u8(): number {
    this.need(1);
    return this.bytes[this.pos++];
  }

  u16(): number {
    this.need(2);
    const value = this.view.getUint16(this.pos, false);
    this.pos += 2;
    return value;
  }

  i16(): number {
    this.need(2);
    const value = this.view.getInt16(this.pos, false);
    this.pos += 2;
    return value;
  }

  u32(): number {
    this.need(4);
    const value = this.view.getUint32(this.pos, false);
    this.pos += 4;
    return value;
  }

  f64(): number {
    this.need(8);
    const value = this.view.getFloat64(this.pos, false);
    this.pos += 8;
    return value;
  }

  ascii(length: number): string {
    this.need(length);
    let value = '';
    for (let index = 0; index < length; index += 1) value += String.fromCharCode(this.bytes[this.pos + index]);
    this.pos += length;
    return value;
  }

  take(length: number): Uint8Array {
    this.need(length);
    const value = this.bytes.slice(this.pos, this.pos + length);
    this.pos += length;
    return value;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function readUnicode(reader: AbrReader): string {
  const length = reader.u32();
  if (length > 1_000_000) throw new Error('ABR string is unreasonably large.');
  let value = '';
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(reader.u16());
  return value.replace(/\0+$/g, '');
}

function align4(value: number): number {
  return value + ((4 - (value % 4)) % 4);
}

function downscaleTip(coverage: Uint8Array, width: number, height: number): SampledTip {
  if (Math.max(width, height) <= MAX_TIP_EDGE) return { id: '', coverage, width, height };
  const scale = MAX_TIP_EDGE / Math.max(width, height);
  const nextWidth = Math.max(1, Math.floor(width * scale));
  const nextHeight = Math.max(1, Math.floor(height * scale));
  const next = new Uint8Array(nextWidth * nextHeight);
  for (let y = 0; y < nextHeight; y += 1) {
    const sourceY0 = Math.floor(y * height / nextHeight);
    const sourceY1 = Math.max(sourceY0 + 1, Math.floor((y + 1) * height / nextHeight));
    for (let x = 0; x < nextWidth; x += 1) {
      const sourceX0 = Math.floor(x * width / nextWidth);
      const sourceX1 = Math.max(sourceX0 + 1, Math.floor((x + 1) * width / nextWidth));
      let total = 0;
      let count = 0;
      for (let sourceY = sourceY0; sourceY < sourceY1; sourceY += 1) {
        for (let sourceX = sourceX0; sourceX < sourceX1; sourceX += 1) {
          total += coverage[sourceY * width + sourceX];
          count += 1;
        }
      }
      next[y * nextWidth + x] = Math.round(total / Math.max(1, count));
    }
  }
  return { id: '', coverage: next, width: nextWidth, height: nextHeight };
}

function readTipRows(reader: AbrReader, width: number, height: number, depth: number, compressed: boolean): SampledTip {
  if (width <= 0 || height <= 0 || width * height > MAX_SOURCE_PIXELS) {
    throw new Error('ABR tip dimensions exceed the safe import limit.');
  }
  const bytesPerPixel = depth === 16 ? 2 : 1;
  const rowBytes = width * bytesPerPixel;
  const raw = new Uint8Array(rowBytes * height);
  if (!compressed) {
    raw.set(reader.take(raw.length));
  } else {
    const counts = Array.from({ length: height }, () => reader.u16());
    for (let y = 0; y < height; y += 1) {
      const rowEnd = reader.pos + counts[y];
      if (rowEnd > reader.bytes.length) throw new Error('ABR compressed row exceeds file bounds.');
      let output = y * rowBytes;
      const outputEnd = output + rowBytes;
      while (reader.pos < rowEnd && output < outputEnd) {
        const controlByte = reader.u8();
        const control = controlByte > 127 ? controlByte - 256 : controlByte;
        if (control >= 0) {
          const literalLength = control + 1;
          const available = Math.min(literalLength, outputEnd - output, rowEnd - reader.pos);
          raw.set(reader.take(available), output);
          output += available;
          if (available < literalLength) reader.skip(Math.min(literalLength - available, rowEnd - reader.pos));
        } else if (control !== -128) {
          if (reader.pos >= rowEnd) break;
          const value = reader.u8();
          const repeatLength = Math.min(1 - control, outputEnd - output);
          raw.fill(value, output, output + repeatLength);
          output += repeatLength;
        }
      }
      reader.seek(rowEnd);
    }
  }

  let coverage = raw;
  if (bytesPerPixel === 2) {
    coverage = new Uint8Array(width * height);
    for (let index = 0; index < coverage.length; index += 1) coverage[index] = raw[index * 2];
  }
  return downscaleTip(coverage, width, height);
}

function computedTip(diameter: number, hardness: number, roundness: number, angle: number): SampledTip {
  const size = clamp(Math.ceil(diameter || 32), 16, MAX_TIP_EDGE);
  const coverage = new Uint8Array(size * size);
  const center = (size - 1) / 2;
  const radius = Math.max(1, size / 2 - 0.5);
  const radians = angle * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const safeRoundness = clamp(roundness || 1, 0.025, 1);
  const hardCore = clamp(hardness || 0, 0, 1);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const normalizedX = (x - center) / radius;
      const normalizedY = (y - center) / radius;
      const localX = normalizedX * cosine + normalizedY * sine;
      const localY = (-normalizedX * sine + normalizedY * cosine) / safeRoundness;
      const distance = Math.sqrt(localX * localX + localY * localY);
      if (distance > 1) continue;
      let alpha = 1;
      if (hardCore < 0.999 && distance > hardCore) {
        const fade = clamp((1 - distance) / Math.max(0.001, 1 - hardCore), 0, 1);
        alpha = fade * fade * (3 - 2 * fade);
      }
      coverage[y * size + x] = Math.round(alpha * 255);
    }
  }
  return { id: '', coverage, width: size, height: size };
}

class PsDescriptor {
  readonly items = new Map<string, unknown>();

  get(key: string): unknown {
    return this.items.get(key);
  }

  has(key: string): boolean {
    return this.items.has(key);
  }

  string(key: string): string | null {
    const value = this.items.get(key);
    return typeof value === 'string' ? value : null;
  }

  number(key: string): number | null {
    const value = this.items.get(key);
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
}

function readDescriptorKey(reader: AbrReader): string {
  const declaredLength = reader.u32();
  const length = declaredLength === 0 ? 4 : declaredLength;
  if (length > 1024) throw new Error('ABR descriptor key is too large.');
  return reader.ascii(length);
}

function readDescriptor(reader: AbrReader, depth = 0): PsDescriptor {
  if (depth > 16) throw new Error('ABR descriptor nesting is too deep.');
  readUnicode(reader);
  readDescriptorKey(reader);
  const descriptor = new PsDescriptor();
  const count = reader.u32();
  if (count > MAX_DESCRIPTOR_ITEMS) throw new Error('ABR descriptor has too many items.');
  for (let index = 0; index < count; index += 1) {
    const key = readDescriptorKey(reader);
    descriptor.items.set(key, readDescriptorValue(reader, depth + 1));
  }
  return descriptor;
}

function readDescriptorReference(reader: AbrReader) {
  const type = reader.ascii(4);
  switch (type) {
    case 'prop':
      readUnicode(reader); readDescriptorKey(reader); readDescriptorKey(reader); break;
    case 'Clss':
      readUnicode(reader); readDescriptorKey(reader); break;
    case 'Enmr':
      readUnicode(reader); readDescriptorKey(reader); readDescriptorKey(reader); readDescriptorKey(reader); break;
    case 'rele':
      readUnicode(reader); readDescriptorKey(reader); reader.skip(4); break;
    case 'Idnt':
    case 'indx':
      reader.skip(4); break;
    case 'name':
      readUnicode(reader); readDescriptorKey(reader); readUnicode(reader); break;
    default:
      throw new Error(`Unknown ABR reference type ${type}.`);
  }
}

function readDescriptorValue(reader: AbrReader, depth: number): unknown {
  const type = reader.ascii(4);
  switch (type) {
    case 'Objc':
    case 'GlbO':
      return readDescriptor(reader, depth);
    case 'VlLs': {
      const count = reader.u32();
      if (count > MAX_DESCRIPTOR_ITEMS) throw new Error('ABR descriptor list is too large.');
      return Array.from({ length: count }, () => readDescriptorValue(reader, depth + 1));
    }
    case 'doub':
      return reader.f64();
    case 'UntF':
      reader.skip(4); return reader.f64();
    case 'TEXT':
      return readUnicode(reader);
    case 'enum':
      readDescriptorKey(reader); return readDescriptorKey(reader);
    case 'long':
      return reader.u32();
    case 'comp': {
      const high = reader.u32();
      const low = reader.u32();
      return high * 0x1_0000_0000 + low;
    }
    case 'bool':
      return reader.u8() !== 0;
    case 'type':
    case 'GlbC':
      readUnicode(reader); readDescriptorKey(reader); return null;
    case 'alis':
    case 'tdta': {
      const length = reader.u32();
      reader.skip(length);
      return null;
    }
    case 'obj ': {
      const count = reader.u32();
      if (count > MAX_DESCRIPTOR_ITEMS) throw new Error('ABR reference list is too large.');
      for (let index = 0; index < count; index += 1) readDescriptorReference(reader);
      return null;
    }
    default:
      throw new Error(`Unknown ABR descriptor type ${type}.`);
  }
}

function parseDescriptorBlock(reader: AbrReader): PsDescriptor {
  reader.skip(4);
  return readDescriptor(reader);
}

function brushFromComputed(input: {
  name: string;
  diameter: number;
  hardness: number;
  spacing: number;
  angle: number;
  roundness: number;
}): AbrBrushTip {
  const tip = computedTip(input.diameter, input.hardness, input.roundness, input.angle);
  return { ...input, width: tip.width, height: tip.height, coverage: tip.coverage, sampled: false };
}

function parseLegacy(reader: AbrReader, version: number, count: number, baseName: string, notes: string[]): AbrBrushTip[] {
  const brushes: AbrBrushTip[] = [];
  for (let index = 0; index < Math.min(count, MAX_BRUSHES) && reader.pos + 6 <= reader.bytes.length; index += 1) {
    const type = reader.u16();
    const size = reader.u32();
    const end = reader.pos + size;
    if (end > reader.bytes.length) {
      notes.push(`Brush ${index + 1}: record runs past the end of the file.`);
      break;
    }
    try {
      if (type === 1) {
        reader.skip(4);
        const spacing = clamp(reader.u16() / 100, 0, 10);
        const name = version === 2 ? readUnicode(reader) : '';
        reader.skip(1);
        const diameter = Math.max(1, reader.u16());
        const hardness = clamp(reader.u16() / 100, 0, 1);
        const angle = reader.i16();
        const roundness = clamp(reader.u16() / 100, 0.025, 1);
        brushes.push(brushFromComputed({
          name: name || `${baseName} ${brushes.length + 1}`,
          diameter,
          hardness,
          spacing,
          angle,
          roundness,
        }));
      } else if (type === 2) {
        reader.skip(4);
        const spacing = clamp(reader.u16() / 100, 0, 10);
        const name = version === 2 ? readUnicode(reader) : '';
        reader.skip(1);
        reader.skip(8);
        const top = reader.u32();
        const left = reader.u32();
        const bottom = reader.u32();
        const right = reader.u32();
        const depth = reader.u16();
        const width = right - left;
        const height = bottom - top;
        const tip = readTipRows(reader, width, height, depth, reader.u8() !== 0);
        brushes.push({
          name: name || `${baseName} ${brushes.length + 1}`,
          width: tip.width,
          height: tip.height,
          coverage: tip.coverage,
          diameter: Math.max(width, height),
          hardness: 0.5,
          spacing,
          angle: 0,
          roundness: 1,
          sampled: true,
        });
      } else {
        notes.push(`Brush ${index + 1}: unknown legacy type ${type} skipped.`);
      }
    } catch {
      notes.push(`Brush ${index + 1}: unreadable and skipped.`);
    }
    reader.seek(end);
  }
  if (count > MAX_BRUSHES) notes.push(`Only the first ${MAX_BRUSHES} brushes were imported.`);
  return brushes;
}

function parseSampleBlock(reader: AbrReader, end: number, subversion: number, notes: string[]): SampledTip[] {
  const tips: SampledTip[] = [];
  while (reader.pos + 4 <= end && tips.length < MAX_BRUSHES) {
    const size = reader.u32();
    const payloadEnd = reader.pos + size;
    const brushEnd = align4(payloadEnd);
    if (payloadEnd > end || brushEnd > reader.bytes.length) break;
    try {
      const idLength = reader.u8();
      const id = reader.ascii(idLength);
      reader.skip(subversion === 1 ? 10 : 264);
      const top = reader.u32();
      const left = reader.u32();
      const bottom = reader.u32();
      const right = reader.u32();
      const depth = reader.u16();
      const width = right - left;
      const height = bottom - top;
      const tip = readTipRows(reader, width, height, depth, reader.u8() !== 0);
      tips.push({ ...tip, id });
    } catch {
      notes.push(`Sampled tip ${tips.length + 1}: unreadable and skipped.`);
    }
    reader.seek(brushEnd);
  }
  return tips;
}

function numberOr(descriptor: PsDescriptor, key: string, fallback: number): number {
  return descriptor.number(key) ?? fallback;
}

function buildModernBrushes(tips: SampledTip[], descriptor: PsDescriptor | null, baseName: string, notes: string[]): AbrBrushTip[] {
  const brushes: AbrBrushTip[] = [];
  const used = new Set<number>();
  const brushList = descriptor?.get('Brsh');
  if (Array.isArray(brushList)) {
    for (const value of brushList.slice(0, MAX_BRUSHES)) {
      if (!(value instanceof PsDescriptor)) continue;
      const tipDescriptor = value.get('Brsh') instanceof PsDescriptor ? value.get('Brsh') as PsDescriptor : value;
      const name = value.string('Nm  ') || `${baseName} ${brushes.length + 1}`;
      const requestedId = tipDescriptor.string('sampledData')?.trim();
      let tipIndex = requestedId ? tips.findIndex((tip) => tip.id.trim() === requestedId) : -1;
      if (tipIndex < 0 && tips.length > brushes.length) tipIndex = brushes.length;
      const sampled = tipIndex >= 0 ? tips[tipIndex] : null;
      if (sampled) used.add(tipIndex);

      const diameter = Math.max(1, numberOr(tipDescriptor, 'Dmtr', sampled ? Math.max(sampled.width, sampled.height) : 32));
      const hardness = clamp(numberOr(tipDescriptor, 'Hrdn', 50) / 100, 0, 1);
      const spacing = clamp(numberOr(tipDescriptor, 'Spcn', 25) / 100, 0, 10);
      const angle = numberOr(tipDescriptor, 'Angl', 0);
      const roundness = clamp(numberOr(tipDescriptor, 'Rndn', 100) / 100, 0.025, 1);
      const rendered = sampled || computedTip(diameter, hardness, roundness, angle);
      brushes.push({
        name,
        width: rendered.width,
        height: rendered.height,
        coverage: rendered.coverage,
        diameter,
        hardness,
        spacing,
        angle,
        roundness,
        sampled: !!sampled,
        sourceId: sampled?.id,
      });
      if (value.has('useTipDynamics') || value.has('useScatter') || value.has('dualBrush') || value.has('useTexture')) {
        notes.push(`${name}: Photoshop scatter, texture, dual-brush, or curve dynamics were retained only as an import note.`);
      }
    }
  }

  tips.forEach((tip, index) => {
    if (used.has(index) || brushes.length >= MAX_BRUSHES) return;
    brushes.push({
      name: `${baseName} tip ${brushes.length + 1}`,
      width: tip.width,
      height: tip.height,
      coverage: tip.coverage,
      diameter: Math.max(tip.width, tip.height),
      hardness: 0.5,
      spacing: 0.25,
      angle: 0,
      roundness: 1,
      sampled: true,
      sourceId: tip.id,
    });
  });
  return brushes;
}

export function parseAbr(buffer: ArrayBuffer, baseName = 'Brush'): AbrImportResult {
  if (buffer.byteLength < 4) throw new Error('That file is too short to be an ABR pack.');
  const reader = new AbrReader(buffer);
  const version = reader.u16();
  const subversion = reader.u16();
  const notes: string[] = [];

  if (version === 1 || version === 2) {
    const brushes = parseLegacy(reader, version, subversion, baseName, notes);
    if (!brushes.length) throw new Error('No importable brush tips were found in that ABR file.');
    return { version, subversion, brushes, notes };
  }
  if (![6, 7, 10].includes(version)) throw new Error(`ABR version ${version} is not supported yet.`);
  if (subversion !== 1 && subversion !== 2) throw new Error(`ABR v${version} subversion ${subversion} is not supported yet.`);

  const tips: SampledTip[] = [];
  let descriptor: PsDescriptor | null = null;
  while (reader.pos + 12 <= reader.bytes.length) {
    if (reader.ascii(4) !== '8BIM') break;
    const key = reader.ascii(4);
    const length = reader.u32();
    const blockEnd = reader.pos + length;
    const next = align4(blockEnd);
    if (blockEnd > reader.bytes.length || next > reader.bytes.length) break;
    if (key === 'samp') {
      tips.push(...parseSampleBlock(reader, blockEnd, subversion, notes));
    } else if (key === 'desc') {
      try {
        descriptor = parseDescriptorBlock(reader);
      } catch {
        notes.push('The brush-parameter block was unreadable; extracted tips use safe defaults.');
      }
    }
    reader.seek(next);
  }

  const brushes = buildModernBrushes(tips, descriptor, baseName, notes);
  if (!brushes.length) throw new Error('No importable brush tips were found in that ABR file.');
  return { version, subversion, brushes, notes };
}
