import React, { useState, useEffect, SyntheticEvent, useMemo, useCallback, Suspense, lazy, useRef } from 'react';
import { 
  Box, 
  Button, 
  FormControl, 
  InputLabel, 
  MenuItem, 
  Select, 
  Table, 
  TableBody, 
  TableCell, 
  TableContainer, 
  TableHead, 
  TableRow, 
  Paper,
  Typography,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Grid,
  SelectChangeEvent,
  Skeleton,
  Theme,
  BoxProps
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { parse } from 'papaparse';
import debounce from 'lodash/debounce';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import * as jStat from 'jstat';

interface DataRow {
  [key: string]: string | number;
}

// Types
type StatsWorkerResponse = {
  type: 'statsResult';
  data: GroupStats;
} | {
  type: 'leveneResult';
  data: LeveneTestResult;
};

interface ColumnStats {
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

interface GroupStats {
  [key: string]: ColumnStats;
}

interface ReliabilityResult {
  isReliable: boolean;
  reasons: string[];
}

interface LeveneTestResult {
  W: number;
  pValue: number;
  equalVariance: boolean;
}

interface TestResult {
  testName: string;
  testStatistic: number;
  pValue: number;
  degreesOfFreedom?: number;
  confidenceInterval?: [number, number];
  effectSize?: number;
  isSignificant: boolean;
  interpretation: string;
  postHocRequired: boolean;
  postHocReason: string;
}

interface TestRecommendation {
  testName: string;
  requiresPostHoc: boolean;
  postHocMethod?: string;
  reasoning: string;
}

interface PostHocResult {
  groupA: string;
  groupB: string;
  testStatistic?: number;
  pValue: number;
  adjustedPValue: number;
  isSignificant: boolean;
}

interface TabPanelProps extends BoxProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

// Memoize the CustomTabPanel component
const CustomTabPanel = styled(Box)<{ theme?: Theme }>(({ theme }) => ({
  padding: theme?.spacing(3) || 24,
}));

const UploadArea = styled(Paper)(({ theme }) => ({
  border: '2px dashed #1976d2',
  borderRadius: theme.shape.borderRadius,
  padding: theme.spacing(3),
  textAlign: 'center',
  marginBottom: theme.spacing(2),
  cursor: 'pointer',
  transition: 'all 0.3s ease',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: theme.spacing(1.5),
  backgroundColor: '#ffffff',
  '&:hover': {
    borderColor: '#2196f3',
    backgroundColor: '#f5f9ff',
  },
}));

const VisuallyHiddenInput = styled('input')({
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  height: 1,
  overflow: 'hidden',
  position: 'absolute',
  bottom: 0,
  left: 0,
  whiteSpace: 'nowrap',
  width: 1,
});

// Lazy load the HistogramPlot component
const HistogramPlotLazy = lazy(() => import('./HistogramPlot'));

// Create worker instance
const statsWorker = new Worker(new URL('../workers/statsWorker.ts', import.meta.url), {
  type: 'module',
});

// Loading skeleton for table
const TableLoadingSkeleton = () => (
  <TableContainer component={Paper} sx={{ mb: 3 }}>
    <Table>
      <TableHead>
        <TableRow sx={{ backgroundColor: '#f8f9fa' }}>
          <TableCell>Group</TableCell>
          <TableCell>Count</TableCell>
          <TableCell>Mean</TableCell>
          <TableCell>5% Trimmed Mean</TableCell>
          <TableCell>Skewness</TableCell>
          <TableCell>Kurtosis</TableCell>
          <TableCell>Mean Diff %</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {[1, 2].map((i) => (
          <TableRow key={i}>
            {[1, 2, 3, 4, 5, 6, 7].map((j) => (
              <TableCell key={j}>
                <Skeleton animation="wave" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </TableContainer>
);

// Loading skeleton for reliability check
const ReliabilityCheckSkeleton = () => (
  <Paper sx={{ p: 2, mb: 2, bgcolor: '#f8f9fa' }}>
    <Skeleton animation="wave" height={32} width="60%" sx={{ mb: 2 }} />
    <Skeleton animation="wave" height={24} width="40%" />
    <Skeleton animation="wave" height={24} width="45%" />
    <Skeleton animation="wave" height={24} width="35%" />
    <Skeleton animation="wave" height={24} width="42%" />
    <Box sx={{ mt: 2 }}>
      <Skeleton animation="wave" height={56} />
    </Box>
    <Box sx={{ mt: 2 }}>
      <Skeleton animation="wave" height={56} />
    </Box>
  </Paper>
);

// Utility functions
const checkMeanReliability = (stats: ColumnStats): ReliabilityResult => {
  const reasons: string[] = [];
  
  if (Math.abs(stats.skewness) > 2) {
    reasons.push('High skewness indicates non-normal distribution');
  }
  
  if (Math.abs(stats.kurtosis) > 7) {
    reasons.push('High kurtosis indicates heavy tails');
  }
  
  if (stats.meanDiffPercentage > 10) {
    reasons.push('Large difference between mean and trimmed mean indicates outliers');
  }
  
  return {
    isReliable: reasons.length === 0,
    reasons
  };
};

// Components
const TabPanel = React.forwardRef<HTMLDivElement, TabPanelProps>(
  ({ children, value, index, ...other }, ref) => {
    return (
      <Box
        ref={ref}
        role="tabpanel"
        hidden={value !== index}
        id={`statistical-tabpanel-${index}`}
        aria-labelledby={`statistical-tab-${index}`}
        {...other}
      >
        {value === index && (
          <Box sx={{ py: 3 }}>
            {children}
          </Box>
        )}
      </Box>
    );
  }
);

TabPanel.displayName = 'TabPanel';

// ReliabilityCheck component
interface ReliabilityCheckProps {
  group: string;
  stats: ColumnStats;
  leveneTest: LeveneTestResult | null;
  testName?: string; // Add test name to determine if variance check is needed
}

const ReliabilityCheck: React.FC<ReliabilityCheckProps> = ({ group, stats, leveneTest, testName }) => {
  const reliability = checkMeanReliability(stats);
  const isNonParametricTest = testName === "Mann-Whitney U Test" || testName === "Kruskal-Wallis Test";
  
  return (
    <Paper sx={{ p: 2, mb: 2, bgcolor: '#f8f9fa' }}>
      <Typography variant="h6" sx={{ mb: 2, color: '#1976d2' }}>
        🚦 Mean Reliability Check: {group}
        {isNonParametricTest && (
          <Typography variant="body2" sx={{ color: '#666', fontWeight: 'normal', mt: 0.5 }}>
            (For {testName} - checking why non-parametric test was selected)
          </Typography>
        )}
      </Typography>
      
      <Box sx={{ mb: 2 }}>
        <Typography>
          <strong>Skewness:</strong> {stats.skewness.toFixed(2)}
          <br />
          <strong>Kurtosis:</strong> {stats.kurtosis.toFixed(2)}
          <br />
          <strong>% Trimmed Mean Difference:</strong> {stats.meanDiffPercentage.toFixed(1)}%
          {!isNonParametricTest && (
            <>
              <br />
              <strong>Levene's p-value:</strong> {leveneTest?.pValue.toFixed(4)}
            </>
          )}
        </Typography>
      </Box>

      <Alert 
        severity={reliability.isReliable ? "success" : "warning"}
        sx={{ mb: 2 }}
      >
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          ✅ Mean Reliability: The mean is {reliability.isReliable ? 'reliable' : 'not reliable'}
        </Typography>
        {!reliability.isReliable && (
          <Typography variant="body2" sx={{ mt: 1 }}>
            Reasons why mean is not reliable:
            <ul>
              {reliability.reasons.map((reason: string, index: number) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
          </Typography>
        )}
        {isNonParametricTest && !reliability.isReliable && (
          <Typography variant="body2" sx={{ mt: 2, fontStyle: 'italic', color: '#1976d2' }}>
            💡 <strong>Test Selection Rationale:</strong> Since the mean is not reliable due to the above issues, 
            a non-parametric test ({testName}) was selected to compare medians instead of means.
          </Typography>
        )}
        {isNonParametricTest && reliability.isReliable && (
          <Typography variant="body2" sx={{ mt: 2, fontStyle: 'italic', color: '#2e7d32' }}>
            ℹ️ <strong>Note:</strong> Although the mean is reliable, a non-parametric test ({testName}) was selected 
            based on other distributional considerations or user preference for robust median-based analysis.
          </Typography>
        )}
      </Alert>

      {!isNonParametricTest && (
        <Alert 
          severity={leveneTest?.equalVariance ? "success" : "warning"}
        >
          <Typography variant="body1">
            <strong>Variance Test Result (Levene's p-value = {leveneTest?.pValue.toFixed(4)}):</strong> {leveneTest?.equalVariance ? 
              "Variances are equal" : 
              "Variances are unequal"}
          </Typography>
        </Alert>
      )}
      
      {isNonParametricTest && (
        <Alert severity="info">
          <Typography variant="body1">
            <strong>Variance Check:</strong> Not applicable for non-parametric tests.
          </Typography>
        </Alert>
      )}
    </Paper>
  );
};

const StatisticalAnalysis: React.FC = () => {
  // State for file and data
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<DataRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showTabs, setShowTabs] = useState(false);
  const [fileName, setFileName] = useState<string>('');
  
  // State for selected columns
  const [metricColumn, setMetricColumn] = useState<string>('');
  const [groupingColumn, setGroupingColumn] = useState<string>('');
  const [isMetricContinuous, setIsMetricContinuous] = useState<boolean>(true);
  
  // State for statistics
  const [groupStats, setGroupStats] = useState<GroupStats>({});
  const [tabValue, setTabValue] = useState(0);
  const [isCalculating, setIsCalculating] = useState(false);
  const [leveneTest, setLeveneTest] = useState<LeveneTestResult | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [inputsChanged, setInputsChanged] = useState(false); // Track if inputs have changed since last test
  const [postHocResults, setPostHocResults] = useState<PostHocResult[] | null>(null);
  const [isRunningPostHoc, setIsRunningPostHoc] = useState(false);
  const workerTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Reset execution results when inputs change
  const resetExecutionResults = useCallback(() => {
    setTestResult(null);
    setPostHocResults(null);
    setInputsChanged(true);
  }, []);

  // Mark that test has been executed with current inputs
  const markTestExecuted = useCallback(() => {
    setInputsChanged(false);
  }, []);

  // F-distribution probability calculation (approximation)
  const calculateFProbability = useCallback((F: number, df1: number, df2: number): number => {
    // This is a simplified approximation of the F-distribution CDF
    // For more accurate results, you might want to use a statistical library
    const x = df2 / (df2 + df1 * F);
    return 1 - Math.pow(x, df2 / 2);
  }, []);

  // Memoize expensive calculations
  const calculateStats = useCallback((values: number[]): ColumnStats => {
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
  }, []);

  // Memoize Levene's test calculation
  const calculateLeveneTest = useCallback((groups: GroupStats): LeveneTestResult => {
    // Get all group values
    const groupValues = Object.values(groups).map(g => g.values);
    
    // Calculate group medians
    const groupMedians = groupValues.map(values => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    });
    
    // Calculate absolute deviations from group medians
    const deviations = groupValues.map((values, i) => 
      values.map(v => Math.abs(v - groupMedians[i]))
    );
    
    // Calculate mean of deviations for each group
    const deviationMeans = deviations.map(d => 
      d.reduce((a, b) => a + b, 0) / d.length
    );
    
    // Calculate overall mean of deviations
    const overallMean = deviations.flat().reduce((a, b) => a + b, 0) / deviations.flat().length;
    
    // Calculate numerator (between groups sum of squares)
    const numerator = deviations.reduce((sum, groupDev, i) => 
      sum + groupDev.length * Math.pow(deviationMeans[i] - overallMean, 2), 0
    );
    
    // Calculate denominator (within groups sum of squares)
    const denominator = deviations.reduce((sum, groupDev, i) => 
      sum + groupDev.reduce((s, d) => s + Math.pow(d - deviationMeans[i], 2), 0), 0
    );
    
    // Calculate test statistic
    const k = groupValues.length; // number of groups
    const N = deviations.flat().length; // total sample size
    const dfBetween = k - 1;
    const dfWithin = N - k;
    
    const testStatistic = (dfWithin * numerator) / (dfBetween * denominator);
    
    // Calculate p-value using F-distribution approximation
    const pValue = 1 - calculateFProbability(testStatistic, dfBetween, dfWithin);
    
    return {
      W: testStatistic,  // Add the W statistic
      pValue,
      equalVariance: pValue >= 0.05
    };
  }, [calculateFProbability]);

  // Memoize test recommendation
  const testRecommendation = useMemo(() => {
    if (!metricColumn || !groupingColumn || Object.keys(groupStats).length === 0) {
      return null;
    }

    const numGroups = Object.keys(groupStats).length;
    
    // For proportion metrics
    if (!isMetricContinuous) {
      if (numGroups === 2) {
        return {
          testName: "Two-Proportion Z-Test",
          requiresPostHoc: false,
          reasoning: `• Metric Type: Proportion\n• Number of Groups: 2\n• Appropriate Test: Two-Proportion Z-Test is used for comparing proportions between two independent groups\n• Post-hoc Analysis: Not required for two groups`
        };
      } else {
        return {
          testName: "Chi-Square Test for Independence",
          requiresPostHoc: true,
          postHocMethod: "Pairwise Two-Proportion Z-Tests with Bonferroni correction",
          reasoning: `• Metric Type: Proportion\n• Number of Groups: ${numGroups}\n• Appropriate Test: Chi-Square Test for Independence is used for comparing proportions across multiple groups\n• Post-hoc Analysis: Required if test is significant\n• Post-hoc Method: Pairwise Two-Proportion Z-Tests with Bonferroni correction`
        };
      }
    }

    // For continuous metrics
    // Check if any group has unreliable mean
    let hasUnreliableMean = false;
    let unreliableReasons: string[] = [];
    
    Object.entries(groupStats).forEach(([group, stats]) => {
      const reliability = checkMeanReliability(stats);
      if (!reliability.isReliable) {
        hasUnreliableMean = true;
        unreliableReasons.push(`Group "${group}": ${reliability.reasons.join(", ")}`);
      }
    });

    // Get Levene's test result
    const leveneTest = calculateLeveneTest(groupStats);
    const levenesPValue = leveneTest.pValue;

    if (!hasUnreliableMean) {
      // Mean-based testing
      if (numGroups === 2) {
        if (levenesPValue >= 0.05) {
          return {
            testName: "Two-Sample t-Test",
            requiresPostHoc: false,
            reasoning: `• Metric Type: Continuous\n• Mean Reliability: Good (skewness, kurtosis, and trimmed mean difference within thresholds)\n• Number of Groups: 2\n• Variance Test: Equal variances (Levene's p = ${levenesPValue.toFixed(3)} ≥ 0.05)\n• Appropriate Test: Two-Sample t-Test\n• Post-hoc Analysis: Not required for two groups`
          };
        } else {
          return {
            testName: "Welch's t-Test",
            requiresPostHoc: false,
            reasoning: `• Metric Type: Continuous\n• Mean Reliability: Good\n• Number of Groups: 2\n• Variance Test: Unequal variances (Levene's p = ${levenesPValue.toFixed(3)} < 0.05)\n• Appropriate Test: Welch's t-Test (doesn't assume equal variances)\n• Post-hoc Analysis: Not required for two groups`
          };
        }
      } else {
        if (levenesPValue >= 0.05) {
          return {
            testName: "One-way ANOVA",
            requiresPostHoc: true,
            postHocMethod: "Tukey's Honest Significant Difference (HSD)",
            reasoning: `• Metric Type: Continuous\n• Mean Reliability: Good\n• Number of Groups: ${numGroups}\n• Variance Test: Equal variances (Levene's p = ${levenesPValue.toFixed(3)} ≥ 0.05)\n• Appropriate Test: One-way ANOVA\n• Post-hoc Method: Tukey's HSD (if ANOVA is significant)`
          };
        } else {
          return {
            testName: "Welch's ANOVA",
            requiresPostHoc: true,
            postHocMethod: "Games-Howell test",
            reasoning: `• Metric Type: Continuous\n• Mean Reliability: Good\n• Number of Groups: ${numGroups}\n• Variance Test: Unequal variances (Levene's p = ${levenesPValue.toFixed(3)} < 0.05)\n• Appropriate Test: Welch's ANOVA\n• Post-hoc Method: Games-Howell test (if ANOVA is significant)`
          };
        }
      }
    } else {
      // Median-based testing (fallback plan)
      if (numGroups === 2) {
        return {
          testName: "Mann-Whitney U Test",
          requiresPostHoc: false,
          reasoning: `• Metric Type: Continuous\n• Mean Reliability: Poor\n• Reliability Issues:\n  ${unreliableReasons.map(reason => '  ' + reason).join('\n')}\n• Number of Groups: 2\n• Appropriate Test: Mann-Whitney U Test (non-parametric, compares medians)\n• Variance Assumptions: Not required (non-parametric test)\n• Post-hoc Analysis: Not required for two groups`
        };
      } else {
        return {
          testName: "Kruskal-Wallis Test",
          requiresPostHoc: true,
          postHocMethod: "Dunn's Test with Bonferroni correction",
          reasoning: `• Metric Type: Continuous\n• Mean Reliability: Poor\n• Reliability Issues:\n  ${unreliableReasons.map(reason => '  ' + reason).join('\n')}\n• Number of Groups: ${numGroups}\n• Appropriate Test: Kruskal-Wallis Test (non-parametric)\n• Variance Assumptions: Not required (non-parametric test)\n• Post-hoc Method: Dunn's Test with Bonferroni correction (if Kruskal-Wallis is significant)`
        };
      }
    }
  }, [metricColumn, groupingColumn, groupStats, isMetricContinuous, calculateLeveneTest, checkMeanReliability]);

  // Detect if a column is continuous or proportion
  const detectColumnType = useCallback((column: string) => {
    if (!data.length || !column) return;

    const values = data
      .map(row => parseFloat(row[column] as string))
      .filter(val => !isNaN(val));

    if (values.length === 0) return;

    // Check if all values are between 0 and 1 or all values are 0/1
    const isProportionType = values.every(val => (val >= 0 && val <= 1)) &&
                            values.some(val => val > 0) &&
                            values.every(val => val === Math.round(val) || val === 0 || val === 1);

    setIsMetricContinuous(!isProportionType);
  }, [data]);

  // Debounced state updates
  const debouncedSetMetricColumn = useMemo(
    () => debounce((value: string) => {
      setMetricColumn(value);
      detectColumnType(value);
    }, 300),
    [detectColumnType]
  );

  const debouncedSetGroupingColumn = useMemo(
    () => debounce((value: string) => setGroupingColumn(value), 300),
    []
  );

  // Handle metric column change
  const handleMetricChange = (event: SelectChangeEvent<string>) => {
    const column = event.target.value;
    setMetricColumn(column);
    detectColumnType(column);
    resetExecutionResults(); // Reset execution results when metric changes
  };

  // Handle grouping column change
  const handleGroupingChange = (event: SelectChangeEvent<string>) => {
    setGroupingColumn(event.target.value);
    resetExecutionResults(); // Reset execution results when grouping changes
  };

  // Cleanup debounced functions
  useEffect(() => {
    return () => {
      debouncedSetMetricColumn.cancel();
      debouncedSetGroupingColumn.cancel();
    };
  }, [debouncedSetMetricColumn, debouncedSetGroupingColumn]);

  // Handle file upload with optimization
  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setFile(file);
      setFileName(file.name);
    }
  }, []);

  // Handle analyze with optimization
  const handleAnalyze = useCallback(() => {
    if (!file) return;
    
    setIsProcessing(true);
    
    parse(file, {
      header: true,
      complete: (results) => {
        setData(results.data as DataRow[]);
        if (results.data.length > 0) {
          setColumns(Object.keys(results.data[0] as object));
        }
        setIsProcessing(false);
        setShowTabs(true);
      },
      error: (error) => {
        console.error('Error parsing CSV:', error);
        setIsProcessing(false);
      }
    });
  }, [file]);

  // Handle tab change with optimization
  const handleTabChange = useCallback((event: SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  }, []);

  // Setup worker message handler
  useEffect(() => {
    const handleWorkerMessage = (e: MessageEvent<StatsWorkerResponse>) => {
      if (e.data.type === 'statsResult') {
        setGroupStats(e.data.data);
        setIsCalculating(false);
      } else if (e.data.type === 'leveneResult') {
        setLeveneTest(e.data.data);
      }
    };

    statsWorker.addEventListener('message', handleWorkerMessage);
    return () => {
      statsWorker.removeEventListener('message', handleWorkerMessage);
      if (workerTimeoutRef.current) {
        clearTimeout(workerTimeoutRef.current);
      }
    };
  }, []);

  // Calculate group statistics using worker
  const calculateGroupStats = useCallback((data: any) => {
    setIsCalculating(true);
    
    // Clear previous timeout if exists
    if (workerTimeoutRef.current) {
      clearTimeout(workerTimeoutRef.current);
    }
    
    // Set a timeout to prevent UI freeze if worker takes too long
    workerTimeoutRef.current = setTimeout(() => {
      const groupData: { [key: string]: number[] } = {};
      
      data.forEach((row: any) => {
        const group = row[groupingColumn];
        const value = parseFloat(row[metricColumn]);
        
        if (!isNaN(value)) {
          if (!groupData[group]) {
            groupData[group] = [];
          }
          groupData[group].push(value);
        }
      });
      
      statsWorker.postMessage({
        type: 'calculateStats',
        data: { 
          groupData,
          isProportionMetric: !isMetricContinuous 
        }
      });
      
      if (isMetricContinuous) {
        statsWorker.postMessage({
          type: 'calculateLeveneTest',
          data: { groupData }
        });
      }
    }, 0);
  }, [groupingColumn, metricColumn, isMetricContinuous]);

  // Update statistics when metric or grouping columns change
  useEffect(() => {
    if (metricColumn && groupingColumn && data.length > 0) {
      calculateGroupStats(data);
    }
  }, [metricColumn, groupingColumn, data, calculateGroupStats]);

  // Statistical test implementations
  const runTwoProportionZTest = useCallback((group1Data: number[], group2Data: number[]): TestResult => {
    const n1 = group1Data.length;
    const n2 = group2Data.length;
    const x1 = group1Data.reduce((a, b) => a + b, 0); // successes in group 1
    const x2 = group2Data.reduce((a, b) => a + b, 0); // successes in group 2
    
    const p1 = x1 / n1;
    const p2 = x2 / n2;
    const pooledP = (x1 + x2) / (n1 + n2);
    
    const se = Math.sqrt(pooledP * (1 - pooledP) * (1/n1 + 1/n2));
    const z = (p1 - p2) / se;
    const pValue = 2 * (1 - normalCDF(Math.abs(z)));
    
    const isSignificant = pValue < 0.05;
    
    return {
      testName: "Two-Proportion Z-Test",
      testStatistic: z,
      pValue,
      isSignificant,
      interpretation: `Since the selected test is Two-Proportion Z-Test and the p-value is ${pValue.toFixed(4)}, we ${isSignificant ? 'reject' : 'fail to reject'} the null hypothesis. This suggests that the difference in ${metricColumn} across ${groupingColumn} is ${isSignificant ? 'statistically significant' : 'not significant'}.`,
      postHocRequired: false,
      postHocReason: "No post-hoc analysis is required for the selected test. This is because the number of groups being compared is only 2 (so no pairwise comparisons beyond the main test are needed)."
    };
  }, [metricColumn, groupingColumn]);

  const runTwoSampleTTest = useCallback((group1Data: number[], group2Data: number[], equalVar: boolean = true): TestResult => {
    console.log('=== T-TEST CALCULATION DEBUG ===');
    console.log(`Test type: ${equalVar ? 'Pooled variance' : 'Welch\'s'}`);
    console.log(`Group 1 data (first 10): [${group1Data.slice(0, 10).join(', ')}]`);
    console.log(`Group 2 data (first 10): [${group2Data.slice(0, 10).join(', ')}]`);
    
    const n1 = group1Data.length;
    const n2 = group2Data.length;
    const mean1 = group1Data.reduce((a, b) => a + b, 0) / n1;
    const mean2 = group2Data.reduce((a, b) => a + b, 0) / n2;
    
    console.log(`Sample sizes: n1=${n1}, n2=${n2}`);
    console.log(`Means: mean1=${mean1.toFixed(6)}, mean2=${mean2.toFixed(6)}`);
    
    const var1 = group1Data.reduce((a, b) => a + Math.pow(b - mean1, 2), 0) / (n1 - 1);
    const var2 = group2Data.reduce((a, b) => a + Math.pow(b - mean2, 2), 0) / (n2 - 1);
    
    console.log(`Variances: var1=${var1.toFixed(6)}, var2=${var2.toFixed(6)}`);
    console.log(`Standard deviations: sd1=${Math.sqrt(var1).toFixed(6)}, sd2=${Math.sqrt(var2).toFixed(6)}`);
    
    let t: number, df: number, se: number;
    
    if (equalVar) {
      // Pooled variance t-test
      const pooledVar = ((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2);
      se = Math.sqrt(pooledVar * (1/n1 + 1/n2));
      t = (mean1 - mean2) / se;
      df = n1 + n2 - 2;
      console.log(`Pooled variance: ${pooledVar.toFixed(6)}`);
    } else {
      // Welch's t-test
      se = Math.sqrt(var1/n1 + var2/n2);
      t = (mean1 - mean2) / se;
      df = Math.pow(var1/n1 + var2/n2, 2) / (Math.pow(var1/n1, 2)/(n1-1) + Math.pow(var2/n2, 2)/(n2-1));
      console.log(`Welch's degrees of freedom: ${df.toFixed(6)}`);
    }
    
    console.log(`Standard error: ${se.toFixed(6)}`);
    console.log(`Mean difference: ${(mean1 - mean2).toFixed(6)}`);
    console.log(`t-statistic: ${t.toFixed(6)}`);
    console.log(`Degrees of freedom: ${df.toFixed(6)}`);
    
    const pValue = 2 * (1 - tCDF(Math.abs(t), df));
    console.log(`p-value: ${pValue.toFixed(8)}`);
    console.log('=== END T-TEST CALCULATION DEBUG ===');
    const isSignificant = pValue < 0.05;
    
    // Calculate 95% confidence interval for mean difference
    const tCrit = tInverse(0.025, df);
    const meanDiff = mean1 - mean2;
    const ciLower = meanDiff - tCrit * se;
    const ciUpper = meanDiff + tCrit * se;
    
    return {
      testName: equalVar ? "Two-Sample t-Test" : "Welch's t-Test",
      testStatistic: t,
      pValue,
      degreesOfFreedom: Math.round(df),
      confidenceInterval: [ciLower, ciUpper],
      isSignificant,
      interpretation: `Since the selected test is ${equalVar ? "Two-Sample t-Test" : "Welch's t-Test"} and the p-value is ${pValue.toFixed(4)}, we ${isSignificant ? 'reject' : 'fail to reject'} the null hypothesis. This suggests that the difference in ${metricColumn} across ${groupingColumn} is ${isSignificant ? 'statistically significant' : 'not significant'}.`,
      postHocRequired: false,
      postHocReason: "No post-hoc analysis is required for the selected test. This is because the number of groups being compared is only 2 (so no pairwise comparisons beyond the main test are needed)."
    };
  }, [metricColumn, groupingColumn]);

  const runOneWayANOVA = useCallback((groupData: { [key: string]: number[] }): TestResult => {
    const totalSamples = Object.values(groupData).reduce((sum, group) => sum + group.length, 0);
    const enableDetailedLogging = totalSamples < 10000;
    
    if (enableDetailedLogging) {
      console.log('=== ONE-WAY ANOVA CALCULATION DEBUG ===');
    } else {
      console.log(`=== ONE-WAY ANOVA (${totalSamples.toLocaleString()} samples) ===`);
    }
    const groups = Object.values(groupData);
    const groupNames = Object.keys(groupData);
    const k = groups.length;
    const N = groups.reduce((sum, group) => sum + group.length, 0);
    
    console.log(`Number of groups (k): ${k}`);
    console.log(`Total sample size (N): ${N.toLocaleString()}`);
    console.log('Group names:', groupNames);
    
    // Log group sizes and first few values (conditional)
    groups.forEach((group, i) => {
      if (enableDetailedLogging) {
        console.log(`Group ${i+1} (${groupNames[i]}): n=${group.length}, first 5 values=[${group.slice(0, 5).join(', ')}]`);
      } else {
        console.log(`Group ${i+1} (${groupNames[i]}): n=${group.length.toLocaleString()}`);
      }
    });
    
    // Calculate group means and overall mean
    const groupMeans = groups.map(group => group.reduce((a, b) => a + b, 0) / group.length);
    const overallMean = groups.flat().reduce((a, b) => a + b, 0) / N;
    
    console.log('Group means:', groupMeans.map((mean, i) => `${groupNames[i]}: ${mean.toFixed(6)}`));
    console.log(`Overall mean: ${overallMean.toFixed(6)}`);
    
    // Calculate sum of squares
    let SSB = 0; // Between groups
    let SSW = 0; // Within groups
    
    groups.forEach((group, i) => {
      const n = group.length;
      const groupMean = groupMeans[i];
      const betweenComponent = n * Math.pow(groupMean - overallMean, 2);
      SSB += betweenComponent;
      
      console.log(`Group ${i+1} between component: ${n} × (${groupMean.toFixed(6)} - ${overallMean.toFixed(6)})² = ${betweenComponent.toFixed(6)}`);
      
      let groupSSW = 0;
      group.forEach(value => {
        groupSSW += Math.pow(value - groupMean, 2);
      });
      SSW += groupSSW;
      console.log(`Group ${i+1} within SS: ${groupSSW.toFixed(6)}`);
    });
    
    console.log(`Sum of Squares Between (SSB): ${SSB.toFixed(6)}`);
    console.log(`Sum of Squares Within (SSW): ${SSW.toFixed(6)}`);
    console.log(`Total Sum of Squares: ${(SSB + SSW).toFixed(6)}`);
    
    const dfB = k - 1;
    const dfW = N - k;
    const MSB = SSB / dfB;
    const MSW = SSW / dfW;
    const F = MSB / MSW;
    
    console.log(`Degrees of freedom between: ${dfB}`);
    console.log(`Degrees of freedom within: ${dfW}`);
    console.log(`Mean Square Between (MSB): ${MSB.toFixed(6)}`);
    console.log(`Mean Square Within (MSW): ${MSW.toFixed(6)}`);
    console.log(`F-statistic: ${F.toFixed(6)}`);
    
    const pValue = 1 - fCDF(F, dfB, dfW);
    console.log(`p-value: ${pValue.toFixed(8)}`);
    console.log('=== END ONE-WAY ANOVA DEBUG ===');
    const isSignificant = pValue < 0.05;
    
    return {
      testName: "One-way ANOVA",
      testStatistic: F,
      pValue,
      degreesOfFreedom: dfB,
      isSignificant,
      interpretation: `Since the selected test is One-way ANOVA and the p-value is ${pValue.toFixed(4)}, we ${isSignificant ? 'reject' : 'fail to reject'} the null hypothesis. This suggests that the difference in ${metricColumn} across ${groupingColumn} is ${isSignificant ? 'statistically significant' : 'not significant'}.`,
      postHocRequired: isSignificant && k > 2,
      postHocReason: isSignificant && k > 2 
        ? "Post-hoc analysis is required. Please proceed to the Post-Hoc Analysis tab to explore pairwise group differences."
        : !isSignificant 
          ? "No post-hoc analysis is required for the selected test. This is because the test result was not statistically significant, so further breakdown is unnecessary."
          : "🧾 Post-Hoc Analysis Not Required"
    };
  }, [metricColumn, groupingColumn]);

  const runWelchsANOVA = useCallback((groupData: { [key: string]: number[] }): TestResult => {
    const totalSamples = Object.values(groupData).reduce((sum, group) => sum + group.length, 0);
    const enableDetailedLogging = totalSamples < 10000;
    
    if (enableDetailedLogging) {
      console.log('=== WELCH\'S ANOVA CALCULATION DEBUG ===');
    } else {
      console.log(`=== WELCH\'S ANOVA (${totalSamples.toLocaleString()} samples) ===`);
    }
    const groups = Object.values(groupData);
    const groupNames = Object.keys(groupData);
    const k = groups.length;
    
    console.log(`Number of groups (k): ${k}`);
    console.log('Group names:', groupNames);
    
    // Calculate group statistics
    const groupStats = groups.map((group, i) => {
      const n = group.length;
      const mean = group.reduce((a, b) => a + b, 0) / n;
      const variance = group.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (n - 1);
      console.log(`Group ${i+1} (${groupNames[i]}): n=${n}, mean=${mean.toFixed(6)}, variance=${variance.toFixed(6)}, SD=${Math.sqrt(variance).toFixed(6)}`);
      return { n, mean, variance };
    });
    
    // Calculate weighted overall mean
    const totalWeight = groupStats.reduce((sum, stat) => sum + stat.n / stat.variance, 0);
    console.log(`Total weight (sum of n/σ²): ${totalWeight.toFixed(6)}`);
    
    const weightedMean = groupStats.reduce((sum, stat, i) => {
      const weight = stat.n / stat.variance;
      console.log(`Group ${i+1} weight (n/σ²): ${weight.toFixed(6)}`);
      return sum + (weight * stat.mean);
    }, 0) / totalWeight;
    
    console.log(`Weighted overall mean: ${weightedMean.toFixed(6)}`);
    
    // Calculate Welch's F-statistic
    let numerator = 0;
    let denominator = 0;
    
    console.log('Calculating F-statistic components:');
    groupStats.forEach((stat, i) => {
      const weight = stat.n / stat.variance;
      const numeratorComponent = weight * Math.pow(stat.mean - weightedMean, 2);
      numerator += numeratorComponent;
      
      const lambda = (stat.n / stat.variance) / totalWeight;
      const denominatorComponent = (1 - lambda) * (1 - lambda) / (stat.n - 1);
      denominator += denominatorComponent;
      
      console.log(`Group ${i+1}:`);
      console.log(`  - Numerator component: ${weight.toFixed(6)} × (${stat.mean.toFixed(6)} - ${weightedMean.toFixed(6)})² = ${numeratorComponent.toFixed(6)}`);
      console.log(`  - Lambda: ${lambda.toFixed(6)}`);
      console.log(`  - Denominator component: (1 - ${lambda.toFixed(6)})² / ${stat.n - 1} = ${denominatorComponent.toFixed(6)}`);
    });
    
    console.log(`Total numerator: ${numerator.toFixed(6)}`);
    console.log(`Total denominator part: ${denominator.toFixed(6)}`);
    
    const adjustmentFactor = (k - 1) * (1 + (2 * (k - 2) * denominator) / (Math.pow(k, 2) - 1));
    console.log(`Adjustment factor: (${k} - 1) × (1 + (2 × (${k} - 2) × ${denominator.toFixed(6)}) / (${k}² - 1)) = ${adjustmentFactor.toFixed(6)}`);
    
    const F = numerator / adjustmentFactor;
    
    // Degrees of freedom for Welch's ANOVA
    const dfNum = k - 1;
    const dfDen = (Math.pow(k, 2) - 1) / (3 * denominator);
    
    console.log(`Welch's F-statistic: ${numerator.toFixed(6)} / ${adjustmentFactor.toFixed(6)} = ${F.toFixed(6)}`);
    console.log(`Degrees of freedom: numerator = ${dfNum}, denominator = ${dfDen.toFixed(6)}`);
    
    // Calculate p-value using F-distribution
    const pValue = 1 - fCDF(F, dfNum, dfDen);
    console.log(`p-value: ${pValue.toFixed(8)}`);
    console.log('=== END WELCH\'S ANOVA DEBUG ===');
    const isSignificant = pValue < 0.05;
    
    return {
      testName: "Welch's ANOVA",
      testStatistic: F,
      pValue,
      degreesOfFreedom: Math.round(dfNum),
      isSignificant,
      interpretation: `Since the selected test is Welch's ANOVA and the p-value is ${pValue.toFixed(4)}, we ${isSignificant ? 'reject' : 'fail to reject'} the null hypothesis. This suggests that the difference in ${metricColumn} across ${groupingColumn} is ${isSignificant ? 'statistically significant' : 'not significant'}.`,
      postHocRequired: isSignificant && k > 2,
      postHocReason: isSignificant && k > 2 
        ? "Post-hoc analysis is required. Please proceed to the Post-Hoc Analysis tab to explore pairwise group differences."
        : !isSignificant 
          ? "No post-hoc analysis is required for the selected test. This is because the test result was not statistically significant, so further breakdown is unnecessary."
          : "🧾 Post-Hoc Analysis Not Required"
    };
  }, [metricColumn, groupingColumn]);

  // Helper functions for statistical distributions
  const normalCDF = (z: number): number => {
    return 0.5 * (1 + erf(z / Math.sqrt(2)));
  };

  const erf = (x: number): number => {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  };

  const tCDF = (t: number, df: number): number => {
    // Approximation for t-distribution CDF
    const x = df / (df + t * t);
    return 0.5 + (t > 0 ? 0.5 : -0.5) * incompleteBeta(x, df/2, 0.5);
  };

  const fCDF = (f: number, df1: number, df2: number): number => {
    if (f <= 0) return 0;
    // Use jStat's built-in F-distribution CDF for maximum accuracy
    try {
      return (jStat as any).centralF.cdf(f, df1, df2);
    } catch (error) {
      // Fallback to manual calculation using incomplete beta
      const x = df1 * f / (df1 * f + df2);
      return incompleteBeta(x, df1/2, df2/2);
    }
  };

  const tInverse = (alpha: number, df: number): number => {
    // Use jStat's t-distribution inverse
    try {
      return (jStat as any).studentt.inv(alpha, df);
    } catch (error) {
      // Fallback approximation
      if (df >= 30) return normalInverse(alpha);
      return normalInverse(alpha) * Math.sqrt(df / (df - 2));
    }
  };

  const normalInverse = (p: number): number => {
    // Approximation for standard normal inverse
    if (p === 0.5) return 0;
    const sign = p > 0.5 ? 1 : -1;
    p = p > 0.5 ? 1 - p : p;
    const t = Math.sqrt(-2 * Math.log(p));
    return sign * (t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t));
  };

  const incompleteBeta = (x: number, a: number, b: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    
    try {
      // Try different jStat beta function variations
      if ((jStat as any).beta && (jStat as any).beta.cdf) {
        return (jStat as any).beta.cdf(x, a, b);
      } else if ((jStat as any).incompletebeta) {
        return (jStat as any).incompletebeta(x, a, b);
      } else {
        // Scientific approximation using continued fraction
        return betaContinuedFraction(x, a, b);
      }
    } catch (error) {
      console.warn('jStat incomplete beta failed, using continued fraction approximation:', error);
      return betaContinuedFraction(x, a, b);
    }
  };

  // Scientifically accurate incomplete beta using continued fraction
  const betaContinuedFraction = (x: number, a: number, b: number): number => {
    const logBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
    
    if (x === 0) return 0;
    if (x === 1) return 1;
    
    // Use continued fraction expansion
    const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - logBeta) / a;
    
    const cf = betaCF(x, a, b);
    return front * cf;
  };

  // Log gamma function (Lanczos approximation)
  const logGamma = (z: number): number => {
    const g = 7;
    const coeffs = [
      0.99999999999980993,
      676.5203681218851,
      -1259.1392167224028,
      771.32342877765313,
      -176.61502916214059,
      12.507343278686905,
      -0.13857109526572012,
      9.9843695780195716e-6,
      1.5056327351493116e-7
    ];
    
    if (z < 0.5) {
      return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
    }
    
    z -= 1;
    let x = coeffs[0];
    for (let i = 1; i < g + 2; i++) {
      x += coeffs[i] / (z + i);
    }
    
    const t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  };

  // Continued fraction for incomplete beta
  const betaCF = (x: number, a: number, b: number): number => {
    const maxIterations = 200;
    const epsilon = 1e-15;
    
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 - qab * x / qap;
    
    if (Math.abs(d) < epsilon) d = epsilon;
    d = 1 / d;
    let h = d;
    
    for (let m = 1; m <= maxIterations; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < epsilon) d = epsilon;
      c = 1 + aa / c;
      if (Math.abs(c) < epsilon) c = epsilon;
      d = 1 / d;
      h *= d * c;
      
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < epsilon) d = epsilon;
      c = 1 + aa / c;
      if (Math.abs(c) < epsilon) c = epsilon;
      d = 1 / d;
      const del = d * c;
      h *= del;
      
      if (Math.abs(del - 1) < epsilon) break;
    }
    
    return h;
  };

  const chiSquareCDF = (x: number, df: number): number => {
    if (x <= 0) return 0;
    if (df <= 0) return 0;
    
    try {
      // Try to use jStat's chi-square CDF if available
      if ((jStat as any).chisquare && (jStat as any).chisquare.cdf) {
        return (jStat as any).chisquare.cdf(x, df);
      }
    } catch (error) {
      console.warn('jStat chi-square CDF not available, using gamma function approximation');
    }
    
    // Chi-square distribution is a special case of gamma distribution
    // χ²(df) ~ Gamma(df/2, 2)
    // P(χ² ≤ x) = γ(df/2, x/2) / Γ(df/2)
    // This equals the incomplete gamma function: P(df/2, x/2)
    
    return incompleteGamma(df/2, x/2);
  };

  // Incomplete gamma function P(a,x) = γ(a,x)/Γ(a)
  const incompleteGamma = (a: number, x: number): number => {
    if (x <= 0) return 0;
    if (a <= 0) return 1;
    
    // Use series expansion for small x, continued fraction for large x
    if (x < a + 1) {
      return gammaSeriesExpansion(a, x);
    } else {
      return 1 - gammaContinuedFraction(a, x);
    }
  };

  // Series expansion for incomplete gamma (for x < a+1)
  const gammaSeriesExpansion = (a: number, x: number): number => {
    const maxIterations = 200;
    const epsilon = 1e-15;
    
    let sum = 1;
    let term = 1;
    let n = 1;
    
    while (n <= maxIterations && Math.abs(term) > epsilon) {
      term *= x / (a + n - 1);
      sum += term;
      n++;
    }
    
    return Math.exp(-x + a * Math.log(x) - logGamma(a)) * sum;
  };

  // Continued fraction for incomplete gamma (for x >= a+1)
  const gammaContinuedFraction = (a: number, x: number): number => {
    const maxIterations = 200;
    const epsilon = 1e-15;
    
    let b = x + 1 - a;
    let c = 1e30;
    let d = 1 / b;
    let h = d;
    
    for (let i = 1; i <= maxIterations; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < epsilon) d = epsilon;
      c = b + an / c;
      if (Math.abs(c) < epsilon) c = epsilon;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < epsilon) break;
    }
    
    return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
  };

  // Chi-Square Test for Independence implementation
  const runChiSquareTest = useCallback((groupData: { [key: string]: number[] }): TestResult => {
    // Chi-Square Test for Independence for proportion data
    const groupNames = Object.keys(groupData);
    const numGroups = groupNames.length;
    
    // Calculate observed frequencies (successes and failures for each group)
    const observed: number[][] = [];
    const totals: number[] = [];
    let grandTotal = 0;
    
    groupNames.forEach((group, i) => {
      const data = groupData[group];
      const successes = data.reduce((a, b) => a + b, 0);
      const failures = data.length - successes;
      observed[i] = [successes, failures];
      totals[i] = data.length;
      grandTotal += data.length;
    });
    
    // Calculate overall success rate
    const totalSuccesses = observed.reduce((sum, row) => sum + row[0], 0);
    const overallSuccessRate = totalSuccesses / grandTotal;
    
    // Calculate expected frequencies
    const expected: number[][] = [];
    observed.forEach((row, i) => {
      const expectedSuccesses = totals[i] * overallSuccessRate;
      const expectedFailures = totals[i] * (1 - overallSuccessRate);
      expected[i] = [expectedSuccesses, expectedFailures];
    });
    
    // Calculate Chi-Square statistic
    let chiSquare = 0;
    observed.forEach((row, i) => {
      row.forEach((obs, j) => {
        const exp = expected[i][j];
        if (exp > 0) {
          chiSquare += Math.pow(obs - exp, 2) / exp;
        }
      });
    });
    
    // Degrees of freedom = (rows - 1) * (columns - 1) = (numGroups - 1) * (2 - 1)
    const degreesOfFreedom = numGroups - 1;
    
    // Calculate p-value using chi-square distribution approximation
    // Correct - Use a Chi-Square distribution CDF function
    const pValue = 1 - chiSquareCDF(chiSquare, degreesOfFreedom);
    
    const isSignificant = pValue < 0.05;
    
    return {
      testName: "Chi-Square Test for Independence",
      testStatistic: chiSquare,
      pValue,
      degreesOfFreedom,
      isSignificant,
      interpretation: `Since the selected test is Chi-Square Test for Independence and the p-value is ${pValue.toFixed(4)}, we ${isSignificant ? 'reject' : 'fail to reject'} the null hypothesis. This suggests that the association between ${metricColumn} and ${groupingColumn} is ${isSignificant ? 'statistically significant' : 'not significant'}.`,
      postHocRequired: isSignificant,
      postHocReason: isSignificant 
        ? "Post-hoc analysis is required because the Chi-Square test was significant. This involves pairwise Two-Proportion Z-Tests with Bonferroni correction to identify which specific groups differ significantly."
        : "No post-hoc analysis is required because the Chi-Square test was not significant. This means there is no evidence of differences in proportions between the groups."
    };
  }, [metricColumn, groupingColumn, chiSquareCDF]);

  // Mann-Whitney U Test implementation
  const runMannWhitneyUTest = useCallback((group1Data: number[], group2Data: number[]): TestResult => {
    const n1 = group1Data.length;
    const n2 = group2Data.length;
    
    // Combine and rank all values
    const combined = [...group1Data.map(val => ({ value: val, group: 1 })), 
                     ...group2Data.map(val => ({ value: val, group: 2 }))];
    combined.sort((a, b) => a.value - b.value);
    
    // Assign ranks (handling ties by averaging)
    const ranks: number[] = [];
    let i = 0;
    while (i < combined.length) {
      let j = i;
      while (j < combined.length && combined[j].value === combined[i].value) {
        j++;
      }
      const averageRank = (i + 1 + j) / 2;
      for (let k = i; k < j; k++) {
        ranks[k] = averageRank;
      }
      i = j;
    }
    
    // Calculate rank sums
    let R1 = 0, R2 = 0;
    for (let k = 0; k < combined.length; k++) {
      if (combined[k].group === 1) {
        R1 += ranks[k];
      } else {
        R2 += ranks[k];
      }
    }
    
    // Calculate U statistics
    const U1 = R1 - (n1 * (n1 + 1)) / 2;
    const U2 = R2 - (n2 * (n2 + 1)) / 2;
    const U = Math.min(U1, U2);
    
    // Calculate z-score for large samples
    const meanU = (n1 * n2) / 2;
    const stdU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
    const z = Math.abs((U - meanU) / stdU);
    
    // Calculate p-value
    const pValue = 2 * (1 - normalCDF(z));
    const isSignificant = pValue < 0.05;
    
    return {
      testName: "Mann-Whitney U Test",
      testStatistic: U,
      pValue,
      isSignificant,
      interpretation: `Since the selected test is Mann-Whitney U Test and the p-value is ${pValue.toFixed(4)}, we ${isSignificant ? 'reject' : 'fail to reject'} the null hypothesis. This suggests that the median ${metricColumn} values between groups are ${isSignificant ? 'significantly different' : 'not significantly different'}.`,
      postHocRequired: false,
      postHocReason: "No post-hoc analysis is required for the selected test. This is because the number of groups being compared is only 2 (so no pairwise comparisons beyond the main test are needed)."
    };
  }, [metricColumn, normalCDF]);

  // Kruskal-Wallis Test implementation
  const runKruskalWallisTest = useCallback((groupData: { [key: string]: number[] }): TestResult => {
    const groupNames = Object.keys(groupData);
    const k = groupNames.length; // number of groups
    
    // Combine all data with group labels
    const allData: { value: number; group: string }[] = [];
    groupNames.forEach(group => {
      groupData[group].forEach(value => {
        allData.push({ value, group });
      });
    });
    
    const N = allData.length;
    
    // Sort and assign ranks
    allData.sort((a, b) => a.value - b.value);
    const ranks: number[] = [];
    const tieGroups: number[] = []; // Track tie group sizes for correction
    let i = 0;
    while (i < allData.length) {
      let j = i;
      while (j < allData.length && allData[j].value === allData[i].value) {
        j++;
      }
      const tieGroupSize = j - i;
      const averageRank = (i + 1 + j) / 2;
      
      // Record tie group size if there are ties
      if (tieGroupSize > 1) {
        tieGroups.push(tieGroupSize);
      }
      
      for (let k = i; k < j; k++) {
        ranks[k] = averageRank;
      }
      i = j;
    }
    
    // Calculate rank sums for each group
    const rankSums: { [key: string]: number } = {};
    groupNames.forEach(group => {
      rankSums[group] = 0;
    });
    
    allData.forEach((item, index) => {
      rankSums[item.group] += ranks[index];
    });
    
    // Calculate H statistic (uncorrected)
    let H = 0;
    groupNames.forEach(group => {
      const ni = groupData[group].length;
      const Ri = rankSums[group];
      H += (Ri * Ri) / ni;
    });
    
    H = (12 / (N * (N + 1))) * H - 3 * (N + 1);
    
    // Calculate tie correction factor C
    let tieCorrection = 0;
    tieGroups.forEach(t => {
      tieCorrection += (t * t * t - t);
    });
    
    const C = 1 - (tieCorrection / (N * N * N - N));
    
    // Apply tie correction to H statistic
    const correctedH = H / C;
    
    // Degrees of freedom
    const df = k - 1;
    
    // Calculate p-value using chi-square distribution with corrected H
    const pValue = 1 - chiSquareCDF(correctedH, df);
    const isSignificant = pValue < 0.05;
    
    // Debug logging for tie correction
    console.log('=== KRUSKAL-WALLIS TIE CORRECTION DEBUG ===');
    console.log(`Total observations (N): ${N}`);
    console.log(`Number of tie groups: ${tieGroups.length}`);
    console.log('Tie group sizes:', tieGroups);
    console.log(`Tie correction sum: ${tieCorrection.toFixed(6)}`);
    console.log(`Correction factor (C): ${C.toFixed(6)}`);
    console.log(`Uncorrected H: ${H.toFixed(6)}`);
    console.log(`Corrected H: ${correctedH.toFixed(6)}`);
    console.log(`P-value: ${pValue.toFixed(8)}`);
    console.log('=== END TIE CORRECTION DEBUG ===');
    
    return {
      testName: "Kruskal-Wallis Test",
      testStatistic: correctedH,
      pValue,
      degreesOfFreedom: df,
      isSignificant,
      interpretation: `Since the selected test is Kruskal-Wallis Test and the p-value is ${pValue.toFixed(4)}, we ${isSignificant ? 'reject' : 'fail to reject'} the null hypothesis. This suggests that the median ${metricColumn} values across ${groupingColumn} groups are ${isSignificant ? 'significantly different' : 'not significantly different'}.`,
      postHocRequired: isSignificant,
      postHocReason: isSignificant 
        ? "Post-hoc analysis is required because the Kruskal-Wallis test was significant. This involves Dunn's Test with Bonferroni correction to identify which specific groups have significantly different medians."
        : "No post-hoc analysis is required because the Kruskal-Wallis test was not significant. This means there is no evidence of differences in medians between the groups."
    };
  }, [metricColumn, groupingColumn, chiSquareCDF]);

  // Execute the recommended statistical test
  const executeStatisticalTest = useCallback(() => {
    if (!testRecommendation || !data.length || !metricColumn || !groupingColumn) return;

    setIsRunningTest(true);

    try {
      const groupData: { [key: string]: number[] } = {};
      
      // Conditional logging for performance (only for smaller datasets)
      const enableDetailedLogging = data.length < 10000; // Only log for datasets < 10k rows
      
      if (enableDetailedLogging) {
        console.log('=== DATA PROCESSING DEBUG ===');
        console.log('Total rows in data:', data.length);
        console.log('Metric column:', metricColumn);
        console.log('Grouping column:', groupingColumn);
        console.log('First 5 rows of raw data:', data.slice(0, 5));
      } else {
        console.log(`=== PROCESSING LARGE DATASET (${data.length.toLocaleString()} rows) ===`);
      }
      
      let processedCount = 0;
      let skippedCount = 0;
      const skippedReasons: string[] = [];
      
      data.forEach((row, index) => {
        const group = String(row[groupingColumn]);
        const rawValue = row[metricColumn];
        const value = parseFloat(String(rawValue));
        
        if (enableDetailedLogging && index < 5) {
          console.log(`Row ${index}: group="${group}", rawValue=${rawValue} (type: ${typeof rawValue}), parsed=${value}, isNaN=${isNaN(value)}`);
        }
        
        if (!isNaN(value)) {
          if (!groupData[group]) {
            groupData[group] = [];
          }
          groupData[group].push(value);
          processedCount++;
        } else {
          skippedCount++;
          if (skippedReasons.length < 10) {
            skippedReasons.push(`Row ${index}: group="${group}", rawValue=${rawValue}, type=${typeof rawValue}`);
          }
        }
      });

      console.log('Processing summary:');
      console.log('- Processed rows:', processedCount.toLocaleString());
      console.log('- Skipped rows:', skippedCount.toLocaleString());
      
      if (enableDetailedLogging && skippedReasons.length > 0) {
        console.log('- Skipped examples:', skippedReasons);
      }
      
      const groupNames = Object.keys(groupData);
      console.log('Groups found:', groupNames);
      
      // Log group data (limited for large datasets)
      groupNames.forEach(groupName => {
        const groupValues = groupData[groupName];
        console.log(`Group "${groupName}": ${groupValues.length.toLocaleString()} values`);
        
        if (enableDetailedLogging) {
          console.log(`  - First 10 values: [${groupValues.slice(0, 10).join(', ')}]`);
        }
        
        // Calculate stats efficiently for large datasets
        const min = Math.min(...groupValues);
        const max = Math.max(...groupValues);
        const mean = groupValues.reduce((a, b) => a + b, 0) / groupValues.length;
        
        console.log(`  - Min: ${min}, Max: ${max}, Mean: ${mean.toFixed(4)}`);
      });
      
      console.log('Test recommendation:', testRecommendation.testName);
      console.log(enableDetailedLogging ? '=== END DEBUG ===' : '=== END PROCESSING ===');
      let result: TestResult;

      switch (testRecommendation.testName) {
        case "Two-Proportion Z-Test":
          if (enableDetailedLogging) {
            console.log('=== FUNCTION INPUT DEBUG ===');
            console.log('Two-Proportion Z-Test inputs:');
            console.log(`Group 1 (${groupNames[0]}): [${groupData[groupNames[0]].slice(0, 10).join(', ')}...] (${groupData[groupNames[0]].length} values)`);
            console.log(`Group 2 (${groupNames[1]}): [${groupData[groupNames[1]].slice(0, 10).join(', ')}...] (${groupData[groupNames[1]].length} values)`);
          }
          result = runTwoProportionZTest(groupData[groupNames[0]], groupData[groupNames[1]]);
          break;

        case "Two-Sample t-Test":
          if (enableDetailedLogging) {
            console.log('=== FUNCTION INPUT DEBUG ===');
            console.log('Two-Sample t-Test inputs:');
            console.log(`Group 1 (${groupNames[0]}): [${groupData[groupNames[0]].slice(0, 10).join(', ')}...] (${groupData[groupNames[0]].length} values)`);
            console.log(`Group 2 (${groupNames[1]}): [${groupData[groupNames[1]].slice(0, 10).join(', ')}...] (${groupData[groupNames[1]].length} values)`);
          }
          result = runTwoSampleTTest(groupData[groupNames[0]], groupData[groupNames[1]], true);
          break;

        case "Welch's t-Test":
          if (enableDetailedLogging) {
            console.log('=== FUNCTION INPUT DEBUG ===');
            console.log('Welch\'s t-Test inputs:');
            console.log(`Group 1 (${groupNames[0]}): [${groupData[groupNames[0]].slice(0, 10).join(', ')}...] (${groupData[groupNames[0]].length} values)`);
            console.log(`Group 2 (${groupNames[1]}): [${groupData[groupNames[1]].slice(0, 10).join(', ')}...] (${groupData[groupNames[1]].length} values)`);
          }
          result = runTwoSampleTTest(groupData[groupNames[0]], groupData[groupNames[1]], false);
          break;

        case "One-way ANOVA":
          if (enableDetailedLogging) {
            console.log('=== FUNCTION INPUT DEBUG ===');
            console.log('One-way ANOVA inputs:');
            // Avoid JSON.stringify for large datasets - just show structure
            const groupSummary = Object.keys(groupData).map(key => `${key}: ${groupData[key].length} values`);
            console.log('Group data summary:', groupSummary);
          }
          result = runOneWayANOVA(groupData);
          break;

        case "Welch's ANOVA":
          if (enableDetailedLogging) {
            console.log('=== FUNCTION INPUT DEBUG ===');
            console.log('Welch\'s ANOVA inputs:');
            // Avoid JSON.stringify for large datasets - just show structure
            const groupSummary = Object.keys(groupData).map(key => `${key}: ${groupData[key].length} values`);
            console.log('Group data summary:', groupSummary);
          }
          result = runWelchsANOVA(groupData);
          break;

        case "Chi-Square Test for Independence":
          if (enableDetailedLogging) {
            console.log('=== FUNCTION INPUT DEBUG ===');
            console.log('Chi-Square Test inputs:');
            // Avoid JSON.stringify for large datasets - just show structure
            const groupSummary = Object.keys(groupData).map(key => `${key}: ${groupData[key].length} values`);
            console.log('Group data summary:', groupSummary);
          }
          result = runChiSquareTest(groupData);
          break;

        case "Mann-Whitney U Test":
          if (enableDetailedLogging) {
            console.log('=== FUNCTION INPUT DEBUG ===');
            console.log('Mann-Whitney U Test inputs:');
            console.log(`Group 1 (${groupNames[0]}): [${groupData[groupNames[0]].slice(0, 10).join(', ')}...] (${groupData[groupNames[0]].length} values)`);
            console.log(`Group 2 (${groupNames[1]}): [${groupData[groupNames[1]].slice(0, 10).join(', ')}...] (${groupData[groupNames[1]].length} values)`);
          }
          result = runMannWhitneyUTest(groupData[groupNames[0]], groupData[groupNames[1]]);
          break;

        case "Kruskal-Wallis Test":
          console.log('=== FUNCTION INPUT DEBUG ===');
          console.log('Kruskal-Wallis Test inputs:');
          console.log('Full groupData object:', JSON.stringify(groupData, null, 2));
          result = runKruskalWallisTest(groupData);
          break;

        default:
          throw new Error(`Test ${testRecommendation.testName} not implemented yet`);
      }

      setTestResult(result);
    } catch (error) {
      console.error('Error executing statistical test:', error);
    } finally {
      setIsRunningTest(false);
      markTestExecuted();
    }
  }, [testRecommendation, data, metricColumn, groupingColumn, runTwoProportionZTest, runTwoSampleTTest, runOneWayANOVA, runWelchsANOVA, runChiSquareTest, runMannWhitneyUTest, runKruskalWallisTest, markTestExecuted]);

  // Post-hoc test functions
  const runTukeyHSD = useCallback((groupData: { [key: string]: number[] }): PostHocResult[] => {
    const groupNames = Object.keys(groupData);
    const results: PostHocResult[] = [];
    
    // Calculate overall mean and variance for Tukey HSD
    const allValues = Object.values(groupData).flat();
    const grandMean = allValues.reduce((a, b) => a + b, 0) / allValues.length;
    
    // Calculate within-group variance (pooled error)
    let withinGroupSumSquares = 0;
    let totalN = 0;
    
    Object.values(groupData).forEach(values => {
      const groupMean = values.reduce((a, b) => a + b, 0) / values.length;
      withinGroupSumSquares += values.reduce((sum, val) => sum + Math.pow(val - groupMean, 2), 0);
      totalN += values.length;
    });
    
    const withinGroupMeanSquare = withinGroupSumSquares / (totalN - groupNames.length);
    
    // Perform pairwise comparisons
    for (let i = 0; i < groupNames.length; i++) {
      for (let j = i + 1; j < groupNames.length; j++) {
        const groupA = groupNames[i];
        const groupB = groupNames[j];
        const valuesA = groupData[groupA];
        const valuesB = groupData[groupB];
        
        const meanA = valuesA.reduce((a, b) => a + b, 0) / valuesA.length;
        const meanB = valuesB.reduce((a, b) => a + b, 0) / valuesB.length;
        
        // Tukey HSD test statistic
        const standardError = Math.sqrt(withinGroupMeanSquare * (1/valuesA.length + 1/valuesB.length));
        const qStat = Math.abs(meanA - meanB) / standardError;
        
        // Approximation of Tukey's q-distribution (using critical value for alpha = 0.05)
        const dfError = totalN - groupNames.length;
        const qCritical = 3.64; // Approximate q-value for 3+ groups, alpha=0.05
        
        const isSignificant = qStat > qCritical;
        
        results.push({
          groupA,
          groupB,
          testStatistic: qStat,
          pValue: isSignificant ? 0.01 : 0.10, // Simplified p-value approximation
          adjustedPValue: isSignificant ? 0.01 : 0.10,
          isSignificant
        });
      }
    }
    
    return results;
  }, []);

  const runGamesHowell = useCallback((groupData: { [key: string]: number[] }): PostHocResult[] => {
    const groupNames = Object.keys(groupData);
    const results: PostHocResult[] = [];
    
    // Perform pairwise comparisons using Games-Howell procedure
    for (let i = 0; i < groupNames.length; i++) {
      for (let j = i + 1; j < groupNames.length; j++) {
        const groupA = groupNames[i];
        const groupB = groupNames[j];
        const valuesA = groupData[groupA];
        const valuesB = groupData[groupB];
        
        const meanA = valuesA.reduce((a, b) => a + b, 0) / valuesA.length;
        const meanB = valuesB.reduce((a, b) => a + b, 0) / valuesB.length;
        
        // Calculate variances
        const varA = valuesA.reduce((sum, val) => sum + Math.pow(val - meanA, 2), 0) / (valuesA.length - 1);
        const varB = valuesB.reduce((sum, val) => sum + Math.pow(val - meanB, 2), 0) / (valuesB.length - 1);
        
        // Games-Howell test statistic (similar to Welch's t-test)
        const standardError = Math.sqrt(varA/valuesA.length + varB/valuesB.length);
        const tStat = Math.abs(meanA - meanB) / standardError;
        
        // Degrees of freedom for Games-Howell
        const df = Math.pow(varA/valuesA.length + varB/valuesB.length, 2) / 
                   (Math.pow(varA/valuesA.length, 2)/(valuesA.length - 1) + 
                    Math.pow(varB/valuesB.length, 2)/(valuesB.length - 1));
        
        // Calculate p-value using t-distribution
        const pValue = 2 * (1 - tCDF(tStat, df));
        
        // Bonferroni correction for multiple comparisons
        const numComparisons = (groupNames.length * (groupNames.length - 1)) / 2;
        const adjustedPValue = Math.min(1.0, pValue * numComparisons);
        
        results.push({
          groupA,
          groupB,
          testStatistic: tStat,
          pValue,
          adjustedPValue,
          isSignificant: adjustedPValue < 0.05
        });
      }
    }
    
    return results;
  }, [tCDF]);

  const runDunnTest = useCallback((groupData: { [key: string]: number[] }): PostHocResult[] => {
    const groupNames = Object.keys(groupData);
    const results: PostHocResult[] = [];
    
    // Combine all data and calculate ranks
    const allData: { value: number; group: string }[] = [];
    Object.entries(groupData).forEach(([group, values]) => {
      values.forEach(value => allData.push({ value, group }));
    });
    
    // Sort and assign ranks
    allData.sort((a, b) => a.value - b.value);
    const rankedData = allData.map((item, index) => ({ ...item, rank: index + 1 }));
    
    // Calculate mean ranks for each group
    const groupRanks: { [key: string]: number[] } = {};
    rankedData.forEach(item => {
      if (!groupRanks[item.group]) groupRanks[item.group] = [];
      groupRanks[item.group].push(item.rank);
    });
    
    const groupMeanRanks: { [key: string]: number } = {};
    Object.entries(groupRanks).forEach(([group, ranks]) => {
      groupMeanRanks[group] = ranks.reduce((a, b) => a + b, 0) / ranks.length;
    });
    
    const N = allData.length;
    
    // Perform pairwise comparisons
    for (let i = 0; i < groupNames.length; i++) {
      for (let j = i + 1; j < groupNames.length; j++) {
        const groupA = groupNames[i];
        const groupB = groupNames[j];
        const nA = groupData[groupA].length;
        const nB = groupData[groupB].length;
        
        const meanRankA = groupMeanRanks[groupA];
        const meanRankB = groupMeanRanks[groupB];
        
        // Dunn's test statistic
        const standardError = Math.sqrt((N * (N + 1) / 12) * (1/nA + 1/nB));
        const zStat = Math.abs(meanRankA - meanRankB) / standardError;
        
        // Calculate p-value using normal distribution
        const pValue = 2 * (1 - normalCDF(zStat));
        
        // Bonferroni correction
        const numComparisons = (groupNames.length * (groupNames.length - 1)) / 2;
        const adjustedPValue = Math.min(1.0, pValue * numComparisons);
        
        results.push({
          groupA,
          groupB,
          testStatistic: zStat,
          pValue,
          adjustedPValue,
          isSignificant: adjustedPValue < 0.05
        });
      }
    }
    
    return results;
  }, [normalCDF]);

  const runPairwiseProportionTests = useCallback((groupData: { [key: string]: number[] }): PostHocResult[] => {
    const groupNames = Object.keys(groupData);
    const results: PostHocResult[] = [];
    
    // Calculate proportions for each group
    const groupProportions: { [key: string]: { success: number; total: number; proportion: number } } = {};
    Object.entries(groupData).forEach(([group, values]) => {
      const success = values.filter(v => v === 1).length;
      const total = values.length;
      groupProportions[group] = {
        success,
        total,
        proportion: success / total
      };
    });
    
    // Perform pairwise comparisons
    for (let i = 0; i < groupNames.length; i++) {
      for (let j = i + 1; j < groupNames.length; j++) {
        const groupA = groupNames[i];
        const groupB = groupNames[j];
        const propA = groupProportions[groupA];
        const propB = groupProportions[groupB];
        
        // Two-proportion Z-test
        const pooledProp = (propA.success + propB.success) / (propA.total + propB.total);
        const standardError = Math.sqrt(pooledProp * (1 - pooledProp) * (1/propA.total + 1/propB.total));
        const zStat = Math.abs(propA.proportion - propB.proportion) / standardError;
        
        const pValue = 2 * (1 - normalCDF(zStat));
        
        // Bonferroni correction
        const numComparisons = (groupNames.length * (groupNames.length - 1)) / 2;
        const adjustedPValue = Math.min(1.0, pValue * numComparisons);
        
        results.push({
          groupA,
          groupB,
          testStatistic: zStat,
          pValue,
          adjustedPValue,
          isSignificant: adjustedPValue < 0.05
        });
      }
    }
    
    return results;
  }, [normalCDF]);

  // Function to determine if post-hoc analysis should be shown
  const shouldShowPostHocTab = useMemo(() => {
    if (!testResult || !testRecommendation || !groupStats) return false;
    
    const groupNames = Object.keys(groupStats);
    const supportsPostHoc = ['One-way ANOVA', 'Welch\'s ANOVA', 'Kruskal-Wallis Test', 'Chi-Square Test for Independence'].includes(testRecommendation.testName);
    
    return groupNames.length > 2 && testResult.isSignificant && supportsPostHoc;
  }, [testResult, testRecommendation, groupStats]);

  // Execute post-hoc analysis
  const executePostHocAnalysis = useCallback(() => {
    if (!testRecommendation || !data.length || !metricColumn || !groupingColumn || !testResult?.isSignificant) return;

    setIsRunningPostHoc(true);

    try {
      const groupData: { [key: string]: number[] } = {};
      
      data.forEach((row) => {
        const group = String(row[groupingColumn]);
        const rawValue = row[metricColumn];
        const value = parseFloat(String(rawValue));
        
        if (!isNaN(value)) {
          if (!groupData[group]) {
            groupData[group] = [];
          }
          groupData[group].push(value);
        }
      });

      let results: PostHocResult[] = [];

      switch (testRecommendation.testName) {
        case "One-way ANOVA":
          results = runTukeyHSD(groupData);
          break;
        case "Welch's ANOVA":
          results = runGamesHowell(groupData);
          break;
        case "Kruskal-Wallis Test":
          results = runDunnTest(groupData);
          break;
        case "Chi-Square Test for Independence":
          results = runPairwiseProportionTests(groupData);
          break;
        default:
          throw new Error(`Post-hoc analysis not implemented for ${testRecommendation.testName}`);
      }

      setPostHocResults(results);
    } catch (error) {
      console.error('Error executing post-hoc analysis:', error);
    } finally {
      setIsRunningPostHoc(false);
    }
  }, [testRecommendation, data, metricColumn, groupingColumn, testResult, runTukeyHSD, runGamesHowell, runDunnTest, runPairwiseProportionTests]);

  return (
    <Box sx={{ p: 3 }}>
      <Box>
        <Box
          component="label"
          onDragOver={(e: React.DragEvent<HTMLDivElement>) => e.preventDefault()}
          onDrop={(e: React.DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            const file = e.dataTransfer?.files[0];
            if (file) {
              setFile(file);
              setFileName(file.name);
            }
          }}
        >
          <UploadArea
            elevation={0}
            sx={{ 
              '&:hover': { 
                borderColor: '#2196f3',
                backgroundColor: '#f5f9ff',
              }
            }}
          >
            <CloudUploadIcon sx={{ fontSize: 40, color: '#1976d2' }} />
            <Typography variant="h6" sx={{ color: '#000000', fontWeight: 500, fontSize: '1.1rem' }}>
              Drag and drop your CSV file here
            </Typography>
            <Typography variant="body2" sx={{ color: '#000000' }}>
              or
            </Typography>
            <Button
              component="label"
              variant="outlined"
              startIcon={<FileUploadIcon />}
              sx={{
                borderColor: '#1976d2',
                color: '#1976d2',
                '&:hover': {
                  borderColor: '#1565c0',
                  backgroundColor: '#f5f9ff',
                },
                fontWeight: 500,
                px: 2.5,
                py: 0.75
              }}
            >
              Select File
              <VisuallyHiddenInput
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
              />
            </Button>
            {fileName && (
              <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <FileUploadIcon sx={{ color: '#1976d2' }} />
                <Typography sx={{ color: '#1976d2', fontWeight: 500 }}>{fileName}</Typography>
              </Box>
            )}
          </UploadArea>
        </Box>
        {file && !isProcessing && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
            <Button 
              variant="contained" 
              onClick={handleAnalyze}
              startIcon={<FileUploadIcon />}
              sx={{
                backgroundColor: '#1976d2',
                '&:hover': {
                  backgroundColor: '#1565c0',
                },
                fontWeight: 500,
                px: 4,
                py: 1
              }}
            >
              Analyze File
            </Button>
          </Box>
        )}
        {isProcessing && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
            <CircularProgress sx={{ color: '#1976d2' }} />
          </Box>
        )}
      </Box>

      {showTabs && (
        <Box sx={{ mt: 4, borderTop: '1px solid #e0e0e0', pt: 4 }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs 
              value={tabValue} 
              onChange={handleTabChange}
              sx={{ backgroundColor: '#f8f9fa' }}
            >
              <Tab 
                label="Metric Visualization" 
                id="statistical-tab-0"
                aria-controls="statistical-tabpanel-0"
                sx={{ fontWeight: 500, color: '#1976d2' }}
              />
              <Tab 
                label="Planning" 
                id="statistical-tab-1"
                aria-controls="statistical-tabpanel-1"
                sx={{ fontWeight: 500, color: '#1976d2' }}
              />
              <Tab 
                label="Execution" 
                id="statistical-tab-2"
                aria-controls="statistical-tabpanel-2"
                sx={{ fontWeight: 500, color: '#1976d2' }}
              />
              {shouldShowPostHocTab && (
                <Tab 
                  label="Post-Hoc Analysis" 
                  id="statistical-tab-3"
                  aria-controls="statistical-tabpanel-3"
                  sx={{ fontWeight: 500, color: '#1976d2' }}
                />
              )}
            </Tabs>
          </Box>

          <TabPanel value={tabValue} index={0}>
            <Box sx={{ mt: 3 }}>
              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>Metric Column</InputLabel>
                <Select
                  value={metricColumn}
                  onChange={handleMetricChange}
                  label="Metric Column"
                >
                  {columns.map(column => (
                    <MenuItem key={column} value={column}>{column}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>Grouping Column</InputLabel>
                <Select
                  value={groupingColumn}
                  onChange={handleGroupingChange}
                  label="Grouping Column"
                >
                  {columns.map(column => (
                    <MenuItem key={column} value={column}>{column}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              {metricColumn && groupingColumn && (
                <Box>
                  <Typography variant="h6" sx={{ mb: 2, color: '#000000', fontWeight: 500 }}>
                    Group Statistics
                  </Typography>
                  
                  {isCalculating ? (
                    <TableLoadingSkeleton />
                  ) : (
                    <TableContainer component={Paper} sx={{ mb: 3 }}>
                      <Table>
                        <TableHead>
                          <TableRow sx={{ backgroundColor: '#f8f9fa' }}>
                            <TableCell>Group</TableCell>
                            <TableCell>Count</TableCell>
                            {isMetricContinuous ? (
                              <>
                                <TableCell>Mean</TableCell>
                                <TableCell>5% Trimmed Mean</TableCell>
                                <TableCell>Skewness</TableCell>
                                <TableCell>Kurtosis</TableCell>
                                <TableCell>Mean Diff %</TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell>Proportion</TableCell>
                                <TableCell>Standard Error</TableCell>
                                <TableCell>95% CI Lower</TableCell>
                                <TableCell>95% CI Upper</TableCell>
                              </>
                            )}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {Object.entries(groupStats).map(([group, stats]) => (
                            <TableRow key={group}>
                              <TableCell>{group}</TableCell>
                              <TableCell>{stats.count}</TableCell>
                              {isMetricContinuous ? (
                                <>
                                  <TableCell>{stats.mean.toFixed(3)}</TableCell>
                                  <TableCell>{stats.trimmedMean.toFixed(3)}</TableCell>
                                  <TableCell>{stats.skewness.toFixed(3)}</TableCell>
                                  <TableCell>{stats.kurtosis.toFixed(3)}</TableCell>
                                  <TableCell>{stats.meanDiffPercentage.toFixed(1)}%</TableCell>
                                </>
                              ) : (
                                <>
                                  <TableCell>{(stats.proportion || 0).toFixed(3)}</TableCell>
                                  <TableCell>{(stats.proportionStdError || 0).toFixed(3)}</TableCell>
                                  <TableCell>
                                    {(stats.proportion && stats.proportionStdError
                                      ? stats.proportion - 1.96 * stats.proportionStdError
                                      : 0
                                    ).toFixed(3)}
                                  </TableCell>
                                  <TableCell>
                                    {(stats.proportion && stats.proportionStdError
                                      ? stats.proportion + 1.96 * stats.proportionStdError
                                      : 0
                                    ).toFixed(3)}
                                  </TableCell>
                                </>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}

                  {isMetricContinuous && (
                    <>
                      {isCalculating ? (
                        Object.keys(groupStats).map((_, index) => (
                          <ReliabilityCheckSkeleton key={index} />
                        ))
                      ) : (
                        Object.entries(groupStats).map(([group, stats]) => (
                          <ReliabilityCheck
                            key={group}
                            group={group}
                            stats={stats}
                            leveneTest={leveneTest}
                            testName={testRecommendation?.testName}
                          />
                        ))
                      )}

                      <Typography variant="h6" sx={{ mb: 2, mt: 4, color: '#000000', fontWeight: 500 }}>
                        Distribution Plots
                      </Typography>
                      <Grid container spacing={4}>
                        {Object.entries(groupStats).map(([group, stats]) => (
                          <Grid item xs={12} md={6} key={group}>
                            <Paper sx={{ p: 3, height: '100%' }}>
                              <Suspense fallback={
                                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
                                  <CircularProgress />
                                </Box>
                              }>
                                <HistogramPlotLazy data={stats.values} groupName={group} />
                              </Suspense>
                            </Paper>
                          </Grid>
                        ))}
                      </Grid>
                    </>
                  )}
                </Box>
              )}
            </Box>
          </TabPanel>

          <TabPanel value={tabValue} index={1}>
            <Box>
              {metricColumn && groupingColumn ? (
                <>
                  <Typography variant="h6" sx={{ mb: 3, color: '#1976d2', fontWeight: 500 }}>
                    Statistical Test Recommendation
                  </Typography>

                  {(() => {
                    if (!testRecommendation) return null;

                    return (
                      <Paper sx={{ p: 3, bgcolor: '#f8f9fa' }}>
                        <Box sx={{ mb: 3 }}>
                          <Typography variant="h6" sx={{ color: '#2e7d32', mb: 1 }}>
                            Selected Test
                          </Typography>
                          <Typography variant="body1" sx={{ fontWeight: 500 }}>
                            {testRecommendation.testName}
                          </Typography>
                        </Box>

                        <Box sx={{ mb: 3 }}>
                          <Typography variant="h6" sx={{ color: '#2e7d32', mb: 1 }}>
                            Post-hoc Analysis
                          </Typography>
                          <Typography variant="body1">
                            {testRecommendation.requiresPostHoc ? (
                              <>
                                Required - {testRecommendation.postHocMethod}
                              </>
                            ) : (
                              "Not required"
                            )}
                          </Typography>
                        </Box>

                        <Box>
                          <Typography variant="h6" sx={{ color: '#2e7d32', mb: 1 }}>
                            Reasoning
                          </Typography>
                          <Typography 
                            variant="body1" 
                            component="div"
                            sx={{ 
                              whiteSpace: 'pre-line',
                              '& > div': {
                                marginBottom: '4px'
                              }
                            }}
                          >
                            {testRecommendation.reasoning.split('\n').map((line, index) => (
                              <div key={index}>{line}</div>
                            ))}
                          </Typography>
                        </Box>
                      </Paper>
                    );
                  })()}
                </>
              ) : (
                <Alert severity="info">
                  Please select both a metric column and a grouping column in the Metric Visualization tab to get test recommendations.
                </Alert>
              )}
            </Box>
          </TabPanel>

          <TabPanel value={tabValue} index={2}>
            <Box>
              {metricColumn && groupingColumn && testRecommendation ? (
                <>
                  <Typography variant="h6" sx={{ mb: 3, color: '#1976d2', fontWeight: 500 }}>
                    Statistical Test Execution
                  </Typography>

                  {inputsChanged && testResult && (
                    <Alert severity="warning" sx={{ mb: 3 }}>
                      <Typography variant="body1">
                        <strong>Inputs Changed - Results Outdated</strong>
                        <br />
                        You have modified the metric or grouping column. Please run the test again to generate new results with the updated parameters.
                      </Typography>
                    </Alert>
                  )}

                  <Box sx={{ mb: 3 }}>
                    <Button
                      variant="contained"
                      onClick={executeStatisticalTest}
                      disabled={isRunningTest}
                      sx={{
                        backgroundColor: '#1976d2',
                        '&:hover': { backgroundColor: '#1565c0' },
                        fontWeight: 500,
                        px: 4,
                        py: 1
                      }}
                    >
                      {isRunningTest ? (
                        <>
                          <CircularProgress size={20} sx={{ mr: 1, color: 'white' }} />
                          Running Test...
                        </>
                      ) : (
                        `Run ${testRecommendation.testName}`
                      )}
                    </Button>
                  </Box>

                  {testResult && !inputsChanged && (
                    <Paper sx={{ p: 3, bgcolor: '#f8f9fa' }}>
                      <Typography variant="h6" sx={{ mb: 3, color: '#2e7d32' }}>
                        Test Results
                      </Typography>

                      <Grid container spacing={3}>
                        <Grid item xs={12} md={6}>
                          <Box sx={{ mb: 2 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#1976d2' }}>
                              Test Name:
                            </Typography>
                            <Typography variant="body1">{testResult.testName}</Typography>
                          </Box>

                          <Box sx={{ mb: 2 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#1976d2' }}>
                              Test Statistic:
                            </Typography>
                            <Typography variant="body1">{testResult.testStatistic.toFixed(4)}</Typography>
                          </Box>

                          <Box sx={{ mb: 2 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#1976d2' }}>
                              P-value:
                            </Typography>
                            <Typography variant="body1" sx={{ 
                              color: testResult.isSignificant ? '#d32f2f' : '#2e7d32',
                              fontWeight: 600 
                            }}>
                              {testResult.pValue.toFixed(4)}
                            </Typography>
                          </Box>
                        </Grid>

                        <Grid item xs={12} md={6}>
                          {testResult.degreesOfFreedom && (
                            <Box sx={{ mb: 2 }}>
                              <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#1976d2' }}>
                                Degrees of Freedom:
                              </Typography>
                              <Typography variant="body1">{testResult.degreesOfFreedom}</Typography>
                            </Box>
                          )}

                          {testResult.confidenceInterval && (
                            <Box sx={{ mb: 2 }}>
                              <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#1976d2' }}>
                                95% Confidence Interval:
                              </Typography>
                              <Typography variant="body1">
                                [{testResult.confidenceInterval[0].toFixed(4)}, {testResult.confidenceInterval[1].toFixed(4)}]
                              </Typography>
                            </Box>
                          )}

                          {testResult.effectSize && (
                            <Box sx={{ mb: 2 }}>
                              <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#1976d2' }}>
                                Effect Size:
                              </Typography>
                              <Typography variant="body1">{testResult.effectSize.toFixed(4)}</Typography>
                            </Box>
                          )}
                        </Grid>
                      </Grid>

                      <Box sx={{ mt: 4 }}>
                        <Typography variant="h6" sx={{ mb: 2, color: '#2e7d32' }}>
                          Interpretation
                        </Typography>
                        <Alert severity={testResult.isSignificant ? "error" : "success"} sx={{ mb: 3 }}>
                          <Typography variant="body1">
                            {testResult.interpretation}
                          </Typography>
                        </Alert>

                        <Alert severity="info">
                          <Typography variant="body1">
                            {testResult.postHocReason}
                          </Typography>
                        </Alert>
                      </Box>
                    </Paper>
                  )}
                </>
              ) : (
                <Alert severity="warning">
                  <Typography variant="body1">
                    Please complete the Metric Visualization and Planning tabs first to execute a statistical test.
                  </Typography>
                </Alert>
              )}
            </Box>
          </TabPanel>

          {shouldShowPostHocTab && (
            <TabPanel value={tabValue} index={3}>
              <Box>
                <Typography variant="h6" sx={{ mb: 3, color: '#1976d2', fontWeight: 500 }}>
                  Post-Hoc Analysis
                </Typography>

                <Alert severity="info" sx={{ mb: 3 }}>
                  <Typography variant="body1">
                    Post-hoc tests help identify which specific groups differ after a significant overall result.
                  </Typography>
                </Alert>

                <Box sx={{ mb: 3 }}>
                  <Button
                    variant="contained"
                    onClick={executePostHocAnalysis}
                    disabled={isRunningPostHoc}
                    sx={{
                      backgroundColor: '#1976d2',
                      '&:hover': { backgroundColor: '#1565c0' },
                      fontWeight: 500,
                      px: 4,
                      py: 1
                    }}
                  >
                    {isRunningPostHoc ? (
                      <>
                        <CircularProgress size={20} sx={{ mr: 1, color: 'white' }} />
                        Running Post-Hoc Analysis...
                      </>
                    ) : (
                      `Run ${testRecommendation?.postHocMethod || 'Post-Hoc Analysis'}`
                    )}
                  </Button>
                </Box>

                {postHocResults && postHocResults.length > 0 && (
                  <TableContainer component={Paper} sx={{ mb: 3 }}>
                    <Table>
                      <TableHead>
                        <TableRow sx={{ backgroundColor: '#f8f9fa' }}>
                          <TableCell>Group A</TableCell>
                          <TableCell>Group B</TableCell>
                          {postHocResults[0].testStatistic !== undefined && (
                            <TableCell>Test Statistic</TableCell>
                          )}
                          <TableCell>P-value</TableCell>
                          <TableCell>Adjusted P-value</TableCell>
                          <TableCell>Significant</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {postHocResults.map((result, index) => (
                          <TableRow 
                            key={`${result.groupA}-${result.groupB}`}
                            sx={{
                              backgroundColor: result.isSignificant ? '#fff3e0' : 'inherit',
                              '&:hover': {
                                backgroundColor: result.isSignificant ? '#ffe0b2' : '#f5f5f5'
                              }
                            }}
                          >
                            <TableCell sx={{ fontWeight: result.isSignificant ? 600 : 400 }}>
                              {result.groupA}
                            </TableCell>
                            <TableCell sx={{ fontWeight: result.isSignificant ? 600 : 400 }}>
                              {result.groupB}
                            </TableCell>
                            {result.testStatistic !== undefined && (
                              <TableCell sx={{ fontWeight: result.isSignificant ? 600 : 400 }}>
                                {result.testStatistic.toFixed(4)}
                              </TableCell>
                            )}
                            <TableCell sx={{ fontWeight: result.isSignificant ? 600 : 400 }}>
                              {result.pValue.toFixed(4)}
                            </TableCell>
                            <TableCell sx={{ 
                              fontWeight: result.isSignificant ? 600 : 400,
                              color: result.isSignificant ? '#d32f2f' : '#2e7d32'
                            }}>
                              {result.adjustedPValue.toFixed(4)}
                            </TableCell>
                            <TableCell>
                              {result.isSignificant ? (
                                <Typography variant="body2" sx={{ color: '#d32f2f', fontWeight: 600 }}>
                                  ✅ Yes
                                </Typography>
                              ) : (
                                <Typography variant="body2" sx={{ color: '#2e7d32' }}>
                                  ❌ No
                                </Typography>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}

                {postHocResults && postHocResults.length > 0 && (
                  <Box sx={{ mt: 3 }}>
                    <Typography variant="h6" sx={{ mb: 2, color: '#2e7d32' }}>
                      Summary
                    </Typography>
                    <Alert severity={postHocResults.some(r => r.isSignificant) ? "warning" : "success"}>
                      <Typography variant="body1">
                        {(() => {
                          const significantPairs = postHocResults.filter(r => r.isSignificant);
                          if (significantPairs.length === 0) {
                            return "No significant differences were found between any group pairs after correction for multiple comparisons.";
                          } else {
                            const pairNames = significantPairs.map(r => `${r.groupA} vs ${r.groupB}`).join(', ');
                            return `${significantPairs.length} significant difference${significantPairs.length > 1 ? 's' : ''} found: ${pairNames}`;
                          }
                        })()}
                      </Typography>
                    </Alert>
                  </Box>
                )}
              </Box>
            </TabPanel>
          )}
        </Box>
      )}
    </Box>
  );
};

export default React.memo(StatisticalAnalysis); 