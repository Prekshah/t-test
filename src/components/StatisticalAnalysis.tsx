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
  BoxProps,
  FormHelperText,
  AlertTitle
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
  cupedApplied?: boolean;
  cupedTheta?: number;
  cupedCovariate?: string;
  cupedOriginalVariance?: number;
  cupedAdjustedVariance?: number;
  cupedVarianceReduction?: number;
}

interface BootstrapResult {
  meanDifferenceCI: [number, number];
  bootstrapPValue: number;
  observedMeanDifference: number;
  reason: string;
  numResamples: number;
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

interface CovariateAnalysis {
  selectedCovariate: string | null;
  correlation: number;
  otherCovariates: Array<{
    column: string;
    correlation: number;
  }>;
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
  const [covariateAnalysis, setCovariateAnalysis] = useState<CovariateAnalysis | null>(null);
  
  // State for statistics
  const [groupStats, setGroupStats] = useState<GroupStats>({});
  const [tabValue, setTabValue] = useState(0);
  const [isCalculating, setIsCalculating] = useState(false);
  const [leveneTest, setLeveneTest] = useState<LeveneTestResult | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [inputsChanged, setInputsChanged] = useState(false);
  const [postHocResults, setPostHocResults] = useState<PostHocResult[] | null>(null);
  const [isRunningPostHoc, setIsRunningPostHoc] = useState(false);
  const [isCovariateListExpanded, setIsCovariateListExpanded] = useState(false);
  const [bootstrapResult, setBootstrapResult] = useState<BootstrapResult | null>(null);
  const workerTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate Pearson correlation coefficient
  const calculatePearsonCorrelation = useCallback((x: number[], y: number[]): number => {
    if (x.length !== y.length || x.length === 0) return 0;
    
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumYY = y.reduce((sum, yi) => sum + yi * yi, 0);
    
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
    
    return denominator === 0 ? 0 : numerator / denominator;
  }, []);

  // Identify eligible covariate columns and select the best one
  const identifyBestCovariate = useCallback((data: DataRow[], metricColumn: string, groupingColumn: string): CovariateAnalysis => {
    console.log('=== AUTOMATIC COVARIATE SELECTION DEBUG ===');
    console.log(`Metric column: ${metricColumn}`);
    console.log(`Grouping column: ${groupingColumn}`);
    
    // Step 1: Find all numeric columns
    const numericColumns: string[] = [];
    
    // Get all column names except metric and grouping
    const potentialColumns = columns.filter(col => col !== metricColumn && col !== groupingColumn);
    console.log(`Potential covariate columns (excluding metric and grouping): ${potentialColumns.join(', ')}`);
    
    // Check which columns are numeric
    potentialColumns.forEach(col => {
      const values = data.map(row => parseFloat(String(row[col]))).filter(val => !isNaN(val));
      const totalRows = data.length;
      const numericRatio = values.length / totalRows;
      
      // Consider column numeric if at least 80% of values are numeric
      if (numericRatio >= 0.8) {
        numericColumns.push(col);
        console.log(`${col}: ${values.length}/${totalRows} numeric values (${(numericRatio * 100).toFixed(1)}%) - ELIGIBLE`);
      } else {
        console.log(`${col}: ${values.length}/${totalRows} numeric values (${(numericRatio * 100).toFixed(1)}%) - NOT ELIGIBLE`);
      }
    });
    
    console.log(`Numeric columns found: ${numericColumns.join(', ')}`);
    
    if (numericColumns.length === 0) {
      console.log('No eligible numeric covariates found');
      return {
        selectedCovariate: null,
        correlation: 0,
        otherCovariates: []
      };
    }
    
    // Step 2: Filter out columns with high correlation with grouping column
    const eligibleColumns: string[] = [];
    const metricValues = data.map(row => parseFloat(String(row[metricColumn]))).filter(val => !isNaN(val));
    
    // Convert grouping column to numeric for correlation calculation
    const uniqueGroups = Array.from(new Set(data.map(row => String(row[groupingColumn]))));
    const groupMapping = Object.fromEntries(uniqueGroups.map((group, index) => [group, index]));
    const groupValues = data.map(row => groupMapping[String(row[groupingColumn])]);
    
    console.log('Filtering columns by correlation with grouping variable...');
    
    numericColumns.forEach(col => {
      const covariateValues = data.map(row => parseFloat(String(row[col]))).filter(val => !isNaN(val));
      
      // Ensure we have the same number of values for correlation calculation
      const minLength = Math.min(covariateValues.length, groupValues.length);
      const covariateSlice = covariateValues.slice(0, minLength);
      const groupSlice = groupValues.slice(0, minLength);
      
      const correlationWithGroup = Math.abs(calculatePearsonCorrelation(covariateSlice, groupSlice));
      
      if (correlationWithGroup <= 0.1) {
        eligibleColumns.push(col);
        console.log(`${col}: correlation with grouping = ${correlationWithGroup.toFixed(4)} - ELIGIBLE`);
      } else {
        console.log(`${col}: correlation with grouping = ${correlationWithGroup.toFixed(4)} - EXCLUDED (too correlated with treatment)`);
      }
    });
    
    console.log(`Final eligible columns: ${eligibleColumns.join(', ')}`);
    
    if (eligibleColumns.length === 0) {
      console.log('No columns remain after filtering for correlation with grouping variable');
      return {
        selectedCovariate: null,
        correlation: 0,
        otherCovariates: []
      };
    }
    
    // Step 3: Calculate correlations with outcome metric and sort
    const correlations: Array<{ column: string; correlation: number }> = [];
    
    console.log('Calculating correlations with outcome metric...');
    
    eligibleColumns.forEach(col => {
      // Get values for both metric and covariate, ensuring they align
      const alignedData = data.map(row => ({
        metric: parseFloat(String(row[metricColumn])),
        covariate: parseFloat(String(row[col]))
      })).filter(item => !isNaN(item.metric) && !isNaN(item.covariate));
      
      if (alignedData.length > 10) { // Minimum sample size for meaningful correlation
        const metricVals = alignedData.map(item => item.metric);
        const covariateVals = alignedData.map(item => item.covariate);
        const correlation = calculatePearsonCorrelation(metricVals, covariateVals);
        
        correlations.push({ column: col, correlation });
        console.log(`${col}: correlation with ${metricColumn} = ${correlation.toFixed(4)} (n=${alignedData.length})`);
      } else {
        console.log(`${col}: insufficient data for correlation (n=${alignedData.length})`);
      }
    });
    
    // Sort by absolute correlation (descending)
    correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
    
    if (correlations.length === 0) {
      console.log('No valid correlations calculated');
      return {
        selectedCovariate: null,
        correlation: 0,
        otherCovariates: []
      };
    }
    
    // Step 4: Select best covariate
    const bestCovariate = correlations[0];
    const otherCovariates = correlations.slice(1);
    
    console.log(`Selected covariate: ${bestCovariate.column} (correlation: ${bestCovariate.correlation.toFixed(4)})`);
    console.log('=== END AUTOMATIC COVARIATE SELECTION DEBUG ===');
    
    return {
      selectedCovariate: bestCovariate.column,
      correlation: bestCovariate.correlation,
      otherCovariates
    };
  }, [columns, calculatePearsonCorrelation]);

  // Reset execution results when inputs change
  const resetExecutionResults = useCallback(() => {
    setTestResult(null);
    setPostHocResults(null);
    setBootstrapResult(null);
    setInputsChanged(true);
    setCovariateAnalysis(null); // Reset covariate analysis when inputs change
    setIsCovariateListExpanded(false); // Reset expanded state when inputs change
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

    // Get all unique values in the column
    const allValues = data.map(row => String(row[column]).trim().toLowerCase());
    const uniqueValues = Array.from(new Set(allValues));
    
    // Filter out empty values
    const nonEmptyValues = uniqueValues.filter(val => val !== '' && val !== 'null' && val !== 'undefined');
    
    console.log(`Analyzing column "${column}":`, {
      totalRows: data.length,
      uniqueValues: nonEmptyValues,
      uniqueCount: nonEmptyValues.length
    });

    // Check if it's categorical data (few unique non-numeric values or binary outcomes)
    let isCategorical = false;

    // Check for common categorical patterns
    const binaryPatterns = [
      ['0', '1'],
      ['yes', 'no'],
      ['true', 'false'],
      ['success', 'failure'],
      ['pass', 'fail'],
      ['male', 'female'],
      ['m', 'f'],
      ['positive', 'negative'],
      ['pos', 'neg'],
      ['high', 'low'],
      ['good', 'bad'],
      ['click', 'no_click'],
      ['convert', 'no_convert'],
      ['purchased', 'not_purchased']
    ];

    // Check if values match binary patterns
    const sortedValues = nonEmptyValues.sort();
    const matchesBinaryPattern = binaryPatterns.some(pattern => {
      const sortedPattern = pattern.sort();
      return sortedValues.length === 2 && 
             sortedValues[0] === sortedPattern[0] && 
             sortedValues[1] === sortedPattern[1];
    });

    // Check if it's a small number of discrete categories (≤ 10 unique values)
    const hasLimitedCategories = nonEmptyValues.length <= 10 && nonEmptyValues.length >= 2;
    
    // Try to parse as numbers
    const numericValues = allValues
      .map(val => parseFloat(val))
      .filter(val => !isNaN(val));

    const allNumeric = numericValues.length === allValues.length;
    
    if (allNumeric && numericValues.length > 0) {
      // Check for proportion data (all values 0-1, and mostly 0s and 1s)
      const isInPropRange = numericValues.every(val => val >= 0 && val <= 1);
      const mostlyBinary = numericValues.filter(val => val === 0 || val === 1).length / numericValues.length > 0.8;
      const isProportionType = isInPropRange && mostlyBinary;
      
      // Check for binary numeric (only 0s and 1s)
      const isBinaryNumeric = numericValues.every(val => val === 0 || val === 1);
      
      isCategorical = isProportionType || isBinaryNumeric || (hasLimitedCategories && numericValues.every(val => val === Math.round(val)));
    } else {
      // Non-numeric data - treat as categorical if limited categories
      isCategorical = matchesBinaryPattern || hasLimitedCategories;
    }

    console.log(`Column "${column}" analysis result:`, {
      isCategorical,
      matchesBinaryPattern,
      hasLimitedCategories,
      allNumeric
    });

    setIsMetricContinuous(!isCategorical);
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
    resetExecutionResults();
  };

  // Handle grouping column change
  const handleGroupingChange = (event: SelectChangeEvent<string>) => {
    setGroupingColumn(event.target.value);
    resetExecutionResults();
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
      // Reset all analysis state when a new file is uploaded
      setFile(file);
      setFileName(file.name);
      
      // Reset data and columns
      setData([]);
      setColumns([]);
      
      // Reset column selections
      setMetricColumn('');
      setGroupingColumn('');
      setIsMetricContinuous(true);
      setCovariateAnalysis(null);
      
      // Reset statistics and results
      setGroupStats({});
      setLeveneTest(null);
      setTestResult(null);
      setPostHocResults(null);
      setBootstrapResult(null);
      
      // Reset UI state
      setTabValue(0);
      setIsCalculating(false);
      setIsRunningTest(false);
      setIsRunningPostHoc(false);
      setInputsChanged(false);
      setIsProcessing(false);
      setShowTabs(false);
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
      
      if (isMetricContinuous) {
        // Process continuous data
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
      } else {
        // Process categorical data - convert to binary format
        // First, determine the "success" category (1) vs "failure" category (0)
        const allMetricValues = data.map((row: DataRow) => String(row[metricColumn] || '').trim().toLowerCase());
        const uniqueMetricValues = Array.from(new Set(allMetricValues)).filter(val => val !== '' && val !== 'null' && val !== 'undefined');
        
        // Define what constitutes a "success" (coded as 1)
        const successValues = ['1', 'yes', 'true', 'success', 'pass', 'positive', 'pos', 'high', 'good', 'click', 'convert', 'purchased'];
        
        let successCategory = uniqueMetricValues.find(val => successValues.includes(val as string));
        
        // If no standard success pattern found, take the first category alphabetically as success
        if (!successCategory && uniqueMetricValues.length === 2) {
          successCategory = uniqueMetricValues.sort()[1]; // Take the second one alphabetically
        } else if (!successCategory && uniqueMetricValues.length > 0) {
          successCategory = uniqueMetricValues[0]; // Take the first unique value
        }
        
        console.log(`Categorical processing: Success category = "${successCategory}", All categories:`, uniqueMetricValues);
        
        data.forEach((row: any) => {
          const group = row[groupingColumn];
          const rawValue = String(row[metricColumn]).trim().toLowerCase();
          
          if (rawValue !== '' && rawValue !== 'null' && rawValue !== 'undefined') {
            // Convert to binary: 1 for success category, 0 for others
            const binaryValue = rawValue === successCategory ? 1 : 0;
            
            if (!groupData[group]) {
              groupData[group] = [];
            }
            groupData[group].push(binaryValue);
          }
        });
      }
      
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
      
      // Automatically identify best covariate for continuous metrics
      if (isMetricContinuous) {
        const analysis = identifyBestCovariate(data, metricColumn, groupingColumn);
        setCovariateAnalysis(analysis);
        setIsCovariateListExpanded(false); // Reset expanded state when new analysis is performed
      } else {
        setCovariateAnalysis(null);
        setIsCovariateListExpanded(false);
      }
    }
  }, [metricColumn, groupingColumn, data, calculateGroupStats, isMetricContinuous, identifyBestCovariate]);

  // Statistical test implementations
  const runTwoProportionZTest = useCallback((group1Data: number[], group2Data: number[]): TestResult => {
    console.log('=== TWO-PROPORTION Z-TEST CALCULATION DEBUG ===');
    console.log(`Group 1 data: [${group1Data.slice(0, 10).join(', ')}...] (${group1Data.length} values)`);
    console.log(`Group 2 data: [${group2Data.slice(0, 10).join(', ')}...] (${group2Data.length} values)`);
    
    const n1 = group1Data.length;
    const n2 = group2Data.length;
    const x1 = group1Data.reduce((a, b) => a + b, 0); // successes in group 1
    const x2 = group2Data.reduce((a, b) => a + b, 0); // successes in group 2
    
    console.log(`Sample sizes: n1=${n1}, n2=${n2}`);
    console.log(`Successes: x1=${x1}, x2=${x2}`);
    
    const p1 = x1 / n1;
    const p2 = x2 / n2;
    const pooledP = (x1 + x2) / (n1 + n2);
    
    console.log(`Proportions: p1=${p1.toFixed(4)}, p2=${p2.toFixed(4)}`);
    console.log(`Pooled proportion: ${pooledP.toFixed(4)}`);
    
    const se = Math.sqrt(pooledP * (1 - pooledP) * (1/n1 + 1/n2));
    const z = (p1 - p2) / se;
    const pValue = 2 * (1 - normalCDF(Math.abs(z)));
    
    console.log(`Standard error: ${se.toFixed(6)}`);
    console.log(`Z-statistic: ${z.toFixed(6)}`);
    console.log(`p-value: ${pValue.toFixed(8)}`);
    console.log('=== END TWO-PROPORTION Z-TEST DEBUG ===');
    
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

  // Bootstrapping implementation for mean comparisons
  const performBootstrap = useCallback((group1Data: number[], group2Data: number[], numResamples: number = 1000): BootstrapResult => {
    console.log('=== BOOTSTRAPPING CALCULATION DEBUG ===');
    console.log(`Group 1 size: ${group1Data.length}, Group 2 size: ${group2Data.length}`);
    console.log(`Number of resamples: ${numResamples}`);
    
    // Calculate observed mean difference
    const mean1 = group1Data.reduce((a, b) => a + b, 0) / group1Data.length;
    const mean2 = group2Data.reduce((a, b) => a + b, 0) / group2Data.length;
    const observedMeanDifference = mean1 - mean2;
    
    console.log(`Observed means: Group 1 = ${mean1.toFixed(6)}, Group 2 = ${mean2.toFixed(6)}`);
    console.log(`Observed mean difference: ${observedMeanDifference.toFixed(6)}`);
    
    // Bootstrap resampling
    const bootstrapDifferences: number[] = [];
    
    for (let i = 0; i < numResamples; i++) {
      // Resample with replacement for each group
      const resample1: number[] = [];
      const resample2: number[] = [];
      
      for (let j = 0; j < group1Data.length; j++) {
        const randomIndex = Math.floor(Math.random() * group1Data.length);
        resample1.push(group1Data[randomIndex]);
      }
      
      for (let j = 0; j < group2Data.length; j++) {
        const randomIndex = Math.floor(Math.random() * group2Data.length);
        resample2.push(group2Data[randomIndex]);
      }
      
      // Calculate mean difference for this resample
      const resampleMean1 = resample1.reduce((a, b) => a + b, 0) / resample1.length;
      const resampleMean2 = resample2.reduce((a, b) => a + b, 0) / resample2.length;
      const resampleDifference = resampleMean1 - resampleMean2;
      
      bootstrapDifferences.push(resampleDifference);
    }
    
    // Sort bootstrap differences for CI calculation
    bootstrapDifferences.sort((a, b) => a - b);
    
    // Calculate 95% confidence interval (2.5th and 97.5th percentiles)
    const lowerIndex = Math.floor(0.025 * numResamples);
    const upperIndex = Math.floor(0.975 * numResamples);
    const meanDifferenceCI: [number, number] = [
      bootstrapDifferences[lowerIndex],
      bootstrapDifferences[upperIndex]
    ];
    
    // Calculate bootstrap p-value
    // Count how many bootstrap differences are as extreme as the observed difference
    const extremeCount = bootstrapDifferences.filter(diff => 
      Math.abs(diff) >= Math.abs(observedMeanDifference)
    ).length;
    const bootstrapPValue = extremeCount / numResamples;
    
    console.log(`Bootstrap CI: [${meanDifferenceCI[0].toFixed(6)}, ${meanDifferenceCI[1].toFixed(6)}]`);
    console.log(`Bootstrap p-value: ${bootstrapPValue.toFixed(6)}`);
    console.log(`Extreme values count: ${extremeCount} out of ${numResamples}`);
    console.log('=== END BOOTSTRAPPING DEBUG ===');
    
    return {
      meanDifferenceCI,
      bootstrapPValue,
      observedMeanDifference,
      reason: '',
      numResamples
    };
  }, []);

  // Check if bootstrapping should be applied
  const shouldApplyBootstrap = useCallback((testResult: TestResult, groupStats: GroupStats): { shouldApply: boolean; reason: string } => {
    // Check conditions for bootstrapping
    const conditions = {
      isContinuous: isMetricContinuous,
      twoGroups: Object.keys(groupStats).length === 2,
      borderlinePValue: testResult.pValue >= 0.04 && testResult.pValue <= 0.06,
      hasSkewness: false
    };
    
    // Check for skewness in either group
    Object.values(groupStats).forEach(stats => {
      if (Math.abs(stats.skewness) > 1.5) {
        conditions.hasSkewness = true;
      }
    });
    
    console.log('=== BOOTSTRAP CONDITIONS CHECK ===');
    console.log('Conditions:', conditions);
    console.log(`Primary test: ${testResult.testName}, p-value: ${testResult.pValue.toFixed(4)}`);
    
    if (!conditions.isContinuous) {
      console.log('❌ Bootstrap not applicable: metric is not continuous');
      return { shouldApply: false, reason: '' };
    }
    
    if (!conditions.twoGroups) {
      console.log('❌ Bootstrap not applicable: not exactly two groups');
      return { shouldApply: false, reason: '' };
    }
    
    if (!conditions.borderlinePValue) {
      console.log(`❌ Bootstrap not applicable: p-value (${testResult.pValue.toFixed(4)}) not in borderline range [0.04, 0.06]`);
      return { shouldApply: false, reason: '' };
    }
    
    if (!conditions.hasSkewness) {
      console.log('❌ Bootstrap not applicable: data not sufficiently skewed');
      return { shouldApply: false, reason: '' };
    }
    
    const reason = `Bootstrapping was applied due to a borderline primary p-value (${testResult.pValue.toFixed(4)}) and skewed data distribution. This provides a more robust confidence interval for the mean difference.`;
    
    console.log('✅ All conditions met for bootstrapping');
    console.log('=== END BOOTSTRAP CONDITIONS CHECK ===');
    
    return { shouldApply: true, reason };
  }, [isMetricContinuous]);

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

  // Function to save test results to a plain text file
  const saveTestResultsToFile = useCallback(async (result: TestResult, postHocResults?: PostHocResult[] | null) => {
    try {
      // Extract scenario name from file name (remove .csv extension)
      const scenarioName = fileName.replace(/\.csv$/i, '') || 'unknown_scenario';
      
      // Get number of groups
      const numGroups = Object.keys(groupStats).length;
      
      // Build summary text
      let summaryLines = [
        `Scenario: ${scenarioName}`,
        `Metric Column: ${metricColumn}`,
        `Grouping Column: ${groupingColumn}`,
        `Number of Groups: ${numGroups}`
      ];

      // Add CUPED information if it was applied
      if (result.cupedApplied) {
        summaryLines.push('\nCUPED Variance Reduction:');
        summaryLines.push(`Original variance: ${result.cupedOriginalVariance?.toFixed(4)}`);
        summaryLines.push(`Adjusted variance: ${result.cupedAdjustedVariance?.toFixed(4)}`);
        summaryLines.push(`Variance reduced by: ${result.cupedVarianceReduction?.toFixed(2)}%`);
        summaryLines.push(`CUPED covariate: ${result.cupedCovariate}`);
        summaryLines.push(`Theta value: ${result.cupedTheta?.toFixed(4)}`);
      }

      // Add test results
      summaryLines.push('\nTest Results:');
      summaryLines.push(`Selected Test: ${result.testName}`);
      summaryLines.push(`Test Statistic: ${result.testStatistic.toFixed(4)}`);
      summaryLines.push(`p-value: ${result.pValue.toFixed(4)}`);
      summaryLines.push(`Interpretation: ${result.isSignificant ? 'Reject' : 'Fail to Reject'} Null Hypothesis`);
      summaryLines.push(`Post-Hoc Test: ${postHocResults && postHocResults.length > 0 ? (testRecommendation?.postHocMethod || 'Post-Hoc Analysis') : 'N/A'}`);
      
      // Add post-hoc details if available
      if (postHocResults && postHocResults.length > 0) {
        summaryLines.push('\nPost-Hoc Results:');
        postHocResults.forEach((result, index) => {
          summaryLines.push(`${index + 1}. ${result.groupA} vs ${result.groupB}: p-adj = ${result.adjustedPValue.toFixed(4)} (${result.isSignificant ? 'Significant' : 'Not Significant'})`);
        });
      }
      
      const summaryText = summaryLines.join('\n');
      const resultFileName = `${scenarioName}_result.txt`;
      
      // Try to save via server API first
      try {
        const response = await fetch('http://localhost:5001/api/save-test-results', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fileName: resultFileName,
            content: summaryText
          })
        });
        
        if (response.ok) {
          const responseData = await response.json();
          console.log(`✅ ${responseData.message}`);
          alert(`✅ Test results saved successfully to ${responseData.filePath}`);
          return;
        } else {
          throw new Error(`Server responded with status: ${response.status}`);
        }
      } catch (serverError) {
        console.warn('Server save failed, falling back to browser download:', serverError);
        
        // Fallback to browser download if server is not available
        const blob = new Blob([summaryText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = resultFileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        console.log(`📥 Test results downloaded as ${resultFileName} (server unavailable)`);
        alert(`📥 Server unavailable. File downloaded to your Downloads folder as ${resultFileName}.\nPlease manually move it to the test_outputs folder.`);
      }
      
    } catch (error) {
      console.error('Error saving test results to file:', error);
      alert('❌ Error saving test results. Please check the console for details.');
    }
  }, [fileName, metricColumn, groupingColumn, groupStats, testRecommendation]);

  // Add CUPED calculation function with enhanced variance tracking
  const calculateCUPED = useCallback((metricData: number[], covariateData: number[]): { 
    adjustedMetric: number[], 
    theta: number,
    originalVariance: number,
    adjustedVariance: number,
    varianceReduction: number 
  } => {
    if (metricData.length !== covariateData.length) {
      throw new Error('Metric and covariate data must have the same length');
    }

    // Calculate theta (covariance / variance)
    const metricMean = metricData.reduce((a, b) => a + b, 0) / metricData.length;
    const covariateMean = covariateData.reduce((a, b) => a + b, 0) / covariateData.length;
    
    const covariance = metricData.reduce((sum, val, i) => 
      sum + (val - metricMean) * (covariateData[i] - covariateMean), 0) / metricData.length;
    
    const covariateVariance = covariateData.reduce((sum, val) => 
      sum + Math.pow(val - covariateMean, 2), 0) / covariateData.length;
    
    const theta = covariance / covariateVariance;

    // Calculate adjusted metric
    const adjustedMetric = metricData.map((val, i) => 
      val - theta * (covariateData[i] - covariateMean)
    );

    // Calculate variances
    const originalVar = metricData.reduce((sum, val) => sum + Math.pow(val - metricMean, 2), 0) / metricData.length;
    
    const adjustedMean = adjustedMetric.reduce((a, b) => a + b, 0) / adjustedMetric.length;
    const adjustedVar = adjustedMetric.reduce((sum, val) => sum + Math.pow(val - adjustedMean, 2), 0) / adjustedMetric.length;
    
    const varianceReduction = ((originalVar - adjustedVar) / originalVar) * 100;

    return { 
      adjustedMetric, 
      theta, 
      originalVariance: originalVar,
      adjustedVariance: adjustedVar,
      varianceReduction 
    };
  }, []);

  // Modify executeStatisticalTest to handle automatic CUPED
  const executeStatisticalTest = useCallback(() => {
    if (!testRecommendation || !data.length || !metricColumn || !groupingColumn) return;

    setIsRunningTest(true);

    try {
      const groupData: { [key: string]: number[] } = {};
      let cupedResult: { 
        adjustedMetric: number[], 
        theta: number, 
        originalVariance: number,
        adjustedVariance: number,
        varianceReduction: number 
      } | null = null;
      
      // Process data and apply CUPED if applicable
      if (isMetricContinuous && covariateAnalysis?.selectedCovariate) {
        console.log(`Applying CUPED with automatically selected covariate: ${covariateAnalysis.selectedCovariate}`);
        
        // Extract metric and covariate data in aligned fashion
        const alignedData = data.map(row => ({
          metric: parseFloat(String(row[metricColumn])),
          covariate: parseFloat(String(row[covariateAnalysis.selectedCovariate!])),
          group: String(row[groupingColumn])
        })).filter(item => !isNaN(item.metric) && !isNaN(item.covariate));
        
        if (alignedData.length > 0) {
          try {
            const metricData = alignedData.map(item => item.metric);
            const covariateData = alignedData.map(item => item.covariate);
            cupedResult = calculateCUPED(metricData, covariateData);
            console.log(`CUPED applied successfully. Variance reduction: ${cupedResult.varianceReduction.toFixed(2)}%`);
          } catch (error) {
            console.error('Error calculating CUPED:', error);
            cupedResult = null;
          }
        }
      }

      // Process data for each group
      if (cupedResult) {
        // Use CUPED-adjusted metric
        const alignedData = data.map(row => ({
          metric: parseFloat(String(row[metricColumn])),
          covariate: parseFloat(String(row[covariateAnalysis!.selectedCovariate!])),
          group: String(row[groupingColumn])
        })).filter(item => !isNaN(item.metric) && !isNaN(item.covariate));
        
        alignedData.forEach((item, index) => {
          const adjustedValue = cupedResult!.adjustedMetric[index];
          if (!groupData[item.group]) {
            groupData[item.group] = [];
          }
          groupData[item.group].push(adjustedValue);
        });
      } else {
        // Use original metric
        data.forEach((row: any) => {
          const group = row[groupingColumn];
          let value: number;
          
          if (isMetricContinuous) {
            value = parseFloat(row[metricColumn]);
          } else {
            // Handle categorical data
            const rawValue = String(row[metricColumn]).trim().toLowerCase();
            const allMetricValues = data.map((r: DataRow) => String(r[metricColumn] || '').trim().toLowerCase());
            const uniqueMetricValues = Array.from(new Set(allMetricValues)).filter(val => val !== '' && val !== 'null' && val !== 'undefined');
            
            const successValues = ['1', 'yes', 'true', 'success', 'pass', 'positive', 'pos', 'high', 'good', 'click', 'convert', 'purchased'];
            let successCategory = uniqueMetricValues.find(val => successValues.includes(val as string));
            
            if (!successCategory && uniqueMetricValues.length === 2) {
              successCategory = uniqueMetricValues.sort()[1];
            } else if (!successCategory && uniqueMetricValues.length > 0) {
              successCategory = uniqueMetricValues[0];
            }
            
            value = rawValue === successCategory ? 1 : 0;
          }
          
          if (!isNaN(value)) {
            if (!groupData[group]) {
              groupData[group] = [];
            }
            groupData[group].push(value);
          }
        });
      }

      // Execute the appropriate test based on testRecommendation
      let result: TestResult;
      
      if (testRecommendation.testName === "Two-Sample t-Test" || testRecommendation.testName === "Welch's t-Test") {
        const groups = Object.keys(groupData);
        if (groups.length !== 2) {
          throw new Error('Two-sample test requires exactly two groups');
        }
        
        result = runTwoSampleTTest(
          groupData[groups[0]],
          groupData[groups[1]],
          testRecommendation.testName === "Two-Sample t-Test"
        );
      } else if (testRecommendation.testName === "One-way ANOVA") {
        result = runOneWayANOVA(groupData);
      } else if (testRecommendation.testName === "Welch's ANOVA") {
        result = runWelchsANOVA(groupData);
      } else if (testRecommendation.testName === "Mann-Whitney U Test") {
        const groups = Object.keys(groupData);
        if (groups.length !== 2) {
          throw new Error('Mann-Whitney U test requires exactly two groups');
        }
        
        result = runMannWhitneyUTest(groupData[groups[0]], groupData[groups[1]]);
      } else if (testRecommendation.testName === "Kruskal-Wallis Test") {
        result = runKruskalWallisTest(groupData);
      } else if (testRecommendation.testName === "Two-Proportion Z-Test") {
        const groups = Object.keys(groupData);
        if (groups.length !== 2) {
          throw new Error('Two-proportion test requires exactly two groups');
        }
        
        result = runTwoProportionZTest(groupData[groups[0]], groupData[groups[1]]);
      } else if (testRecommendation.testName === "Chi-Square Test for Independence") {
        result = runChiSquareTest(groupData);
      } else {
        throw new Error(`Unsupported test type: ${testRecommendation.testName}`);
      }

      // Add CUPED information to result if applicable
      if (cupedResult && covariateAnalysis?.selectedCovariate) {
        result.cupedApplied = true;
        result.cupedTheta = cupedResult.theta;
        result.cupedCovariate = covariateAnalysis.selectedCovariate;
        result.cupedOriginalVariance = cupedResult.originalVariance;
        result.cupedAdjustedVariance = cupedResult.adjustedVariance;
        result.cupedVarianceReduction = cupedResult.varianceReduction;
      }

      setTestResult(result);
      markTestExecuted();

      // Check if bootstrapping should be applied
      if (result && Object.keys(groupStats).length > 0) {
        const bootstrapCheck = shouldApplyBootstrap(result, groupStats);
        if (bootstrapCheck.shouldApply) {
          console.log('🎯 Bootstrapping conditions met - running bootstrap analysis');
          
          // Get the two groups for bootstrapping
          const groupNames = Object.keys(groupData);
          if (groupNames.length === 2) {
            const group1Data = groupData[groupNames[0]];
            const group2Data = groupData[groupNames[1]];
            
            // Perform bootstrapping
            const bootstrapResult = performBootstrap(group1Data, group2Data);
            bootstrapResult.reason = bootstrapCheck.reason;
            
            setBootstrapResult(bootstrapResult);
            console.log('✅ Bootstrap analysis completed and results stored');
          }
        } else {
          // Clear any previous bootstrap results
          setBootstrapResult(null);
          console.log('❌ Bootstrap conditions not met - clearing previous results');
        }
      }
    } catch (error) {
      console.error('Error executing statistical test:', error);
      setTestResult(null);
    } finally {
      setIsRunningTest(false);
    }
  }, [testRecommendation, data, metricColumn, groupingColumn, isMetricContinuous, covariateAnalysis, calculateCUPED, runTwoSampleTTest, runOneWayANOVA, runWelchsANOVA, runMannWhitneyUTest, runKruskalWallisTest, runTwoProportionZTest, runChiSquareTest, markTestExecuted]);

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
    console.log('=== POST-HOC EXECUTION CONDITIONS ===');
    console.log('testRecommendation:', testRecommendation?.testName);
    console.log('data.length:', data.length);
    console.log('metricColumn:', metricColumn);
    console.log('groupingColumn:', groupingColumn);
    console.log('testResult?.isSignificant:', testResult?.isSignificant);
    
    if (!testRecommendation || !data.length || !metricColumn || !groupingColumn || !testResult?.isSignificant) {
      console.log('❌ Post-hoc analysis conditions not met - early return');
      return;
    }
    
    console.log('✅ All conditions met - proceeding with post-hoc analysis');

    setIsRunningPostHoc(true);

    try {
      const groupData: { [key: string]: number[] } = {};
      
      console.log('=== POST-HOC DATA PROCESSING DEBUG ===');
      console.log('Test recommendation:', testRecommendation.testName);
      console.log('Is metric continuous:', isMetricContinuous);
      console.log('Metric column:', metricColumn);
      console.log('Grouping column:', groupingColumn);
      
      if (isMetricContinuous) {
        // Process continuous data
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
      } else {
        // Process categorical data - convert to binary format
        const allMetricValues = data.map((row: DataRow) => String(row[metricColumn] || '').trim().toLowerCase());
        const uniqueMetricValues = Array.from(new Set(allMetricValues)).filter(val => val !== '' && val !== 'null' && val !== 'undefined');
        
        // Define what constitutes a "success" (coded as 1)
        const successValues = ['1', 'yes', 'true', 'success', 'pass', 'positive', 'pos', 'high', 'good', 'click', 'convert', 'purchased'];
        
        let successCategory = uniqueMetricValues.find(val => successValues.includes(val as string));
        
        // If no standard success pattern found, take the first category alphabetically as success
        if (!successCategory && uniqueMetricValues.length === 2) {
          successCategory = uniqueMetricValues.sort()[1]; // Take the second one alphabetically
        } else if (!successCategory && uniqueMetricValues.length > 0) {
          successCategory = uniqueMetricValues[0]; // Take the first unique value
        }
        
        console.log(`Categorical processing for post-hoc: Success category = "${successCategory}", All categories:`, uniqueMetricValues);
        
        data.forEach((row) => {
          const group = String(row[groupingColumn]);
          const rawValue = String(row[metricColumn] || '').trim().toLowerCase();
          
          if (rawValue !== '' && rawValue !== 'null' && rawValue !== 'undefined') {
            // Convert to binary: 1 for success category, 0 for others
            const binaryValue = rawValue === successCategory ? 1 : 0;
            
            if (!groupData[group]) {
              groupData[group] = [];
            }
            groupData[group].push(binaryValue);
          }
        });
      }
      
      // Log group data summary
      console.log('Group data processed:');
      Object.keys(groupData).forEach(group => {
        console.log(`  ${group}: ${groupData[group].length} values, first 5: [${groupData[group].slice(0, 5).join(', ')}]`);
      });
      console.log('=== END POST-HOC DATA PROCESSING DEBUG ===');

      let results: PostHocResult[] = [];

      console.log('Running post-hoc analysis for:', testRecommendation.testName);

      switch (testRecommendation.testName) {
        case "One-way ANOVA":
          console.log('Executing Tukey HSD...');
          results = runTukeyHSD(groupData);
          break;
        case "Welch's ANOVA":
          console.log('Executing Games-Howell...');
          results = runGamesHowell(groupData);
          break;
        case "Kruskal-Wallis Test":
          console.log('Executing Dunn Test...');
          results = runDunnTest(groupData);
          break;
        case "Chi-Square Test for Independence":
          console.log('Executing Pairwise Proportion Tests...');
          results = runPairwiseProportionTests(groupData);
          break;
        default:
          console.error(`Post-hoc analysis not implemented for ${testRecommendation.testName}`);
          throw new Error(`Post-hoc analysis not implemented for ${testRecommendation.testName}`);
      }

      console.log('Post-hoc results:', results);
      setPostHocResults(results);
    } catch (error) {
      console.error('Error executing post-hoc analysis:', error);
      alert(`Error executing post-hoc analysis: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsRunningPostHoc(false);
    }
  }, [testRecommendation, data, metricColumn, groupingColumn, testResult, runTukeyHSD, runGamesHowell, runDunnTest, runPairwiseProportionTests, saveTestResultsToFile]);

  return (
    <Box sx={{ width: '100%', typography: 'body1', p: 3, maxWidth: '1200px', mx: 'auto' }}>
      <Box>
        <Box
          component="label"
          onDragOver={(e: React.DragEvent<HTMLDivElement>) => e.preventDefault()}
          onDrop={(e: React.DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            const file = e.dataTransfer?.files[0];
            if (file) {
              // Reset all analysis state when a new file is uploaded via drag & drop
              setFile(file);
              setFileName(file.name);
              
              // Reset data and columns
              setData([]);
              setColumns([]);
              
              // Reset column selections
              setMetricColumn('');
              setGroupingColumn('');
              setIsMetricContinuous(true);
              setCovariateAnalysis(null);
              
              // Reset statistics and results
              setGroupStats({});
              setLeveneTest(null);
              setTestResult(null);
              setPostHocResults(null);
              setBootstrapResult(null);
              
              // Reset UI state
              setTabValue(0);
              setIsCalculating(false);
              setIsRunningTest(false);
              setIsRunningPostHoc(false);
              setInputsChanged(false);
              setIsProcessing(false);
              setShowTabs(false);
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

              {isMetricContinuous && covariateAnalysis && (
                <Paper sx={{ p: 3, mb: 2, bgcolor: '#f0f8ff', border: '1px solid #1976d2' }}>
                  <Typography variant="h6" sx={{ mb: 2, color: '#1976d2', fontWeight: 600 }}>
                    🎯 Automatic CUPED Covariate Selection
                  </Typography>
                  
                  {covariateAnalysis.selectedCovariate ? (
                    <Box>
                      <Alert severity="success" sx={{ mb: 2 }}>
                        <Typography variant="body1" sx={{ fontWeight: 500 }}>
                          <strong>Automatically selected CUPED covariate:</strong> {covariateAnalysis.selectedCovariate}
                          <br />
                          <strong>Correlation with outcome metric:</strong> {covariateAnalysis.correlation.toFixed(4)}
                        </Typography>
                      </Alert>
                      
                      {covariateAnalysis.otherCovariates.length > 0 && (
                        <Box sx={{ mt: 2 }}>
                          <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>
                            Other potential covariates:
                          </Typography>
                          <Box sx={{ ml: 2 }}>
                            {(isCovariateListExpanded 
                              ? covariateAnalysis.otherCovariates 
                              : covariateAnalysis.otherCovariates.slice(0, 5)
                            ).map((covariate, index) => (
                              <Typography key={index} variant="body2" sx={{ color: '#666' }}>
                                • {covariate.column}: {covariate.correlation.toFixed(4)}
                              </Typography>
                            ))}
                            
                            {covariateAnalysis.otherCovariates.length > 5 && (
                              <Typography 
                                variant="body2" 
                                sx={{ 
                                  color: '#1976d2', 
                                  fontStyle: 'italic',
                                  cursor: 'pointer',
                                  textDecoration: 'underline',
                                  '&:hover': {
                                    color: '#1565c0'
                                  }
                                }}
                                onClick={() => setIsCovariateListExpanded(!isCovariateListExpanded)}
                              >
                                {isCovariateListExpanded 
                                  ? '▼ Show less' 
                                  : `▶ ... and ${covariateAnalysis.otherCovariates.length - 5} more`
                                }
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      )}
                    </Box>
                  ) : (
                    <Alert severity="info">
                      <Typography variant="body1">
                        No suitable covariate columns found for CUPED analysis.
                        <br />
                        Requirements: Numeric columns with correlation &lt; 0.1 with grouping variable and sufficient correlation with outcome metric.
                      </Typography>
                    </Alert>
                  )}
                </Paper>
              )}

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
                      {testResult.cupedApplied && (
                        <Alert severity="info" sx={{ mb: 3 }}>
                          <Typography variant="body1">
                            CUPED applied using covariate: {testResult.cupedCovariate}
                            <br />
                            Theta (θ): {testResult.cupedTheta?.toFixed(4)}
                            <br />
                            <br />
                            CUPED Variance Reduction Summary:
                            <br />
                            - Original variance (raw metric): {testResult.cupedOriginalVariance?.toFixed(2)}
                            <br />
                            - Adjusted variance (CUPED metric): {testResult.cupedAdjustedVariance?.toFixed(2)}
                            <br />
                            - Variance reduced by: {testResult.cupedVarianceReduction?.toFixed(2)}%
                          </Typography>
                        </Alert>
                      )}
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

                      {/* Bootstrap Results Section */}
                      {bootstrapResult && (
                        <Box sx={{ mt: 4 }}>
                          <Typography variant="h6" sx={{ mb: 2, color: '#ff6f00', fontWeight: 600 }}>
                            🔄 Bootstrap Validation Results
                          </Typography>
                          
                          <Alert severity="warning" sx={{ mb: 3 }}>
                            <AlertTitle sx={{ fontWeight: 600 }}>Bootstrap Analysis Applied</AlertTitle>
                            <Typography variant="body1">
                              {bootstrapResult.reason}
                            </Typography>
                          </Alert>

                          <Paper sx={{ p: 3, bgcolor: '#fff3e0', border: '1px solid #ff6f00' }}>
                            <Grid container spacing={3}>
                              <Grid item xs={12} md={6}>
                                <Box sx={{ mb: 2 }}>
                                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#ff6f00' }}>
                                    Bootstrap 95% Confidence Interval:
                                  </Typography>
                                  <Typography variant="body1" sx={{ fontWeight: 500 }}>
                                    [{bootstrapResult.meanDifferenceCI[0].toFixed(4)}, {bootstrapResult.meanDifferenceCI[1].toFixed(4)}]
                                  </Typography>
                                </Box>

                                <Box sx={{ mb: 2 }}>
                                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#ff6f00' }}>
                                    Bootstrap P-value:
                                  </Typography>
                                  <Typography variant="body1" sx={{ 
                                    fontWeight: 600,
                                    color: bootstrapResult.bootstrapPValue < 0.05 ? '#d32f2f' : '#2e7d32'
                                  }}>
                                    {bootstrapResult.bootstrapPValue.toFixed(4)}
                                  </Typography>
                                </Box>
                              </Grid>

                              <Grid item xs={12} md={6}>
                                <Box sx={{ mb: 2 }}>
                                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#ff6f00' }}>
                                    Observed Mean Difference:
                                  </Typography>
                                  <Typography variant="body1">
                                    {bootstrapResult.observedMeanDifference.toFixed(4)}
                                  </Typography>
                                </Box>

                                <Box sx={{ mb: 2 }}>
                                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#ff6f00' }}>
                                    Bootstrap Resamples:
                                  </Typography>
                                  <Typography variant="body1">
                                    {bootstrapResult.numResamples.toLocaleString()}
                                  </Typography>
                                </Box>
                              </Grid>
                            </Grid>

                            <Box sx={{ mt: 3 }}>
                              <Alert severity="info">
                                <Typography variant="body2">
                                  <strong>Interpretation:</strong> The bootstrap confidence interval provides a robust estimate of the mean difference that doesn't rely on distributional assumptions. 
                                  {bootstrapResult.meanDifferenceCI[0] > 0 || bootstrapResult.meanDifferenceCI[1] < 0 
                                    ? " Since the confidence interval does not include zero, this suggests a significant difference between groups."
                                    : " Since the confidence interval includes zero, this suggests no significant difference between groups."
                                  }
                                </Typography>
                              </Alert>
                            </Box>
                                                     </Paper>
                         </Box>
                       )}

                      {/* Export Results Button - Only show if Post-Hoc tab is not displayed */}
                      {!shouldShowPostHocTab && (
                        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}>
                          <Button
                            variant="contained"
                            onClick={() => testResult && saveTestResultsToFile(testResult, postHocResults)}
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
                            Export Results to File
                          </Button>
                        </Box>
                      )}
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
                  <>
                    {/* Multiple Comparison Correction Summary */}
                    <Paper sx={{ p: 3, mb: 3, bgcolor: '#f8f9fa', border: '1px solid #e0e0e0' }}>
                      <Typography variant="h6" sx={{ mb: 2, color: '#1976d2', fontWeight: 600 }}>
                        📊 Multiple Comparison Correction Details
                      </Typography>
                      
                      {(() => {
                        // Calculate unique groups from post-hoc results
                        const uniqueGroups = new Set<string>();
                        postHocResults.forEach(result => {
                          uniqueGroups.add(result.groupA);
                          uniqueGroups.add(result.groupB);
                        });
                        const k = uniqueGroups.size;
                        const numComparisons = (k * (k - 1)) / 2;
                        const alpha = 0.05;
                        const bonferroniAlpha = alpha / numComparisons;
                        
                        return (
                          <Box>
                            <Typography variant="body1" sx={{ mb: 2, lineHeight: 1.6 }}>
                              <strong>Performing post-hoc analysis across {k} groups:</strong>
                            </Typography>
                            
                            <Box sx={{ ml: 2, mb: 2 }}>
                              <Typography variant="body2" sx={{ mb: 1 }}>
                                • <strong>Total pairwise comparisons:</strong> {numComparisons}
                              </Typography>
                              <Typography variant="body2" sx={{ mb: 1 }}>
                                • <strong>Original significance level (α):</strong> 0.05
                              </Typography>
                              <Typography variant="body2" sx={{ mb: 1 }}>
                                • <strong>Bonferroni-adjusted α:</strong> {bonferroniAlpha.toFixed(4)}
                              </Typography>
                            </Box>
                            
                            <Alert severity="info" sx={{ mt: 2 }}>
                              <Typography variant="body2">
                                <strong>Why correction is needed:</strong> When performing multiple comparisons, the chance of finding at least one "significant" result by chance alone increases. 
                                {testRecommendation?.postHocMethod?.includes('Tukey') || testRecommendation?.postHocMethod?.includes('Games-Howell') 
                                  ? ` ${testRecommendation.postHocMethod} already includes built-in correction for multiple comparisons.`
                                  : ` The Bonferroni correction controls the family-wise error rate by dividing α by the number of comparisons.`
                                }
                              </Typography>
                            </Alert>
                          </Box>
                        );
                      })()}
                    </Paper>

                    {/* Post-Hoc Results Table */}
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
                            <TableCell>Significant?</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                          {postHocResults.map((result, index) => {
                            // Calculate correction threshold
                            const uniqueGroups = new Set<string>();
                            postHocResults.forEach(r => {
                              uniqueGroups.add(r.groupA);
                              uniqueGroups.add(r.groupB);
                            });
                            const k = uniqueGroups.size;
                            const numComparisons = (k * (k - 1)) / 2;
                            const bonferroniAlpha = 0.05 / numComparisons;
                            const meetsBonferroniThreshold = result.adjustedPValue < bonferroniAlpha;
                            
                            return (
                          <TableRow 
                            key={`${result.groupA}-${result.groupB}`}
                            sx={{
                                  backgroundColor: result.isSignificant ? '#e8f5e8' : 'inherit',
                              '&:hover': {
                                    backgroundColor: result.isSignificant ? '#d4edda' : '#f5f5f5'
                                  },
                                  borderLeft: result.isSignificant ? '4px solid #28a745' : '4px solid transparent'
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
                                  color: result.isSignificant ? '#28a745' : '#6c757d'
                            }}>
                              {result.adjustedPValue.toFixed(4)}
                                  {meetsBonferroniThreshold && (
                                    <Typography variant="caption" sx={{ display: 'block', color: '#28a745', fontWeight: 500 }}>
                                      (&lt; {bonferroniAlpha.toFixed(4)})
                                    </Typography>
                                  )}
                            </TableCell>
                            <TableCell>
                              {result.isSignificant ? (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                      <Typography variant="body2" sx={{ color: '#28a745', fontWeight: 600 }}>
                                  ✅ Yes
                                </Typography>
                                      <Typography variant="caption" sx={{ color: '#28a745', fontStyle: 'italic' }}>
                                        (Significant)
                                      </Typography>
                                    </Box>
                              ) : (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                      <Typography variant="body2" sx={{ color: '#6c757d' }}>
                                  ❌ No
                                </Typography>
                                      <Typography variant="caption" sx={{ color: '#6c757d', fontStyle: 'italic' }}>
                                        (Not significant)
                                      </Typography>
                                    </Box>
                              )}
                            </TableCell>
                          </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  </>
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

                    {/* Export Results Button */}
                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}>
                      <Button
                        variant="contained"
                        onClick={() => testResult && saveTestResultsToFile(testResult, postHocResults)}
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
                        Export Complete Results to File
                      </Button>
                    </Box>
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