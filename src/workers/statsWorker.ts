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
  };
}

// Calculate statistics for a numeric array
const calculateStats = (values: number[]): ColumnStats => {
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
  
  return {
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
};

// Calculate Levene's test
const calculateLeveneTest = (groupStats: GroupStats): LeveneTestResult => {
  const groups = Object.values(groupStats);
  const groupMeans = groups.map(g => g.mean);
  const allValues = groups.flatMap(g => g.values);
  const overallMean = allValues.reduce((a, b) => a + b, 0) / allValues.length;
  
  // Calculate absolute deviations
  const deviations = groups.map(group => 
    group.values.map(value => Math.abs(value - group.mean))
  );
  
  // Calculate Z values (mean of deviations for each group)
  const zValues = deviations.map(dev => 
    dev.reduce((a, b) => a + b, 0) / dev.length
  );
  
  // Calculate W statistic
  let numerator = 0;
  let denominator = 0;
  
  groups.forEach((group, i) => {
    const n = group.values.length;
    numerator += n * Math.pow(zValues[i] - overallMean, 2);
    
    group.values.forEach(value => {
      denominator += Math.pow(Math.abs(value - groupMeans[i]) - zValues[i], 2);
    });
  });
  
  const W = (numerator / (groups.length - 1)) / (denominator / (allValues.length - groups.length));
  const pValue = 1 - W; // Simplified p-value calculation
  
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
          groupStats[group] = calculateStats(values);
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