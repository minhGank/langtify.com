let queued: string | null = null;
let receiver: ((url: string) => void) | null = null;
export function queueOAuthReturn(url: string) {
  if (receiver) receiver(url);
  else queued = url;
}
export function listenOAuthReturns(listener: (url: string) => void) {
  receiver = listener;
  if (queued) {
    const url = queued;
    queued = null;
    listener(url);
  }
  return () => {
    if (receiver === listener) receiver = null;
  };
}
