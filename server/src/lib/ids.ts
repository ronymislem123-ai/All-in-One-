import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
let lastTime = 0;
let lastRandom: number[] = [];

/** Time-sortable, collision-resistant ID (ULID layout) with a readable type prefix, e.g. `nd_01J…`. */
export function newId(prefix: string): string {
  let now = Date.now();
  let rand: number[];
  if (now <= lastTime) {
    // monotonic: increment previous random part within the same millisecond
    now = lastTime;
    rand = [...lastRandom];
    for (let i = rand.length - 1; i >= 0; i--) {
      if (rand[i] < 31) { rand[i]++; break; }
      rand[i] = 0;
    }
  } else {
    const bytes = randomBytes(16);
    rand = Array.from(bytes, (b) => b % 32);
  }
  lastTime = now;
  lastRandom = rand;
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return `${prefix}_${time}${rand.map((r) => ALPHABET[r]).join('')}`;
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/ß/g, 'ss')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'eintrag';
}
