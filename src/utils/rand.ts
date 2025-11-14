export function shuffle<T>(arr: T[], seed?: number): T[] {
  const res = arr.slice();
  let s = seed ?? Date.now();
  const rng = () => {
    // prosty LCG (wystarczy do DEMO)
    s = (s * 48271) % 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = res.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [res[i], res[j]] = [res[j], res[i]];
  }
  return res;
}
