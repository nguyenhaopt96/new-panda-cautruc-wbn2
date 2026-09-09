import fs from 'fs';
import path from 'path';

export interface StoredZipEntry {
  sourcePath: string;
  name: string;
}

interface PreparedEntry extends StoredZipEntry {
  crc32: number;
  size: number;
  nameBuffer: Buffer;
  modifiedAt: Date;
  localHeaderOffset: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

async function inspectEntry(entry: StoredZipEntry): Promise<PreparedEntry> {
  const stat = await fs.promises.stat(entry.sourcePath);
  if (!stat.isFile()) throw new Error(`Không tìm thấy tệp để đóng ZIP: ${entry.name}`);
  if (stat.size > 0xffffffff) throw new Error(`Tệp quá lớn để đóng ZIP: ${entry.name}`);

  let crc = 0xffffffff;
  for await (const chunk of fs.createReadStream(entry.sourcePath)) {
    const bytes = chunk as Buffer;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return {
    ...entry,
    crc32: (crc ^ 0xffffffff) >>> 0,
    size: stat.size,
    nameBuffer: Buffer.from(entry.name, 'utf8'),
    modifiedAt: stat.mtime,
    localHeaderOffset: 0,
  };
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function localHeader(entry: PreparedEntry): Buffer {
  const header = Buffer.alloc(30);
  const dos = dosDateTime(entry.modifiedAt);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(dos.time, 10);
  header.writeUInt16LE(dos.date, 12);
  header.writeUInt32LE(entry.crc32, 14);
  header.writeUInt32LE(entry.size, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(entry.nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, entry.nameBuffer]);
}

function centralHeader(entry: PreparedEntry): Buffer {
  const header = Buffer.alloc(46);
  const dos = dosDateTime(entry.modifiedAt);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(dos.time, 12);
  header.writeUInt16LE(dos.date, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.localHeaderOffset, 42);
  return Buffer.concat([header, entry.nameBuffer]);
}

async function writeChunk(stream: fs.WriteStream, chunk: Buffer): Promise<void> {
  if (stream.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      stream.off('drain', handleDrain);
      stream.off('error', handleError);
    };
    const handleDrain = () => {
      cleanup();
      resolve();
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    stream.once('drain', handleDrain);
    stream.once('error', handleError);
  });
}

/**
 * Create a standards-compliant, UTF-8 ZIP using the STORE method. MP4 files
 * are already compressed, so avoiding another compression pass is both faster
 * and lighter on the render server.
 */
export async function createStoredZip(entries: StoredZipEntry[], destinationPath: string): Promise<void> {
  if (entries.length === 0) throw new Error('Không có video hoàn tất để đóng ZIP.');
  if (entries.length > 0xffff) throw new Error('Có quá nhiều tệp để đóng ZIP.');

  const prepared: PreparedEntry[] = [];
  for (const entry of entries) prepared.push(await inspectEntry(entry));

  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  const output = fs.createWriteStream(destinationPath, { flags: 'w' });
  let offset = 0;

  try {
    for (const entry of prepared) {
      entry.localHeaderOffset = offset;
      const header = localHeader(entry);
      await writeChunk(output, header);
      offset += header.length;

      for await (const chunk of fs.createReadStream(entry.sourcePath)) {
        const bytes = chunk as Buffer;
        await writeChunk(output, bytes);
        offset += bytes.length;
      }
    }

    const centralOffset = offset;
    for (const entry of prepared) {
      const header = centralHeader(entry);
      await writeChunk(output, header);
      offset += header.length;
    }
    const centralSize = offset - centralOffset;

    if (offset > 0xffffffff || centralOffset > 0xffffffff || centralSize > 0xffffffff) {
      throw new Error('Tổng dung lượng ZIP vượt giới hạn 4 GiB.');
    }

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(prepared.length, 8);
    end.writeUInt16LE(prepared.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralOffset, 16);
    end.writeUInt16LE(0, 20);
    await writeChunk(output, end);

    await new Promise<void>((resolve, reject) => {
      output.end(resolve);
      output.once('error', reject);
    });
  } catch (error) {
    output.destroy();
    try {
      await fs.promises.rm(destinationPath, { force: true });
    } catch {
      // Ignore cleanup errors; the original error is more useful.
    }
    throw error;
  }
}
