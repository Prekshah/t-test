import React, { useState, useRef, useEffect } from 'react';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
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

interface GroupStats {
  mean: number;
  stdDev: number;
  sampleSize: number;
}

interface TestResult {
  testType: string;
  metricType: string;
  equalVariance?: boolean;
  levenePValue?: number;
  groupStats: {
    [key: string]: GroupStats;
  };
  tStatistic: number;
  degreesOfFreedom: number;
  pValue: number;
  confidenceLevel: number;
  conclusion: string;
  interpretation: string;
  meanDifference?: number;
  stdDevDifference?: number;
  populationMean?: number;
  standardError?: number;
  confidenceInterval?: {
    lower: number;
    upper: number;
  };
}

interface TTestProps {
  data: Record<string, any>[];
  columns: string[];
}

interface ParsedData {
  data: Record<string, any>[];
  columns: string[];
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

const TTest: React.FC<TTestProps> = ({ data, columns }) => {
  const [testType, setTestType] = useState<string>('independent');
  const [metricColumn, setMetricColumn] = useState<string>('');
  const [groupingColumn, setGroupingColumn] = useState<string>('');
  const [pairingKey, setPairingKey] = useState<string>('');
  const [populationMean, setPopulationMean] = useState<number>(0);
  const [significanceLevel, setSignificanceLevel] = useState<number>(0.05);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [isFileAnalyzed, setIsFileAnalyzed] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New state for group selection
  const [availableGroups, setAvailableGroups] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [showGroupSelection, setShowGroupSelection] = useState<boolean>(false);
  const [groupSelectionError, setGroupSelectionError] = useState<string | null>(null);

  const [worker, setWorker] = useState<Worker | null>(null);

  useEffect(() => {
    const newWorker = new Worker(new URL('../tTestWorker.js', import.meta.url));
    newWorker.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'FILE_PROCESSED') {
        setParsedData(payload);
        setIsProcessing(false);
      } else if (type === 'TEST_COMPLETE') {
        setResult(payload);
        setIsProcessing(false);
      } else if (type === 'ERROR') {
        setError(payload.message);
        setIsProcessing(false);
      }
    };
    setWorker(newWorker);
    return () => newWorker.terminate();
  }, []);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Only set the file and reset states, but don't process yet
      setFile(file);
      setIsFileAnalyzed(false);
      setParsedData(null);
      setMetricColumn('');
      setGroupingColumn('');
      setPairingKey('');
      setAvailableGroups([]);
      setSelectedGroups([]);
      setShowGroupSelection(false);
      setGroupSelectionError(null);
      setResult(null);
      setError(null);
      setIsProcessing(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files && event.dataTransfer.files[0]) {
      setFile(event.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handlePerformTest = () => {
    if (!parsedData || !metricColumn) return;
    setIsProcessing(true);
    setError(null);

    // Add validation for paired t-test
    if (testType === 'paired') {
      const validation = validatePairedTTest(parsedData.data, metricColumn, groupingColumn, pairingKey);
      
      if (!validation.isValid) {
        setError(validation.error);
        setIsProcessing(false);
        return;
      }

      // If there's a warning but test can proceed, show it
      if (validation.warning) {
        setError(validation.warning); // Using error state to show warnings too
      }

      // Send only the valid pairs to the worker
      worker?.postMessage({
        type: 'PERFORM_TEST',
        payload: {
          data: Object.values(validation.validPairs).flat(),
          metricColumn,
          groupingColumn,
          pairingKey,
          testType,
          significanceLevel
        }
      });
    } else {
      // Existing code for other test types
      worker?.postMessage({
        type: 'PERFORM_TEST',
        payload: {
          data: parsedData.data,
          metricColumn,
          groupingColumn,
          pairingKey,
          populationMean,
          significanceLevel,
          testType,
          selectedGroups,
          showGroupSelection,
          availableGroups
        }
      });
    }
  };

  const handleUploadAndAnalyze = () => {
    if (file) {
      setIsProcessing(true);
      setIsFileAnalyzed(false);
      setParsedData(null);
      // Process the file only when Upload & Analyze is clicked
      worker?.postMessage({ type: 'PROCESS_FILE', payload: { file } });
      setIsFileAnalyzed(true);
    }
  };

  const validatePairedTTest = (data: Record<string, any>[], metricCol: string, groupingCol: string, pairingCol: string): { 
    isValid: boolean; 
    error: string | null;
    warning: string | null;
    validPairs: Record<string, any[]>;
  } => {
    // 1. Validate Metric Column
    const metricValidation = validateMetricColumn(data, metricCol);
    if (!metricValidation.isValid) {
      return {
        isValid: false,
        error: metricValidation.error,
        warning: null,
        validPairs: {}
      };
    }

    // 2. Validate Grouping Column
    const groupValidation = validateGroupingColumn(data, groupingCol);
    if (!groupValidation.isValid) {
      return {
        isValid: false,
        error: groupValidation.error,
        warning: null,
        validPairs: {}
      };
    }

    // 3. Validate Pairing
    const pairingValidation = validatePairing(data, pairingCol, groupingCol, groupValidation.groups);
    
    return {
      isValid: pairingValidation.isValid,
      error: pairingValidation.error,
      warning: pairingValidation.warning,
      validPairs: pairingValidation.validPairs
    };
  };

  // Helper validation functions
  const validateMetricColumn = (data: Record<string, any>[], metricCol: string) => {
    // Check if column exists
    if (!data[0]?.hasOwnProperty(metricCol)) {
      return {
        isValid: false,
        error: "Metric column not found in the dataset."
      };
    }

    // Check for numerical values
    const nonNumericRows = data.filter(row => {
      const value = row[metricCol];
      return typeof value !== 'number' && (isNaN(Number(value)) || value === '' || value === null);
    });

    if (nonNumericRows.length > 0) {
      return {
        isValid: false,
        error: `Metric column must contain only numerical values. Found ${nonNumericRows.length} non-numeric values. Examples of valid metrics include revenue, scores, session time, conversion rates, etc.`
      };
    }

    return { isValid: true, error: null };
  };

  const validateGroupingColumn = (data: Record<string, any>[], groupingCol: string) => {
    // Check if column exists
    if (!data[0]?.hasOwnProperty(groupingCol)) {
      return {
        isValid: false,
        error: "Grouping column not found in the dataset.",
        groups: []
      };
    }

    // Get unique groups
    const uniqueGroups = Array.from(new Set(data.map(row => row[groupingCol])))
      .filter(group => group !== null && group !== undefined);

    if (uniqueGroups.length < 2) {
      return {
        isValid: false,
        error: "The grouping column must contain exactly two groups (e.g., 'before' and 'after', or 'test' and 'control'). Found only one or no groups.",
        groups: uniqueGroups
      };
    }

    if (uniqueGroups.length > 2) {
      return {
        isValid: false,
        error: `The grouping column must contain exactly two groups. Found ${uniqueGroups.length} groups: ${uniqueGroups.join(', ')}. Please ensure you're comparing exactly two conditions.`,
        groups: uniqueGroups
      };
    }

    return {
      isValid: true,
      error: null,
      groups: uniqueGroups
    };
  };

  const validatePairing = (data: Record<string, any>[], pairingCol: string, groupingCol: string, groups: any[]) => {
    // Check if column exists
    if (!data[0]?.hasOwnProperty(pairingCol)) {
      return {
        isValid: false,
        error: "Pairing key column not found in the dataset.",
        warning: null,
        validPairs: {}
      };
    }

    // Group data by pairing key
    const pairs: Record<string, any[]> = {};
    data.forEach(row => {
      const pairKey = row[pairingCol];
      if (pairKey === null || pairKey === undefined || pairKey === '') {
        return; // Skip empty pairing keys
      }
      if (!pairs[pairKey]) {
        pairs[pairKey] = [];
      }
      pairs[pairKey].push(row);
    });

    // Validate pairs
    const validPairs: Record<string, any[]> = {};
    let incompletePairs = 0;
    let invalidPairs = 0;
    let skippedPairs = 0;

    Object.entries(pairs).forEach(([key, rows]) => {
      if (rows.length !== 2) {
        incompletePairs++;
        return;
      }

      const group1 = rows[0][groupingCol];
      const group2 = rows[1][groupingCol];

      if (group1 === group2) {
        invalidPairs++;
        return;
      }

      if (!groups.includes(group1) || !groups.includes(group2)) {
        skippedPairs++;
        return;
      }

      validPairs[key] = rows;
    });

    const totalPairs = Object.keys(pairs).length;
    const validPairsCount = Object.keys(validPairs).length;

    if (validPairsCount === 0) {
      return {
        isValid: false,
        error: `No valid pairs found out of ${totalPairs} total pairs. Each individual (identified by the pairing key) must appear exactly once in each group.`,
        warning: null,
        validPairs: {}
      };
    }

    // Generate warning message if some pairs were invalid
    let warning = null;
    if (incompletePairs > 0 || invalidPairs > 0 || skippedPairs > 0) {
      const warnings = [];
      if (incompletePairs > 0) {
        warnings.push(`${incompletePairs} incomplete pairs (not present in both groups)`);
      }
      if (invalidPairs > 0) {
        warnings.push(`${invalidPairs} invalid pairs (same group)`);
      }
      if (skippedPairs > 0) {
        warnings.push(`${skippedPairs} skipped pairs (invalid group values)`);
      }
      warning = `Warning: Found ${warnings.join(', ')} out of ${totalPairs} total pairs. These pairs will be excluded from the analysis. Proceeding with ${validPairsCount} valid pairs.`;
    }

    return {
      isValid: true,
      error: null,
      warning,
      validPairs
    };
  };

  return (
    <Box sx={{ p: 3 }}>
      <Paper elevation={3} sx={{ p: 3 }}>
        <Typography variant="h5" gutterBottom>
          T-Test Analysis
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <UploadArea
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          {file ? (
            <>
              <Typography color="primary" gutterBottom>
                {file.name}
              </Typography>
              <Button
                component="label"
                variant="outlined"
                startIcon={<CloudUploadIcon />}
                sx={{ mb: 1 }}
              >
                Choose Different File
                <VisuallyHiddenInput
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  ref={fileInputRef}
                />
              </Button>
              <Button
                variant="contained"
                color="primary"
                onClick={handleUploadAndAnalyze}
                disabled={isProcessing}
                startIcon={isProcessing ? <CircularProgress size={20} /> : <FileUploadIcon />}
              >
                {isProcessing ? 'Processing...' : 'Upload and Analyze'}
              </Button>
            </>
          ) : (
            <>
              <Typography color="text.secondary" gutterBottom>
                Drag and drop a CSV file here, or click the button below
              </Typography>
              <Button
                component="label"
                variant="contained"
                startIcon={<CloudUploadIcon />}
              >
                Select CSV File
                <VisuallyHiddenInput
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                />
              </Button>
            </>
          )}
        </UploadArea>

        {/* Only show the form if we have parsed data and the file has been analyzed */}
        {parsedData && isFileAnalyzed && (
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Test Type</InputLabel>
                <Select
                  value={testType}
                  onChange={(e) => {
                    setTestType(e.target.value as string);
                    // Reset group selection when test type changes
                    setGroupingColumn('');
                    setPairingKey('');
                    setAvailableGroups([]);
                    setSelectedGroups([]);
                    setShowGroupSelection(false);
                    setGroupSelectionError(null);
                  }}
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
                  onChange={(e) => setMetricColumn(e.target.value as string)}
                  label="Metric Column"
                >
                  {parsedData.columns.length === 0 ? (
                    <MenuItem value="" disabled>
                      No columns available
                    </MenuItem>
                  ) : (
                    parsedData.columns.map((col) => (
                      <MenuItem key={col} value={col}>
                        {col}
                      </MenuItem>
                    ))
                  )}
                </Select>
              </FormControl>
            </Grid>

            {testType !== 'one-sample' && (
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Grouping Column</InputLabel>
                  <Select
                    value={groupingColumn}
                    onChange={(e) => {
                      const selectedCol = e.target.value as string;
                      setGroupingColumn(selectedCol);
                      setSelectedGroups([]); // Clear selected groups on column change
                      setGroupSelectionError(null); // Clear error

                      if (testType === 'independent' && parsedData) {
                        const uniqueGroups = Array.from(new Set(parsedData.data.map(row => row[selectedCol]))).filter(group => group !== null && group !== undefined) as string[];
                        setAvailableGroups(uniqueGroups);
                        if (uniqueGroups.length > 2) {
                          setShowGroupSelection(true);
                        } else {
                          setShowGroupSelection(false);
                          if (uniqueGroups.length === 2) {
                             setSelectedGroups(uniqueGroups); // Auto-select if exactly two groups
                          } else if (uniqueGroups.length < 2) {
                             setGroupSelectionError('Grouping column must contain at least two unique values for Independent T-Test.');
                          }
                        }
                      } else {
                         setAvailableGroups([]);
                         setShowGroupSelection(false);
                         setGroupSelectionError(null);
                      }
                    }}
                    label="Grouping Column"
                  >
                    {parsedData.columns.length === 0 ? (
                      <MenuItem value="" disabled>
                        No columns available
                      </MenuItem>
                    ) : (
                      parsedData.columns.map((col) => (
                        <MenuItem key={col} value={col}>
                          {col}
                        </MenuItem>
                      ))
                    )}
                  </Select>
                </FormControl>
              </Grid>
            )}

            {/* New group selection dropdown for Independent T-Test */}
            {testType === 'independent' && showGroupSelection && (
              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!groupSelectionError}>
                  <InputLabel>Select first group</InputLabel>
                  <Select
                    value={selectedGroups[0] || ''}
                    onChange={(e) => {
                      const value = e.target.value as string;
                      setSelectedGroups([value, selectedGroups[1] || '']);
                      setGroupSelectionError(null);
                    }}
                    label="Select first group"
                  >
                    {availableGroups.map((group) => (
                      <MenuItem key={group} value={group}>
                        {group}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}

            {testType === 'independent' && showGroupSelection && (
              <Grid item xs={12} md={6}>
                <FormControl fullWidth error={!!groupSelectionError}>
                  <InputLabel>Select second group</InputLabel>
                  <Select
                    value={selectedGroups[1] || ''}
                    onChange={(e) => {
                      const value = e.target.value as string;
                      setSelectedGroups([selectedGroups[0] || '', value]);
                      setGroupSelectionError(null);
                    }}
                    label="Select second group"
                  >
                    {availableGroups.map((group) => (
                      <MenuItem key={group} value={group}>
                        {group}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}

            {testType === 'paired' && (
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Pairing Key</InputLabel>
                  <Select
                    value={pairingKey}
                    onChange={(e) => setPairingKey(e.target.value as string)}
                    label="Pairing Key"
                  >
                    {parsedData.columns.length === 0 ? (
                      <MenuItem value="" disabled>
                        No columns available
                      </MenuItem>
                    ) : (
                      parsedData.columns.map((col) => (
                        <MenuItem key={col} value={col}>
                          {col}
                        </MenuItem>
                      ))
                    )}
                  </Select>
                </FormControl>
              </Grid>
            )}

            {testType === 'one-sample' && (
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  type="number"
                  label="Population Mean"
                  value={populationMean}
                  onChange={(e) => setPopulationMean(Number(e.target.value))}
                />
              </Grid>
            )}

            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Significance Level (α)</InputLabel>
                <Select
                  value={significanceLevel}
                  onChange={(e) => setSignificanceLevel(Number(e.target.value))}
                  label="Significance Level (α)"
                >
                  <MenuItem value={0.01}>1% (α = 0.01)</MenuItem>
                  <MenuItem value={0.05}>5% (α = 0.05)</MenuItem>
                  <MenuItem value={0.1}>10% (α = 0.1)</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <Button
                variant="contained"
                color="primary"
                onClick={handlePerformTest}
                disabled={isProcessing || !metricColumn || 
                          (testType === 'independent' && (!groupingColumn || (showGroupSelection && selectedGroups.length !== 2) || (!showGroupSelection && availableGroups.length !== 2))) ||
                          (testType === 'one-sample' && (populationMean === undefined || populationMean === null)) ||
                          (testType === 'paired' && !pairingKey) ||
                          !!error || !!groupSelectionError
                         }
              >
                Perform Test
              </Button>
            </Grid>
          </Grid>
        )}

        {isProcessing ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <CircularProgress />
          </Box>
        ) : result && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="h6" gutterBottom>
              Test Results
            </Typography>
            
            <Grid container spacing={2}>
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
                      <strong>Null Hypothesis (H₀):</strong> Population mean (μ) = {result.populationMean}
                    </Typography>
                    <Typography>
                      <strong>Alternative Hypothesis (H₁):</strong> Population mean (μ) ≠ {result.populationMean}
                    </Typography>
                    <Typography>
                      <strong>Sample Mean (x̄):</strong> {result.groupStats['Sample'].mean.toFixed(4)}
                    </Typography>
                    <Typography>
                      <strong>Sample Standard Deviation (s):</strong> {result.groupStats['Sample'].stdDev.toFixed(4)}
                    </Typography>
                    <Typography>
                      <strong>Sample Size (n):</strong> {result.groupStats['Sample'].sampleSize}
                    </Typography>
                    <Typography>
                      <strong>Standard Error (SE):</strong> {result.standardError?.toFixed(4)}
                    </Typography>
                    <Typography>
                      <strong>T-statistic:</strong> {result.tStatistic.toFixed(4)}
                    </Typography>
                    <Typography>
                      <strong>Degrees of Freedom (df):</strong> {result.degreesOfFreedom}
                    </Typography>
                    <Typography>
                      <strong>P-value:</strong> {result.pValue.toFixed(4)}
                    </Typography>
                    <Typography>
                      <strong>95% Confidence Interval:</strong> ({result.confidenceInterval?.lower.toFixed(4)}, {result.confidenceInterval?.upper.toFixed(4)})
                    </Typography>
                  </>
                )}
                {result.equalVariance !== undefined && (
                  <>
                    <Typography>
                      <strong>Equal Variance:</strong> {result.equalVariance ? 'Yes' : 'No'}
                    </Typography>
                    <Typography>
                      <strong>Levene's p-value:</strong> {result.levenePValue?.toFixed(4)}
                    </Typography>
                  </>
                )}
              </Grid>

              <Grid item xs={12}>
                <Typography variant="subtitle1" gutterBottom>
                  Group Statistics
                </Typography>
                {Object.entries(result.groupStats).map(([group, stats]) => (
                  <Box key={group} sx={{ mb: 1 }}>
                    <Typography>
                      <strong>{group}:</strong> Mean = {stats.mean.toFixed(4)}, 
                      Std Dev = {stats.stdDev.toFixed(4)}, 
                      n = {stats.sampleSize}
                    </Typography>
                  </Box>
                ))}
              </Grid>

              <Grid item xs={12}>
                <Typography variant="subtitle1" gutterBottom>
                  T-Test Results
                </Typography>
                <Typography>
                  <strong>T-statistic:</strong> {result.tStatistic.toFixed(4)}
                </Typography>
                <Typography>
                  <strong>Degrees of Freedom:</strong> {result.degreesOfFreedom.toFixed(2)}
                </Typography>
                <Typography>
                  <strong>P-value:</strong> {result.pValue.toFixed(4)}
                </Typography>
                <Typography>
                  <strong>Confidence Level:</strong> {(result.confidenceLevel * 100).toFixed(1)}%
                </Typography>
                <Typography>
                  <strong>Conclusion:</strong> {result.conclusion}
                </Typography>
                <Typography sx={{ mt: 1 }}>
                  <strong>Interpretation:</strong> {result.interpretation}
                </Typography>
              </Grid>

              {result.testType === 'Paired T-Test' && (
                <Grid item xs={12}>
                  <Typography>
                    <strong>Mean Difference:</strong> {result.meanDifference?.toFixed(4)}
                  </Typography>
                  <Typography>
                    <strong>Standard Deviation of Differences:</strong> {result.stdDevDifference?.toFixed(4)}
                  </Typography>
                </Grid>
              )}
            </Grid>
          </Box>
        )}
      </Paper>
    </Box>
  );
};

export default TTest; 