import React, { useState, useRef, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select, { SelectChangeEvent } from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Grid from '@mui/material/Grid';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Button from '@mui/material/Button';
import { styled } from '@mui/material/styles';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Chip from '@mui/material/Chip';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Chart } from 'react-chartjs-2';
import jStat from 'jstat';
import Papa from 'papaparse';
import { useDropzone } from 'react-dropzone';
import FormHelperText from '@mui/material/FormHelperText';
import { Divider } from '@mui/material';
import { BoxPlotController, BoxAndWiskers } from '@sgratzl/chartjs-chart-boxplot';
import type { IBoxPlot, BoxPlotControllerDatasetOptions } from '@sgratzl/chartjs-chart-boxplot';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  BoxPlotController,
  BoxAndWiskers
);

interface JStatMethods {
  mean(arr: number[]): number;
  stdev(arr: number[], flag?: boolean): number;
  studentt: {
    cdf(x: number, df: number): number;
  };
  centralF: {
    cdf(x: number, df1: number, df2: number): number;
  };
  quartiles(arr: number[]): number[];
  median(arr: number[]): number;
}

const jStatTyped = jStat as unknown as JStatMethods;

interface GroupStats {
  mean: number;
  stdDev: number;
  sampleSize: number;
  values: number[];
}

interface ConfidenceInterval {
  lower: number;
  upper: number;
}

interface LeveneTestResult {
  pValue: number;
  equalVariance: boolean;
  testUsed: 'Student' | 'Welch';
}

interface PairwiseComparison {
  controlGroup: string;
  treatmentGroup: string;
  leveneTest: LeveneTestResult;
  tStatistic: number;
  degreesOfFreedom: number;
  pValue: number;
  groupStats: Record<string, GroupStats>;
  conclusion: string;
  interpretation: string;
  confidenceInterval?: ConfidenceInterval;
  meanDifference: number;
  stdDevDifference?: number;
  adjustedAlpha: number;
  testType: 'One-Sample T-Test' | 'Independent T-Test' | 'Paired T-Test';
}

interface TestResult {
  testType: 'One-Sample T-Test' | 'Independent T-Test' | 'Paired T-Test';
  metricType: 'continuous' | 'binary';
  significanceLevel: number;
  adjustedAlpha: number;
  numberOfComparisons: number;
  comparisons: PairwiseComparison[];
}

interface TTestProps {
  data?: Record<string, any>[];
  columns?: string[];
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`t-test-tabpanel-${index}`}
      aria-labelledby={`t-test-tab-${index}`}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

const UploadArea = styled(Paper)(({ theme }) => ({
  border: '2px dashed #ccc',
  borderRadius: theme.shape.borderRadius,
  padding: theme.spacing(4),
  textAlign: 'center',
  marginBottom: theme.spacing(3),
  cursor: 'pointer',
  transition: 'all 0.3s ease',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: theme.spacing(2),
  '&:hover': {
    borderColor: '#666',
    backgroundColor: '#f9f9f9',
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

// Helper function to calculate mean
const calculateMean = (data: number[]): number => {
  if (data.length === 0) return 0;
  return data.reduce((sum, val) => sum + val, 0) / data.length;
};

interface ChartDataset {
  label: string;
  data: number[];
  backgroundColor: string[];
  borderColor: string[];
  borderWidth: number;
  type?: 'bar' | 'boxplot';  // Add type for mixed charts
}

interface ChartData {
  labels: string[];
  datasets: ChartDataset[];
}

interface TooltipItem {
  dataIndex: number;
  dataset: {
    label: string;
    data: number[];
  };
}

const CONTROL_GROUP_COLOR = 'rgba(54, 162, 235, 0.7)';
const TREATMENT_GROUP_COLOR = 'rgba(255, 99, 132, 0.7)';
const CONTROL_GROUP_BORDER = 'rgba(54, 162, 235, 1)';
const TREATMENT_GROUP_BORDER = 'rgba(255, 99, 132, 1)';

const calculateBoxPlotStats = (data: number[]) => {
  const sorted = [...data].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const median = sorted[Math.floor(sorted.length * 0.5)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const min = Math.max(q1 - 1.5 * iqr, sorted[0]);
  const max = Math.min(q3 + 1.5 * iqr, sorted[sorted.length - 1]);
  
  return { min, q1, median, q3, max };
};

interface BoxPlotData {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers: number[];
}

// Function to calculate histogram bins
const calculateHistogramBins = (data: number[], binCount = 10) => {
  if (data.length === 0) return { bins: [], counts: [] };
  
  const min = Math.min(...data);
  const max = Math.max(...data);
  const binWidth = (max - min) / binCount;
  
  // Create bin edges
  const bins = Array.from({ length: binCount + 1 }, (_, i) => min + i * binWidth);
  
  // Initialize counts
  const counts = Array(binCount).fill(0);
  
  // Count values in each bin
  data.forEach(value => {
    const binIndex = Math.min(Math.floor((value - min) / binWidth), binCount - 1);
    counts[binIndex]++;
  });
  
  // Convert to percentages
  const percentages = counts.map(count => (count / data.length) * 100);
  
  return {
    bins,
    counts: percentages,
    binWidth
  };
};

// Function to format bin labels
const formatBinLabel = (value: number) => {
  return value.toFixed(1);
};

const TTest: React.FC<TTestProps> = ({ data = [], columns = [] }) => {
  const [tabValue, setTabValue] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<{ data: Record<string, any>[]; columns: string[] } | null>(null);
  const [testType, setTestType] = useState<'independent' | 'paired' | 'one-sample'>('independent');
  const [metricColumn, setMetricColumn] = useState('');
  const [groupingColumn, setGroupingColumn] = useState('');
  const [controlGroup, setControlGroup] = useState('');
  const [treatmentGroups, setTreatmentGroups] = useState<string[]>([]);
  const [availableGroups, setAvailableGroups] = useState<string[]>([]);
  const [populationMean, setPopulationMean] = useState(0);
  const [significanceLevel, setSignificanceLevel] = useState(0.05);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [metricType, setMetricType] = useState<'continuous' | 'binary'>('continuous');
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [inputsChanged, setInputsChanged] = useState(false); // Track if inputs have changed since last test
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files[0]) {
      resetExecutionResults(); // Reset results when file changes
      setFile(files[0]);
      analyzeFile(files[0]);
    }
  };

  // Completely reset execution results and mark inputs as changed
  const resetExecutionResults = () => {
    setResult(null);
    setChartData(null);
    setError(null);
    setInputsChanged(true);
  };

  // Mark that test has been run and inputs are up to date
  const markTestExecuted = () => {
    setInputsChanged(false);
  };

  // Modify tab change handler - don't reset on tab change, only on input change
  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  // Modify input change handlers to reset results and mark inputs as changed
  const handleTestTypeChange = (event: SelectChangeEvent) => {
    resetExecutionResults();
    setTestType(event.target.value as 'independent' | 'paired' | 'one-sample');
    setControlGroup('');
    setTreatmentGroups([]);
  };

  const handleMetricColumnChange = (event: SelectChangeEvent) => {
    resetExecutionResults();
    const column = event.target.value;
    setMetricColumn(column);
    setResult(null);

    // Determine metric type
    if (parsedData) {
      const values = parsedData.data.map(row => row[column]);
      const uniqueValues = new Set(values);
      setMetricType(uniqueValues.size <= 2 ? 'binary' : 'continuous');
    }
  };

  const handleGroupingColumnChange = (event: SelectChangeEvent) => {
    resetExecutionResults();
    const column = event.target.value;
    setGroupingColumn(column);
    setResult(null);

    if (parsedData) {
      const groups = Array.from(new Set(parsedData.data.map(row => row[column])));
      setAvailableGroups(groups);
      
      if (groups.length === 2) {
        // Automatically set first group as control and second as treatment
        setControlGroup(groups[0]);
        setTreatmentGroups([groups[1]]);
      } else {
        // Reset selections for manual control group choice
        setControlGroup('');
        setTreatmentGroups([]);
      }
    }
  };

  const handleControlGroupChange = (event: SelectChangeEvent) => {
    resetExecutionResults();
    const selectedControl = event.target.value;
    setControlGroup(selectedControl);
    // Automatically set all other groups as treatment groups
    setTreatmentGroups(availableGroups.filter(group => group !== selectedControl));
  };

  const handleSignificanceLevelChange = (event: SelectChangeEvent) => {
    resetExecutionResults();
    setSignificanceLevel(parseFloat(event.target.value as string));
  };

  const handlePopulationMeanChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    resetExecutionResults();
    setPopulationMean(parseFloat(event.target.value));
  };

  const calculateLeveneTest = (group1Values: number[], group2Values: number[]): LeveneTestResult => {
    const leveneStatistic = calculateLeveneStatistic(group1Values, group2Values);
    const levenePValue = calculateLevenePValue(leveneStatistic, group1Values, group2Values);
    const equalVariance = levenePValue > significanceLevel;

    return {
      pValue: levenePValue,
      equalVariance,
      testUsed: equalVariance ? 'Student' : 'Welch'
    };
  };

  const performPairwiseComparison = (
    controlValues: number[],
    treatmentValues: number[],
    controlName: string,
    treatmentName: string
  ): PairwiseComparison => {
    const leveneTest = calculateLeveneTest(controlValues, treatmentValues);

    // Calculate group statistics
    const controlStats: GroupStats = {
      mean: jStatTyped.mean(controlValues),
      stdDev: jStatTyped.stdev(controlValues, true),
      sampleSize: controlValues.length,
      values: controlValues
    };

    const treatmentStats: GroupStats = {
      mean: jStatTyped.mean(treatmentValues),
      stdDev: jStatTyped.stdev(treatmentValues, true),
      sampleSize: treatmentValues.length,
      values: treatmentValues
    };

    // Calculate t-statistic and degrees of freedom based on Levene's test result
    let tStatistic: number;
    let degreesOfFreedom: number;

    if (leveneTest.equalVariance) {
      // Student's t-test (pooled variance)
      const n1 = controlStats.sampleSize;
      const n2 = treatmentStats.sampleSize;
      const pooledStd = Math.sqrt(
        ((n1 - 1) * controlStats.stdDev ** 2 + (n2 - 1) * treatmentStats.stdDev ** 2) /
        (n1 + n2 - 2)
      );
      tStatistic = (treatmentStats.mean - controlStats.mean) / (pooledStd * Math.sqrt(1/n1 + 1/n2));
      degreesOfFreedom = n1 + n2 - 2;
    } else {
      // Welch's t-test
      const n1 = controlStats.sampleSize;
      const n2 = treatmentStats.sampleSize;
      const s1 = controlStats.stdDev;
      const s2 = treatmentStats.stdDev;
      tStatistic = (treatmentStats.mean - controlStats.mean) / Math.sqrt((s1 * s1 / n1) + (s2 * s2 / n2));
      degreesOfFreedom = Math.floor(
        ((s1 * s1 / n1 + s2 * s2 / n2) ** 2) /
        ((s1 * s1 / n1) ** 2 / (n1 - 1) + (s2 * s2 / n2) ** 2 / (n2 - 1))
      );
    }

    const pValue = 2 * (1 - jStatTyped.studentt.cdf(Math.abs(tStatistic), degreesOfFreedom));
    const meanDifference = treatmentStats.mean - controlStats.mean;

    return {
      controlGroup: controlName,
      treatmentGroup: treatmentName,
      leveneTest,
      tStatistic,
      degreesOfFreedom,
      pValue,
      groupStats: {
        [controlName]: controlStats,
        [treatmentName]: treatmentStats
      },
      meanDifference,
      conclusion: '',  // Will be set after Bonferroni correction
      interpretation: '',  // Will be set after Bonferroni correction
      confidenceInterval: {
        lower: meanDifference - 1.96 * Math.sqrt((controlStats.stdDev ** 2 / controlStats.sampleSize) + (treatmentStats.stdDev ** 2 / treatmentStats.sampleSize)),
        upper: meanDifference + 1.96 * Math.sqrt((controlStats.stdDev ** 2 / controlStats.sampleSize) + (treatmentStats.stdDev ** 2 / treatmentStats.sampleSize))
      },
      testType: testType === 'independent' ? 'Independent T-Test' : 'Paired T-Test',
      adjustedAlpha: significanceLevel / (testType === 'independent' ? treatmentGroups.length : 1)
    };
  };

  const handleRunTest = () => {
    if (!parsedData || !metricColumn || (!groupingColumn && testType !== 'one-sample')) {
      setError('Please select all required fields');
      return;
    }

    if (testType !== 'one-sample' && (!controlGroup || treatmentGroups.length === 0)) {
      setError('Please select control and treatment groups');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      let comparisons: PairwiseComparison[] = [];
      const numberOfComparisons = testType === 'one-sample' ? 1 : treatmentGroups.length;
      const adjustedAlpha = significanceLevel / numberOfComparisons;

      if (testType === 'one-sample') {
        // Handle one-sample t-test
        const metricValues = parsedData.data.map(row => parseFloat(row[metricColumn]));
        if (metricValues.some(isNaN)) {
          throw new Error('Invalid numeric data in metric column');
        }

        const sampleMean = jStatTyped.mean(metricValues);
        const sampleStd = jStatTyped.stdev(metricValues, true);
        const n = metricValues.length;
        const standardError = sampleStd / Math.sqrt(n);
        const tStatistic = (sampleMean - populationMean) / standardError;
        const degreesOfFreedom = n - 1;
        const pValue = 2 * (1 - jStatTyped.studentt.cdf(Math.abs(tStatistic), degreesOfFreedom));

        const comparison: PairwiseComparison = {
          controlGroup: 'Population',
          treatmentGroup: 'Sample',
          leveneTest: {
            pValue: 1,
            equalVariance: true,
            testUsed: 'Student'
          },
          tStatistic,
          degreesOfFreedom,
          pValue,
          groupStats: {
            'Sample': {
              mean: sampleMean,
              stdDev: sampleStd,
              sampleSize: n,
              values: metricValues
            }
          },
          meanDifference: sampleMean - populationMean,
          conclusion: pValue < significanceLevel ? 'Reject H₀' : 'Fail to reject H₀',
          interpretation: pValue < significanceLevel
            ? `There is sufficient evidence to conclude that the population mean is different from ${populationMean} (p < ${significanceLevel}).`
            : `There is insufficient evidence to conclude that the population mean is different from ${populationMean} (p > ${significanceLevel}).`,
          confidenceInterval: {
            lower: sampleMean - 1.96 * standardError,
            upper: sampleMean + 1.96 * standardError
          },
          testType: 'One-Sample T-Test',
          adjustedAlpha: significanceLevel
        };

        comparisons.push(comparison);
      } else {
        // Handle independent/paired t-tests
        treatmentGroups.forEach(treatmentGroup => {
          const controlValues = parsedData.data
            .filter(row => row[groupingColumn] === controlGroup)
            .map(row => parseFloat(row[metricColumn]));
          
          const treatmentValues = parsedData.data
            .filter(row => row[groupingColumn] === treatmentGroup)
            .map(row => parseFloat(row[metricColumn]));

          if (controlValues.some(isNaN) || treatmentValues.some(isNaN)) {
            throw new Error('Invalid numeric data in selected columns');
          }

          const comparison = performPairwiseComparison(
            controlValues,
            treatmentValues,
            controlGroup,
            treatmentGroup
          );

          // Add Bonferroni correction details
          comparison.adjustedAlpha = adjustedAlpha;
          comparison.conclusion = comparison.pValue < adjustedAlpha ? 'Reject H₀' : 'Fail to reject H₀';
          comparison.interpretation = comparison.pValue < adjustedAlpha
            ? `There is sufficient evidence to conclude a significant difference between ${treatmentGroup} and ${controlGroup} (p < ${adjustedAlpha.toFixed(4)}, Bonferroni-adjusted α).`
            : `There is insufficient evidence to conclude a significant difference between ${treatmentGroup} and ${controlGroup} (p > ${adjustedAlpha.toFixed(4)}, Bonferroni-adjusted α).`;

          comparisons.push(comparison);
        });
      }

      const testResult: TestResult = {
        testType: testType === 'independent' ? 'Independent T-Test' : 
                  testType === 'paired' ? 'Paired T-Test' : 'One-Sample T-Test',
        metricType,
        significanceLevel,
        adjustedAlpha,
        numberOfComparisons,
        comparisons
      };

      setResult(testResult);
      updateChartData(testResult);
      markTestExecuted(); // Mark that test has been executed with current inputs
    } catch (err) {
      setError(`Error performing test: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const updateChartData = (result: TestResult) => {
    if (!result || !parsedData) return;

    if (result.metricType === 'continuous') {
      // Create bar chart for continuous data
      const labels = result.comparisons.map(comp => [comp.controlGroup, comp.treatmentGroup]).flat();
      const data = result.comparisons.map(comp => [
        comp.groupStats[comp.controlGroup].mean,
        comp.groupStats[comp.treatmentGroup].mean
      ]).flat();

      setChartData({
        labels: labels.map(String),
        datasets: [{
          label: 'Group Means',
          data,
          backgroundColor: result.comparisons.map(() => ['rgba(54, 162, 235, 0.5)', 'rgba(255, 99, 132, 0.5)']).flat(),
          borderColor: result.comparisons.map(() => ['rgba(54, 162, 235, 1)', 'rgba(255, 99, 132, 1)']).flat(),
          borderWidth: 1
        }]
      });
    } else {
      // Create bar chart for binary data
      const labels = result.comparisons.map(comp => [comp.controlGroup, comp.treatmentGroup]).flat();
      const data = result.comparisons.map(comp => [
        comp.groupStats[comp.controlGroup].mean * 100,
        comp.groupStats[comp.treatmentGroup].mean * 100
      ]).flat();

      setChartData({
        labels: labels.map(String),
        datasets: [{
          label: 'Proportion (%)',
          data,
          backgroundColor: result.comparisons.map(() => ['rgba(54, 162, 235, 0.5)', 'rgba(255, 99, 132, 0.5)']).flat(),
          borderColor: result.comparisons.map(() => ['rgba(54, 162, 235, 1)', 'rgba(255, 99, 132, 1)']).flat(),
          borderWidth: 1
        }]
      });
    }
  };

  const analyzeFile = (file: File) => {
    setIsProcessing(true);
    setError(null);
    setParsedData(null);
    setMetricColumn('');
    setGroupingColumn('');
    setAvailableGroups([]);
    setControlGroup('');
    setTreatmentGroups([]);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text === 'string') {
        try {
          const results = Papa.parse(text, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true
          });

          if (results.errors.length > 0) {
            setError(`Error parsing CSV file: ${results.errors[0].message}`);
            setIsProcessing(false);
            return;
          }

          setParsedData({
            data: results.data as Record<string, any>[],
            columns: results.meta.fields || []
          });
          setIsProcessing(false);
        } catch (err) {
          setError(`Error processing file: ${err instanceof Error ? err.message : 'Unknown error'}`);
          setIsProcessing(false);
        }
      }
    };

    reader.onerror = () => {
      setError('Error reading file');
      setIsProcessing(false);
    };

    reader.readAsText(file);
  };

  const calculateLeveneStatistic = (group1: number[], group2: number[]): number => {
    const group1Mean = jStatTyped.mean(group1);
    const group2Mean = jStatTyped.mean(group2);

    const group1Deviations = group1.map(x => Math.abs(x - group1Mean));
    const group2Deviations = group2.map(x => Math.abs(x - group2Mean));

    const allDeviations = [...group1Deviations, ...group2Deviations];
    const overallMean = jStatTyped.mean(allDeviations);

    const n1 = group1.length;
    const n2 = group2.length;
    const N = n1 + n2;

    const group1DevSum = group1Deviations.reduce((sum, x) => sum + Math.pow(x - overallMean, 2), 0);
    const group2DevSum = group2Deviations.reduce((sum, x) => sum + Math.pow(x - overallMean, 2), 0);

    const numerator = ((N - 2) * (n1 * Math.pow(jStatTyped.mean(group1Deviations) - overallMean, 2) + 
                                  n2 * Math.pow(jStatTyped.mean(group2Deviations) - overallMean, 2)));
    const denominator = (group1DevSum + group2DevSum);

    return numerator / denominator;
  };

  const calculateLevenePValue = (leveneStatistic: number, group1: number[], group2: number[]): number => {
    const df1 = 1;
    const df2 = group1.length + group2.length - 2;
    return 1 - jStatTyped.centralF.cdf(leveneStatistic, df1, df2);
  };

  const renderSingleTestResult = (testResult: PairwiseComparison) => {
    return (
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6">
          {testResult.treatmentGroup} vs {testResult.controlGroup}
        </Typography>
        
        {testResult.leveneTest.pValue !== undefined && (
          <>
            <Typography variant="subtitle1" color="text.secondary">
              Variance Test (Levene's):
            </Typography>
            <Typography>
              p-value: {testResult.leveneTest.pValue.toFixed(4)}
              <br />
              Conclusion: {testResult.leveneTest.equalVariance ? 'Equal variances' : 'Unequal variances'}
              <br />
              Test used: {testResult.leveneTest.testUsed}
            </Typography>
          </>
        )}

        <Typography variant="subtitle1" color="text.secondary" sx={{ mt: 2 }}>
          Group Statistics:
        </Typography>
        {Object.entries(testResult.groupStats).map(([group, stats]) => (
          <Typography key={group}>
            {group}:
            <br />
            Mean: {stats.mean.toFixed(4)}
            <br />
            Std Dev: {stats.stdDev.toFixed(4)}
            <br />
            Sample Size: {stats.sampleSize}
          </Typography>
        ))}

        <Typography variant="subtitle1" color="text.secondary" sx={{ mt: 2 }}>
          T-Test Results:
        </Typography>
        <Typography>
          t-statistic: {testResult.tStatistic.toFixed(4)}
          <br />
          Degrees of freedom: {testResult.degreesOfFreedom.toFixed(2)}
          <br />
          p-value: {testResult.pValue.toFixed(4)}
          <br />
          {testResult.adjustedAlpha !== undefined && (
            <>
              Bonferroni-adjusted α: {testResult.adjustedAlpha.toFixed(4)}
              <br />
            </>
          )}
          Conclusion: {testResult.conclusion}
        </Typography>

        <Typography variant="body1" sx={{ mt: 2 }}>
          {testResult.interpretation}
        </Typography>
      </Box>
    );
  };

  const renderTestResults = () => {
    if (!result) return null;

    return (
      <Paper sx={{ p: 3, mt: 3, bgcolor: '#ffffff' }}>
        <Typography variant="h5" gutterBottom sx={{ color: '#1976d2', mb: 3 }}>
          Analysis Results
        </Typography>

        {/* Test Overview */}
        <Box sx={{ mb: 3, p: 2, bgcolor: '#f8f9fa', borderRadius: 1 }}>
          <Typography variant="h6" gutterBottom sx={{ color: '#1976d2' }}>
            Test Configuration
          </Typography>
          <Typography variant="subtitle1">
            <strong>Test Type:</strong> {result.testType}
            <br />
            <strong>Metric Type:</strong> {result.metricType}
          </Typography>
          
          {/* Bonferroni Correction Details */}
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color: '#2e7d32' }}>
              Multiple Comparison Correction
            </Typography>
            <Typography>
              <strong>Original Significance Level (α):</strong> {result.significanceLevel.toFixed(4)}
              <br />
              <strong>Number of Comparisons (k):</strong> {result.numberOfComparisons}
              <br />
              <strong>Bonferroni-adjusted α:</strong> {result.adjustedAlpha.toFixed(4)}
              <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
                Note: To control the family-wise error rate, each comparison's p-value will be compared 
                against the Bonferroni-adjusted α (original α ÷ number of comparisons).
              </Typography>
            </Typography>
          </Box>
        </Box>

        {/* Individual Comparisons */}
        {result.comparisons.map((comparison, index) => (
          <Box key={index} sx={{ mt: 4, p: 2, border: '1px solid #e0e0e0', borderRadius: 1 }}>
            <Typography variant="h6" gutterBottom sx={{ color: '#1976d2' }}>
              Comparison {index + 1}: {comparison.controlGroup} vs {comparison.treatmentGroup}
            </Typography>

            {/* Part 1: Variance Comparison */}
            {comparison.leveneTest.pValue !== undefined && (
              <Box sx={{ mt: 2, mb: 3 }}>
                <Typography variant="h6" sx={{ color: '#2e7d32', mb: 1 }}>
                  1. Variance Comparison (Levene's Test)
                </Typography>
                <Box sx={{ pl: 2 }}>
                  <Typography>
                    <strong>Null Hypothesis (H₀):</strong> The groups have equal variances
                    <br />
                    <strong>Alternative Hypothesis (H₁):</strong> The groups have unequal variances
                    <br />
                    <strong>Levene's Test p-value:</strong> {comparison.leveneTest.pValue.toFixed(4)}
                    <br />
                    <strong>Comparison:</strong> {comparison.leveneTest.pValue > result.significanceLevel ? 
                      `p-value (${comparison.leveneTest.pValue.toFixed(4)}) > α (${result.significanceLevel.toFixed(4)})` :
                      `p-value (${comparison.leveneTest.pValue.toFixed(4)}) ≤ α (${result.significanceLevel.toFixed(4)})`}
                    <br />
                    <strong>Conclusion:</strong> {comparison.leveneTest.equalVariance ? 
                      'Equal variances (Using Student\'s t-test)' : 
                      'Unequal variances (Using Welch\'s t-test)'}
                  </Typography>
                </Box>
              </Box>
            )}

            {/* Part 2: Test Results */}
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" sx={{ color: '#2e7d32', mb: 1 }}>
                2. {comparison.testType} Results
              </Typography>
              
              <Box sx={{ pl: 2 }}>
                {/* Group Statistics */}
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 2 }}>
                  Group Statistics:
                </Typography>
                {Object.entries(comparison.groupStats).map(([group, stats]) => (
                  <Box key={group} sx={{ pl: 2, mb: 1 }}>
                    <Typography>
                      <strong>{group}:</strong>
                      <br />
                      Mean: {stats.mean.toFixed(4)}
                      <br />
                      Standard Deviation: {stats.stdDev.toFixed(4)}
                      <br />
                      Sample Size: {stats.sampleSize}
                    </Typography>
                  </Box>
                ))}

                {/* Test Statistics */}
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 2 }}>
                  Test Statistics:
                </Typography>
                <Box sx={{ pl: 2 }}>
                  <Typography>
                    <strong>t-statistic:</strong> {comparison.tStatistic.toFixed(4)}
                    <br />
                    <strong>Degrees of Freedom:</strong> {comparison.degreesOfFreedom.toFixed(2)}
                    <br />
                    <strong>p-value:</strong> {comparison.pValue.toFixed(4)}
                    {comparison.adjustedAlpha !== undefined && (
                      <>
                        <br />
                        <strong>Bonferroni-adjusted α:</strong> {comparison.adjustedAlpha.toFixed(4)}
                      </>
                    )}
                  </Typography>
                </Box>

                {/* Confidence Interval */}
                {comparison.confidenceInterval && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                      95% Confidence Interval:
                    </Typography>
                    <Typography sx={{ pl: 2 }}>
                      ({comparison.confidenceInterval.lower.toFixed(4)}, {comparison.confidenceInterval.upper.toFixed(4)})
                    </Typography>
                  </Box>
                )}

                {/* Final Conclusion */}
                <Box sx={{ mt: 3, bgcolor: '#f5f5f5', p: 2, borderRadius: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                    Final Conclusion (with Bonferroni Correction):
                  </Typography>
                  <Typography>
                    <strong>Comparison:</strong> p-value ({comparison.pValue.toFixed(4)}) {' '}
                    {comparison.pValue < comparison.adjustedAlpha ? '<' : '≥'} {' '}
                    Bonferroni-adjusted α ({comparison.adjustedAlpha.toFixed(4)})
                  </Typography>
                  <Typography sx={{ mt: 1 }}>
                    <strong>Decision:</strong> {comparison.conclusion}
                  </Typography>
                  <Typography sx={{ mt: 1 }}>
                    <strong>Interpretation:</strong> {comparison.interpretation}
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Box>
        ))}
      </Paper>
    );
  };

  const renderTestDetails = () => {
    if (!result || result.comparisons.length === 0) return null;
    const currentResult = result.comparisons[0];

    return (
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Typography>
            <strong>Test Type:</strong> {result.testType}
          </Typography>
          <Typography>
            <strong>Metric Type:</strong> {result.metricType}
          </Typography>
          {result.testType === 'One-Sample T-Test' && (
            <>
              <Typography>
                <strong>Null Hypothesis (H₀):</strong> Population mean (μ) = {currentResult.groupStats['Sample'].mean.toFixed(4)}
              </Typography>
              <Typography>
                <strong>Alternative Hypothesis (H₁):</strong> Population mean (μ) ≠ {currentResult.groupStats['Sample'].mean.toFixed(4)}
              </Typography>
              <Typography>
                <strong>Sample Mean (x̄):</strong> {currentResult.groupStats['Sample'].mean.toFixed(4)}
              </Typography>
              <Typography>
                <strong>Sample Standard Deviation (s):</strong> {currentResult.groupStats['Sample'].stdDev.toFixed(4)}
              </Typography>
              <Typography>
                <strong>Sample Size (n):</strong> {currentResult.groupStats['Sample'].sampleSize}
              </Typography>
              {currentResult.confidenceInterval && (
                <Typography>
                  <strong>95% Confidence Interval:</strong> ({currentResult.confidenceInterval.lower.toFixed(4)}, {currentResult.confidenceInterval.upper.toFixed(4)})
                </Typography>
              )}
            </>
          )}
          {currentResult.leveneTest.equalVariance !== undefined && (
            <>
              <Typography>
                <strong>Equal Variance:</strong> {currentResult.leveneTest.equalVariance ? 'Yes' : 'No'}
              </Typography>
              <Typography>
                <strong>Levene's p-value:</strong> {currentResult.leveneTest.pValue.toFixed(4)}
              </Typography>
            </>
          )}

          <Typography variant="h6" sx={{ mt: 2 }}>
            Group Statistics
          </Typography>
          {Object.entries(currentResult.groupStats).map(([group, stats]) => (
            <Box key={group} sx={{ mb: 1 }}>
              <Typography>
                <strong>{group}:</strong>
                <br />
                Mean: {stats.mean.toFixed(4)}
                <br />
                Standard Deviation: {stats.stdDev.toFixed(4)}
                <br />
                Sample Size: {stats.sampleSize}
              </Typography>
            </Box>
          ))}

          <Typography variant="h6" sx={{ mt: 2 }}>
            Test Results
          </Typography>
          <Typography>
            <strong>T-statistic:</strong> {currentResult.tStatistic.toFixed(4)}
          </Typography>
          <Typography>
            <strong>Degrees of Freedom:</strong> {currentResult.degreesOfFreedom.toFixed(2)}
          </Typography>
          <Typography>
            <strong>P-value:</strong> {currentResult.pValue.toFixed(4)}
          </Typography>
          <Typography>
            <strong>Confidence Level:</strong> {(significanceLevel * 100).toFixed(1)}%
          </Typography>
          <Typography>
            <strong>Conclusion:</strong> {currentResult.conclusion}
          </Typography>
          <Typography sx={{ mt: 1 }}>
            <strong>Interpretation:</strong> {currentResult.interpretation}
          </Typography>

          {currentResult.testType === 'Paired T-Test' && currentResult.meanDifference !== undefined && currentResult.stdDevDifference !== undefined && (
            <Grid item xs={12}>
              <Typography>
                <strong>Mean Difference:</strong> {currentResult.meanDifference.toFixed(4)}
              </Typography>
              <Typography>
                <strong>Standard Deviation of Differences:</strong> {currentResult.stdDevDifference.toFixed(4)}
              </Typography>
            </Grid>
          )}
        </Grid>
      </Grid>
    );
  };

  const renderChartData = (result: TestResult) => {
    if (!result || !result.comparisons.length) return null;

    const isBinary = result.metricType === 'binary';

    return (
      <Paper sx={{ p: 3, bgcolor: '#ffffff' }}>
        <Typography variant="h6" gutterBottom sx={{ color: '#1976d2' }}>
          Distribution Comparison
        </Typography>
        
        <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
          {isBinary ? 
            'Bar charts showing proportions for each group' :
            'Histograms showing the distribution of values in each group'}
        </Typography>

        {result.comparisons.map((comparison, index) => {
          const controlStats = comparison.groupStats[comparison.controlGroup];
          const treatmentStats = comparison.groupStats[comparison.treatmentGroup];

          if (isBinary) {
            const barData = {
              labels: [comparison.controlGroup, comparison.treatmentGroup],
              datasets: [{
                label: 'Proportion',
                data: [
                  controlStats.mean * 100,
                  treatmentStats.mean * 100
                ],
                backgroundColor: [CONTROL_GROUP_COLOR, TREATMENT_GROUP_COLOR],
                borderColor: [CONTROL_GROUP_BORDER, TREATMENT_GROUP_BORDER],
                borderWidth: 1
              }]
            };

            const barOptions = {
              responsive: true,
              plugins: {
                legend: {
                  display: false
                },
                title: {
                  display: true,
                  text: `${comparison.controlGroup} vs ${comparison.treatmentGroup}`,
                  font: {
                    size: 14
                  }
                },
                tooltip: {
                  callbacks: {
                    label: (context: any) => `${context.parsed.y.toFixed(1)}%`
                  }
                }
              },
              scales: {
                y: {
                  beginAtZero: true,
                  max: 100,
                  title: {
                    display: true,
                    text: 'Percentage (%)'
                  }
                }
              }
            };

            return (
              <Box key={index} sx={{ mt: index > 0 ? 4 : 0 }}>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle1" sx={{ color: 'text.secondary' }}>
                    <strong>Control Group:</strong> {comparison.controlGroup}
                    <br />
                    <strong>Treatment Group:</strong> {comparison.treatmentGroup}
                  </Typography>
                </Box>
                <Box sx={{ height: 400 }}>
                  <Chart type="bar" data={barData} options={barOptions} />
                </Box>
              </Box>
            );
          } else {
            // Calculate histogram data for both groups
            const controlHistogram = calculateHistogramBins(controlStats.values);
            const treatmentHistogram = calculateHistogramBins(treatmentStats.values);

            // Create labels for the bins (use control group bins as reference)
            const binLabels = controlHistogram.bins.slice(0, -1).map((binStart, i) => 
              `${formatBinLabel(binStart)}-${formatBinLabel(controlHistogram.bins[i + 1])}`
            );

            const histogramData = {
              labels: binLabels,
              datasets: [
                {
                  label: comparison.controlGroup,
                  data: controlHistogram.counts,
                  backgroundColor: CONTROL_GROUP_COLOR,
                  borderColor: CONTROL_GROUP_BORDER,
                  borderWidth: 1,
                  barPercentage: 0.9,
                  categoryPercentage: 0.8
                },
                {
                  label: comparison.treatmentGroup,
                  data: treatmentHistogram.counts,
                  backgroundColor: TREATMENT_GROUP_COLOR,
                  borderColor: TREATMENT_GROUP_BORDER,
                  borderWidth: 1,
                  barPercentage: 0.9,
                  categoryPercentage: 0.8
                }
              ]
            };

            const histogramOptions = {
              responsive: true,
              plugins: {
                legend: {
                  display: true,
                  position: 'top' as const
                },
                title: {
                  display: true,
                  text: 'Value Distribution by Group',
                  font: {
                    size: 14
                  }
                },
                tooltip: {
                  callbacks: {
                    label: (context: any) => {
                      return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}% of values`;
                    }
                  }
                }
              },
              scales: {
                x: {
                  title: {
                    display: true,
                    text: 'Value Ranges'
                  }
                },
                y: {
                  beginAtZero: true,
                  title: {
                    display: true,
                    text: 'Percentage of Values (%)'
                  }
                }
              }
            };

            return (
              <Box key={index} sx={{ mt: index > 0 ? 4 : 0 }}>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle1" sx={{ color: 'text.secondary' }}>
                    <strong>Control Group:</strong> {comparison.controlGroup}
                    <br />
                    <strong>Treatment Group:</strong> {comparison.treatmentGroup}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
                    The histogram shows the distribution of values in each group.
                    Each bar represents the percentage of values falling within that range.
                    <br />
                    <strong>Mean (Control):</strong> {controlStats.mean.toFixed(2)}
                    <br />
                    <strong>Mean (Treatment):</strong> {treatmentStats.mean.toFixed(2)}
                    <br />
                    <strong>Standard Deviation (Control):</strong> {controlStats.stdDev.toFixed(2)}
                    <br />
                    <strong>Standard Deviation (Treatment):</strong> {treatmentStats.stdDev.toFixed(2)}
                  </Typography>
                </Box>
                <Box sx={{ height: 400 }}>
                  <Chart type="bar" data={histogramData} options={histogramOptions} />
                </Box>
              </Box>
            );
          }
        })}
      </Paper>
    );
  };

  const renderGroupSelection = () => {
    if (!testType || testType === 'one-sample' || !parsedData) return null;

    return (
      <>
        <Grid item xs={12} md={6}>
          <FormControl fullWidth>
            <InputLabel>Grouping Column</InputLabel>
            <Select
              value={groupingColumn}
              onChange={handleGroupingColumnChange}
              label="Grouping Column"
            >
              {parsedData.columns.map((column) => (
                <MenuItem key={column} value={column}>
                  {column}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        {groupingColumn && availableGroups.length > 2 && (
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Control Group</InputLabel>
              <Select
                value={controlGroup}
                onChange={handleControlGroupChange}
                label="Control Group"
              >
                {availableGroups.map((group) => (
                  <MenuItem key={group} value={group}>
                    {group}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>
                Select a control group. Each remaining group will be compared against this group.
              </FormHelperText>
            </FormControl>
          </Grid>
        )}
        
        {groupingColumn && availableGroups.length === 2 && (
          <Grid item xs={12}>
            <Typography>
              <strong>Control Group:</strong> {controlGroup}
              <br />
              <strong>Treatment Group:</strong> {treatmentGroups[0]}
            </Typography>
          </Grid>
        )}

        {groupingColumn && availableGroups.length > 2 && controlGroup && (
          <Grid item xs={12}>
            <Typography>
              <strong>Control Group:</strong> {controlGroup}
              <br />
              <strong>Treatment Groups:</strong> {treatmentGroups.join(', ')}
              <br />
              <em>Each treatment group will be compared individually against the control group.</em>
            </Typography>
          </Grid>
        )}
      </>
    );
  };

  return (
    <Box sx={{ width: '100%', maxWidth: 1200, margin: '0 auto', p: 3 }}>
      <Typography variant="h5" gutterBottom>
        T-Test Analysis
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom>
              Upload Data
            </Typography>
          </Grid>
          <Grid item xs={12}>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              style={{ display: 'none' }}
              ref={fileInputRef}
            />
            <Button
              variant="contained"
              onClick={() => fileInputRef.current?.click()}
              startIcon={<CloudUploadIcon />}
            >
              Choose CSV File
            </Button>
            {file && (
              <Typography sx={{ mt: 1 }}>
                Selected file: {file.name}
              </Typography>
            )}
          </Grid>
        </Grid>
      </Paper>

      {parsedData && (
        <>
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
            <Tabs 
              value={tabValue} 
              onChange={handleTabChange}
              aria-label="t-test tabs"
            >
              <Tab label="Analysis" />
              <Tab label="Execution Results" />
              <Tab label="Visual Comparison" />
            </Tabs>
          </Box>

          <TabPanel value={tabValue} index={0}>
            <Paper sx={{ p: 3, mb: 3 }}>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography variant="h6" gutterBottom>
                    Configure T-Test
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Test Type</InputLabel>
                    <Select
                      value={testType}
                      onChange={handleTestTypeChange}
                      label="Test Type"
                    >
                      <MenuItem value="independent">Independent T-Test</MenuItem>
                      <MenuItem value="paired">Paired T-Test</MenuItem>
                      <MenuItem value="one-sample">One-Sample T-Test</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Metric Column</InputLabel>
                    <Select
                      value={metricColumn}
                      onChange={handleMetricColumnChange}
                      label="Metric Column"
                    >
                      {parsedData.columns.map((col) => (
                        <MenuItem key={col} value={col}>
                          {col}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                {renderGroupSelection()}
                {testType === 'one-sample' && (
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      type="number"
                      label="Population Mean"
                      value={populationMean}
                      onChange={handlePopulationMeanChange}
                    />
                  </Grid>
                )}
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel id="significance-level-label">Significance Level (α)</InputLabel>
                    <Select
                      labelId="significance-level-label"
                      value={significanceLevel.toString()}
                      onChange={handleSignificanceLevelChange}
                      label="Significance Level (α)"
                    >
                      <MenuItem value="0.01">0.01 (1%)</MenuItem>
                      <MenuItem value="0.05">0.05 (5%)</MenuItem>
                      <MenuItem value="0.10">0.10 (10%)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12}>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleRunTest}
                    disabled={isProcessing}
                    sx={{ mt: 2 }}
                  >
                    {isProcessing ? (
                      <>
                        <CircularProgress size={24} sx={{ mr: 1 }} />
                        Processing...
                      </>
                    ) : (
                      `Run ${testType === 'independent' ? 'Independent' : testType === 'paired' ? 'Paired' : 'One-Sample'} T-Test`
                    )}
                  </Button>
                  <FormHelperText>
                    Clicking this button will recalculate results using the latest values from all inputs
                  </FormHelperText>
                </Grid>
              </Grid>
            </Paper>
          </TabPanel>

          <TabPanel value={tabValue} index={1}>
            {result && !inputsChanged ? (
              renderTestResults()
            ) : inputsChanged ? (
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="h6" color="warning.main">
                  Inputs Changed - Results Outdated
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  You have modified the test configuration. Please go back to the Analysis tab and click "Run Test" to generate new results with the updated parameters.
                </Typography>
              </Paper>
            ) : (
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="h6" color="text.secondary">
                  No Results Yet
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Configure your test parameters in the Analysis tab and click "Run Test" to see results here.
                </Typography>
              </Paper>
            )}
          </TabPanel>

          <TabPanel value={tabValue} index={2}>
            {result && !inputsChanged ? (
              renderChartData(result)
            ) : inputsChanged ? (
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="h6" color="warning.main">
                  Inputs Changed - Charts Outdated
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  You have modified the test configuration. Please run the test again to see updated visualizations.
                </Typography>
              </Paper>
            ) : (
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="h6" color="text.secondary">
                  No Data to Visualize
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Run a test first to see visual comparisons here.
                </Typography>
              </Paper>
            )}
          </TabPanel>
        </>
      )}

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      {isProcessing && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <CircularProgress />
        </Box>
      )}
    </Box>
  );
};

export default TTest; 