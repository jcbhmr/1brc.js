import * as fs from 'node:fs';
const fileName = Bun.argv[2];

const stream = fs.createReadStream(fileName, {
  start: 66000, // does not emit any data nor exits nor throw error
  // if set to more than the size of buffer

  end: 12415863003,
});

let count = 0;

stream.on('data', (buff) => {
  if (++count > 1) {
    stream.destroy();
    return;
  }
  console.log(buff);
});
