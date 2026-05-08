const ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZabcdefghjkmnpqrstwxyz0123456789';

/** Generate a random ID of `size` characters (default 12). */
export function uid(size = 12): string {
  const arr = new Uint8Array(size);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => ALPHABET[b % ALPHABET.length]).join('');
}
