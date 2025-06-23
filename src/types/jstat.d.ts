declare module 'jstat' {
  // Basic statistical functions
  export function quartiles(data: number[]): number[];
  export function median(data: number[]): number;
  
  // Statistical distributions
  export namespace studentt {
    function cdf(x: number, df: number): number;
    function inv(p: number, df: number): number;
  }
  
  export namespace centralF {
    function cdf(x: number, df1: number, df2: number): number;
  }
  
  export namespace chisquare {
    function cdf(x: number, df: number): number;
  }
  
  export namespace beta {
    function cdf(x: number, a: number, b: number): number;
  }
  
  // Alternative naming conventions
  export function incompletebeta(x: number, a: number, b: number): number;
  
  export default {
    quartiles: quartiles,
    median: median,
    studentt: studentt,
    centralF: centralF,
    chisquare: chisquare,
    beta: beta,
    incompletebeta: incompletebeta
  };
} 