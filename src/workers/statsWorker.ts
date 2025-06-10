/* eslint-disable no-restricted-globals */
// Worker for statistical calculations
export interface ColumnStats {
  mean: number;
  trimmedMean: number;
  skewness: number;
  kurtosis: number;
  meanDiffPercentage: number;
  count: number;
  values: number[];
  stdDev: number;
  sampleSize: number;
  proportion?: number;
  proportionStdError?: number;
}

export interface GroupStats {
  [key: string]: ColumnStats;
}

interface LeveneTestResult {
  W: number;
  pValue: number;
  equalVariance: boolean;
}

interface WorkerMessage {
  type: 'calculateStats' | 'calculateLeveneTest';
  data: {
    groupData?: { [key: string]: number[] };
    isProportionMetric?: boolean;
  };
}

// F-distribution probability calculation (more accurate approximation)
const calculateFProbability = (F: number, df1: number, df2: number): number => {
  if (F <= 0) return 0;
  if (df1 <= 0 || df2 <= 0) return 0;
  
  // For large degrees of freedom, use normal approximation
  if (df1 >= 30 && df2 >= 30) {
    const z = Math.sqrt(2 * F - 1) - Math.sqrt(2 * df1 - 1);
    return 0.5 * (1 + erf(z / Math.sqrt(2)));
  }
  
  // Use beta function approximation for smaller df
  const x = df1 * F / (df1 * F + df2);
  
  // Incomplete beta function approximation
  let result = 0;
  if (x < 0.5) {
    result = incompleteBeta(x, df1/2, df2/2);
  } else {
    result = 1 - incompleteBeta(1-x, df2/2, df1/2);
  }
  
  return Math.max(0, Math.min(1, result));
};

// Error function approximation
const erf = (x: number): number => {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;

  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
};

// Incomplete beta function approximation
const incompleteBeta = (x: number, a: number, b: number): number => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  
  // Use continued fraction approximation
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + 
                     a * Math.log(x) + b * Math.log(1 - x));
  
  if (x < (a + 1) / (a + b + 2)) {
    return bt * betaCF(x, a, b) / a;
  } else {
    return 1 - bt * betaCF(1 - x, b, a) / b;
  }
};

// Log gamma function approximation
const logGamma = (x: number): number => {
  const cof = [
    57.1562356658629235,    -59.5979603554754912,
    14.1360979747417471,    -0.491913816097620199,
    0.339946499848118887e-4, 0.465236289270485756e-4,
    -0.983744753048795646e-4, 0.158088703224912494e-3,
    -0.210264441724104883e-3, 0.217439618115212643e-3,
    -0.164318106536763890e-3, 0.844182239838527433e-4,
    -0.261908384015814087e-4, 0.368991826595316234e-5
  ];
  
  let y = x;
  let tmp = x + 5.24218750000000000;
  tmp = (x + 0.5) * Math.log(tmp) - tmp;
  let ser = 0.999999999999997092;
  for (let j = 0; j < 14; j++) {
    ser += cof[j] / ++y;
  }
  return tmp + Math.log(2.5066282746310005 * ser / x);
};

// Beta continued fraction
const betaCF = (x: number, a: number, b: number): number => {
  const maxIterations = 100;
  const eps = 3e-7;
  
  let am = 1;
  let bm = 1;
  let az = 1;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let bz = 1 - qab * x / qap;
  
  for (let m = 1; m <= maxIterations; m++) {
    let em = m;
    let tem = em + em;
    let d = em * (b - m) * x / ((qam + tem) * (a + tem));
    let ap = az + d * am;
    let bp = bz + d * bm;
    d = -(a + em) * (qab + em) * x / ((a + tem) * (qap + tem));
    let app = ap + d * az;
    let bpp = bp + d * bz;
    let aold = az;
    am = ap / bpp;
    bm = bp / bpp;
    az = app / bpp;
    bz = 1;
    
    if (Math.abs(az - aold) < eps * Math.abs(az)) {
      return az;
    }
  }
  
  return az;
};

// Calculate statistics for a numeric array
const calculateStats = (values: number[], isProportionMetric: boolean = false): ColumnStats => {
  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;
  
  // Calculate mean
  const mean = values.reduce((a, b) => a + b, 0) / n;
  
  // Calculate trimmed mean (5%)
  const trimStart = Math.floor(n * 0.05);
  const trimEnd = n - trimStart;
  const trimmedValues = sorted.slice(trimStart, trimEnd);
  const trimmedMean = trimmedValues.reduce((a, b) => a + b, 0) / trimmedValues.length;
  
  // Calculate skewness
  const m2 = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const m3 = values.reduce((a, b) => a + Math.pow(b - mean, 3), 0) / n;
  const skewness = m3 / Math.pow(m2, 1.5);
  
  // Calculate kurtosis
  const m4 = values.reduce((a, b) => a + Math.pow(b - mean, 4), 0) / n;
  const kurtosis = (m4 / Math.pow(m2, 2)) - 3;
  
  // Calculate mean difference percentage
  const meanDiffPercentage = Math.abs((mean - trimmedMean) / mean) * 100;

  const stats: ColumnStats = {
    mean,
    trimmedMean,
    skewness,
    kurtosis,
    meanDiffPercentage,
    count: n,
    values,
    stdDev: Math.sqrt(m2),
    sampleSize: n
  };

  if (isProportionMetric) {
    // For proportion metrics, calculate proportion and its standard error
    const successes = values.reduce((a, b) => a + b, 0);
    const proportion = successes / n;
    const proportionStdError = Math.sqrt((proportion * (1 - proportion)) / n);

    stats.proportion = proportion;
    stats.proportionStdError = proportionStdError;
  }

  return stats;
};

// Calculate Levene's test
const calculateLeveneTest = (groupStats: GroupStats): LeveneTestResult => {
  const groups = Object.values(groupStats);
  const k = groups.length; // number of groups
  const N = groups.reduce((sum, g) => sum + g.values.length, 0); // total sample size
  
  // Calculate group medians (using medians instead of means for Brown-Forsythe variant)
  const groupMedians = groups.map(group => {
    const sorted = [...group.values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  });
  
  // Calculate absolute deviations from group medians
  const deviations = groups.map((group, i) => 
    group.values.map(value => Math.abs(value - groupMedians[i]))
  );
  
  // Calculate mean of deviations for each group
  const deviationMeans = deviations.map(dev => 
    dev.reduce((a, b) => a + b, 0) / dev.length
  );
  
  // Calculate overall mean of deviations
  const overallMean = deviations.flat().reduce((a, b) => a + b, 0) / N;
  
  // Calculate between-groups sum of squares
  let SSb = 0;
  groups.forEach((group, i) => {
    SSb += group.values.length * Math.pow(deviationMeans[i] - overallMean, 2);
  });
  
  // Calculate within-groups sum of squares
  let SSw = 0;
  groups.forEach((group, i) => {
    const groupDev = deviations[i];
    groupDev.forEach(dev => {
      SSw += Math.pow(dev - deviationMeans[i], 2);
    });
  });
  
  // Calculate degrees of freedom
  const dfBetween = k - 1;
  const dfWithin = N - k;
  
  // Calculate mean squares
  const MSb = SSb / dfBetween;
  const MSw = SSw / dfWithin;
  
  // Calculate test statistic
  const W = MSb / MSw;
  
  // Calculate p-value using F-distribution
  const pValue = 1 - calculateFProbability(W, dfBetween, dfWithin);
  
  return {
    W,
    pValue,
    equalVariance: pValue > 0.05
  };
};

// Handle messages from the main thread
self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { type, data } = e.data;
  
  switch (type) {
    case 'calculateStats':
      if (data.groupData) {
        const groupStats: GroupStats = {};
        Object.entries(data.groupData).forEach(([group, values]) => {
          groupStats[group] = calculateStats(values, data.isProportionMetric);
        });
        self.postMessage({ type: 'statsResult', data: groupStats });
      }
      break;
      
    case 'calculateLeveneTest':
      if (data.groupData) {
        const groupStats: GroupStats = {};
        Object.entries(data.groupData).forEach(([group, values]) => {
          groupStats[group] = calculateStats(values);
        });
        const leveneResult = calculateLeveneTest(groupStats);
        self.postMessage({ type: 'leveneResult', data: leveneResult });
      }
      break;
  }
}; 