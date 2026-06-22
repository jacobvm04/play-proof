// Silence ganache's harmless µWS-native-binary fallback warning on Node 22+
// (we use the in-process provider, so the websocket transport is irrelevant).
const origErr = process.stderr.write.bind(process.stderr);
(process.stderr as any).write = (chunk: any, ...rest: any[]) => {
  const s = typeof chunk === "string" ? chunk : chunk?.toString?.() ?? "";
  if (/µWS|uws_|Falling back to a NodeJS implementation|not compatible with your Node\.js/.test(s)) {
    return true;
  }
  return origErr(chunk, ...rest);
};
