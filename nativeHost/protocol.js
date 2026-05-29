export function encodeNativeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function createNativeMessageParser(onMessage) {
  let buffer = Buffer.alloc(0);

  return function parseNativeChunk(chunk) {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);

    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) return;

      const payload = buffer.subarray(4, 4 + length).toString('utf8');
      buffer = buffer.subarray(4 + length);
      onMessage(JSON.parse(payload));
    }
  };
}
