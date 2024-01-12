//bun
import { isMainThread } from 'node:worker_threads';
if (isMainThread) {
  const [
    os,
    fsp,
    util,
    fs,
    workerThreads,
  ] = await Promise.all([
    import('node:os'),
    import('node:fs/promises'),
    import('node:util'),
    import('node:fs'),
    import('node:worker_threads'),
  ]);

  const fsRead: (
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ) => Promise<number> = util.promisify(fs.read);

  const fsClose: (fd: number) => Promise<void> = util.promisify(fs.close);

  type CalcResultsCont = Map<
    string,
    { min: number; max: number; sum: number; count: number }
  >;

  const MAX_LINE_LENGTH = 100 + 1 + 4 + 1;

  /** @type {(...args: any[]) => void} */
  const debug = process.env.DEBUG ? console.error : () => {};

  const fileName = process.argv[2];

  const fd = await fsp.open(fileName);
  const size = (await fsp.stat(fileName)).size;

  // const threadsCount = os.cpus().length;
  const threadsCount = 1;

  const chunkSize = Math.floor(size / threadsCount);

  let chunkOffsets: number[] = [];

  let offset = 0;
  const bufFindNl = Buffer.alloc(MAX_LINE_LENGTH);

  while (true) {
    offset += chunkSize;

    if (offset >= size) {
      chunkOffsets.push(size);
      break;
    }

    await fsRead(fd, bufFindNl, 0, MAX_LINE_LENGTH, offset);

    const nlPos = bufFindNl.indexOf(10);
    bufFindNl.fill(0);

    if (nlPos === -1) {
      chunkOffsets.push(size);
      break;
    } else {
      offset += nlPos + 1;
      chunkOffsets.push(offset);
    }
  }

  await fsClose(fd);

  const compiledResults: CalcResultsCont = new Map();

  let completedWorkers = 0;

  for (let i = 0; i < chunkOffsets.length; i++) {
    const worker = new Worker(new URL(import.meta.url));

    worker.postMessage({
      fileName,
      start: i === 0 ? 0 : chunkOffsets[i - 1],
      end: chunkOffsets[i],
    });

    worker.addEventListener('message', (event): void => {
      const message = event.data as CalcResultsCont;

      console.log(`Got map from worker: ${message.size}`);

      worker.unref();

      for (let [key, value] of message.entries()) {
        const existing = compiledResults.get(key);
        if (existing) {
          existing.min = Math.min(existing.min, value.min);
          existing.max = Math.max(existing.max, value.max);
          existing.sum += value.sum;
          existing.count += value.count;
        } else {
          compiledResults.set(key, value);
        }
      }

      completedWorkers++;
      if (completedWorkers === chunkOffsets.length) {
        printCompiledResults(compiledResults);
      }
    });

    worker.addEventListener('messageerror', (event) => {
      console.error(event);
    });

    worker.addEventListener('open', (event) => {
      debug('Worker started');
    });

    worker.addEventListener('error', (err) => {
      console.error(err);
    });

    worker.addEventListener('close', (event) => {
      debug('Worker stopped');
    });
  }

  /**
   * @param {CalcResultsCont} compiledResults
   */
  function printCompiledResults(compiledResults: CalcResultsCont) {
    const sortedStations = Array.from(compiledResults.keys()).sort();

    process.stdout.write('{');
    for (let i = 0; i < sortedStations.length; i++) {
      if (i > 0) {
        process.stdout.write(', ');
      }
      const data = compiledResults.get(sortedStations[i])!;
      process.stdout.write(sortedStations[i]);
      process.stdout.write('=');
      process.stdout.write(
        round(data.min / 10) +
          '/' +
          round(data.sum / 10 / data.count) +
          '/' +
          round(data.max / 10)
      );
    }
    process.stdout.write('}\n');
  }

  /**
   * @example
   * round(1.2345) // "1.2"
   * round(1.55) // "1.6"
   * round(1) // "1.0"
   *
   * @param {number} num
   * @returns {string}
   */
  function round(num: number) {
    const fixed = Math.round(10 * num) / 10;

    return fixed.toFixed(1);
  }
} else {
  const [
    os,
    fsp,
    util,
    fs,
    workerThreads,
  ] = await Promise.all([
    import('node:os'),
    import('node:fs/promises'),
    import('node:util'),
    import('node:fs'),
    import('node:worker_threads'),
  ]);

  const CHAR_SEMICOLON = ';'.charCodeAt(0);
  const CHAR_NEWLINE = '\n'.charCodeAt(0);
  const TOKEN_STATION_NAME = 0;
  const TOKEN_TEMPERATURE = 1;

  /** @type {(...args: any[]) => void} */
  const debug = process.env.DEBUG ? console.error : () => {};

  declare var self: Worker;

  type CalcResultsCont = Map<
    string,
    { min: number; max: number; sum: number; count: number }
  >;

  self.addEventListener('message', (event) => {
    worker(event.data.fileName, event.data.start, event.data.end);
  });

  function worker(fileName: string, start: number, end: number) {
    if (start > end - 1) {
      postMessage(new Map());
    } else {
      const readStream = fs.createReadStream(fileName, {
        start: start,
        end: end - 1,
      });

      parseStream(readStream);
    }
  }

  /**
   * @param {import('node:fs').ReadStream} readStream
   */
  function parseStream(readStream: fs.ReadStream) {
    let readingToken = TOKEN_STATION_NAME;

    let stationName = Buffer.allocUnsafe(100);
    let stationNameLen = 0;

    let temperature = Buffer.allocUnsafe(5);
    let temperatureLen = 0;

    let rowCount = 0;

    /**
     * @type {CalcResultsCont}
     */
    const map = new Map();

    /**
     * @param {Buffer} chunk
     * @returns {void}
     */
    function parseChunk(chunk: Buffer) {
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === CHAR_SEMICOLON) {
          readingToken = TOKEN_TEMPERATURE;
        } else if (chunk[i] === CHAR_NEWLINE) {
          const stationNameStr = stationName.toString('utf8', 0, stationNameLen);

          let temperatureFloat = 0 | 0;
          try {
            temperatureFloat = parseFloatBufferIntoInt(
              temperature,
              temperatureLen
            );
          } catch (err: any) {
            console.log({ temperature, temperatureLen }, err.message);
            throw err;
          }

          const existing = map.get(stationNameStr);

          if (existing) {
            existing.min =
              existing.min < temperatureFloat ? existing.min : temperatureFloat;
            existing.max =
              existing.max > temperatureFloat ? existing.max : temperatureFloat;
            existing.sum += temperatureFloat;
            existing.count++;
          } else {
            map.set(stationNameStr, {
              min: temperatureFloat,
              max: temperatureFloat,
              sum: temperatureFloat,
              count: 1,
            });
          }

          readingToken = TOKEN_STATION_NAME;
          stationNameLen = 0;
          temperatureLen = 0;
          rowCount++;
        } else if (readingToken === TOKEN_STATION_NAME) {
          stationName[stationNameLen] = chunk[i];
          stationNameLen++;
        } else {
          temperature[temperatureLen] = chunk[i];
          temperatureLen++;
        }
      }
    }

    readStream.on('data', (chunk: Buffer) => {
      parseChunk(chunk);
    });

    readStream.on('end', () => {
      debug('Sending result to the main thread');
      postMessage(map);
    });
  }

  const CHAR_MINUS = '-'.charCodeAt(0);

  /**
   * @param {Buffer} b
   * @param {number} length 1-5
   *
   * @returns {number}
   */
  function parseFloatBufferIntoInt(b: Buffer, length: number): number {
    if (b[0] === CHAR_MINUS) {
      // b can be -1.1 or -11.1
      switch (length) {
        case 4:
          return -(parseOneDigit(b[1]) * 10 + parseOneDigit(b[3]));
        case 5:
          return -(
            parseOneDigit(b[1]) * 100 +
            parseOneDigit(b[2]) * 10 +
            parseOneDigit(b[4])
          );
      }
    } else {
      // b can be 1.1 or 11.1
      switch (length) {
        case 3: // b is 1.1
          return parseOneDigit(b[0]) * 10 + parseOneDigit(b[2]);
        case 4:
          return (
            parseOneDigit(b[0]) * 100 +
            parseOneDigit(b[1]) * 10 +
            parseOneDigit(b[3])
          );
      }
    }

    throw new Error('Failed to parse float buffer into int');
  }

  /**
   * @param {number} char byte number of a digit char
   *
   * @returns {number}
   */
  function parseOneDigit(char: number) {
    return char - 0x30;
  }

}
