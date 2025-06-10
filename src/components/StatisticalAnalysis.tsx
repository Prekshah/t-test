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

interface TestRecommendation {
  testName: string;
  requiresPostHoc: boolean;
  postHocMethod?: string;
  reasoning: string;
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
}

const ReliabilityCheck: React.FC<ReliabilityCheckProps> = ({ group, stats, leveneTest }) => {
  const reliability = checkMeanReliability(stats);
  
  return (
    <Paper sx={{ p: 2, mb: 2, bgcolor: '#f8f9fa' }}>
      <Typography variant="h6" sx={{ mb: 2, color: '#1976d2' }}>
        🚦 Mean Reliability Check: {group}
      </Typography>
      
      <Box sx={{ mb: 2 }}>
        <Typography>
          <strong>Skewness:</strong> {stats.skewness.toFixed(2)}
          <br />
          <strong>Kurtosis:</strong> {stats.kurtosis.toFixed(2)}
          <br />
          <strong>% Trimmed Mean Difference:</strong> {stats.meanDiffPercentage.toFixed(1)}%
          <br />
          <strong>Levene's p-value:</strong> {leveneTest?.pValue.toFixed(4)}
        </Typography>
      </Box>

      <Alert 
        severity={reliability.isReliable ? "success" : "warning"}
        sx={{ mb: 2 }}
      >
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          ✅ Result: The mean is {reliability.isReliable ? "reliable" : "not reliable"}
        </Typography>
        {!reliability.isReliable && (
          <Typography variant="body2" sx={{ mt: 1 }}>
            Reasons:
            <ul>
              {reliability.reasons.map((reason: string, index: number) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
          </Typography>
        )}
      </Alert>

      <Alert 
        severity={leveneTest?.equalVariance ? "success" : "warning"}
      >
        <Typography variant="body1">
          <strong>Variance Test Result (Levene's p-value = {leveneTest?.pValue.toFixed(4)}):</strong> {leveneTest?.equalVariance ? 
            "Variances are equal" : 
            "Variances are unequal"}
        </Typography>
      </Alert>
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
  const workerTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
          reasoning: `• Metric Type: Continuous\n• Mean Reliability: Poor\n• Reliability Issues:\n  ${unreliableReasons.map(reason => '  ' + reason).join('\n')}\n• Number of Groups: 2\n• Appropriate Test: Mann-Whitney U Test (non-parametric, compares medians)\n• Post-hoc Analysis: Not required for two groups`
        };
      } else {
        return {
          testName: "Kruskal-Wallis Test",
          requiresPostHoc: true,
          postHocMethod: "Dunn's Test with Bonferroni correction",
          reasoning: `• Metric Type: Continuous\n• Mean Reliability: Poor\n• Reliability Issues:\n  ${unreliableReasons.map(reason => '  ' + reason).join('\n')}\n• Number of Groups: ${numGroups}\n• Appropriate Test: Kruskal-Wallis Test (non-parametric)\n• Post-hoc Method: Dunn's Test with Bonferroni correction (if Kruskal-Wallis is significant)`
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
  };

  // Handle grouping column change
  const handleGroupingChange = (event: SelectChangeEvent<string>) => {
    setGroupingColumn(event.target.value);
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
        </Box>
      )}
    </Box>
  );
};

export default React.memo(StatisticalAnalysis); 