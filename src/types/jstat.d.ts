declare module 'jstat' {
  export function quartiles(data: number[]): number[];
  export function median(data: number[]): number;
  export default {
    quartiles: quartiles,
    median: median
  };
} 