/* eslint-env worker */
/* global jStat, Papa */
/* eslint-disable no-restricted-globals */
// tTestWorker.js

// Import necessary libraries within the worker
importScripts('https://cdnjs.cloudflare.com/ajax/libs/jstat/1.9.6/jstat.min.js');
importScripts('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.0/papaparse.min.js');

// Helper function to calculate mean (copied from TTest.tsx)
const calculateMean = (data) => {
    if (data.length === 0) return 0;
    const sum = data.reduce((acc, val) => acc + val, 0);
    return sum / data.length;
};

// Helper function to calculate standard deviation (sample standard deviation) (copied from TTest.tsx)
const calculateStdDev = (data) => {
    if (data.length < 2) return 0;
    const mean = calculateMean(data);
    const variance = data.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / (data.length - 1);
    return Math.sqrt(variance);
};

// Validate CSV Data (copied from TTest.tsx)
const validateCSVData = (data) => {
  if (!data || data.length === 0) {
    return { isValid: false, error: 'The CSV file is empty' };
  }

  // Check if all rows have the same number of columns
  // Assuming header is true and data is array of objects
  if (data.length > 0) {
      const columnCount = Object.keys(data[0]).length;
      const hasConsistentColumns = data.every(row => Object.keys(row).length === columnCount);
      if (!hasConsistentColumns) {
        return { isValid: false, error: 'The CSV file has inconsistent number of columns' };
      }
  }

  // Check for minimum number of rows (excluding header assumed by PapaParse header:true)
  if (data.length < 2) { // Need at least 2 data rows for any meaningful test
    return { isValid: false, error: 'The CSV file must contain at least 2 data rows' };
  }

  return { isValid: true, error: null };
};

// Process CSV File
const processCSVFile = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const csvText = e.target.result;
            Papa.parse(csvText, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                complete: (results) => {
                    if (results.errors.length > 0) {
                        reject(new Error('Error parsing CSV file: ' + results.errors[0].message));
                        return;
                    }
                    const validation = validateCSVData(results.data);
                    if (!validation.isValid) {
                        reject(new Error(validation.error));
                        return;
                    }
                    resolve({
                        data: results.data,
                        columns: results.meta.fields || []
                    });
                },
                error: (error) => {
                    reject(new Error('Error reading file: ' + error.message));
                }
            });
        };
        reader.onerror = () => {
            reject(new Error('Error reading file'));
        };
        reader.readAsText(file);
    });
};

// Levene's test implementation
const levenesTest = (group1Data, group2Data) => {
    // Calculate absolute deviations from group medians
    const median1 = group1Data.sort((a, b) => a - b)[Math.floor(group1Data.length / 2)];
    const median2 = group2Data.sort((a, b) => a - b)[Math.floor(group2Data.length / 2)];
    
    const absDev1 = group1Data.map(x => Math.abs(x - median1));
    const absDev2 = group2Data.map(x => Math.abs(x - median2));
    
    // Calculate means of absolute deviations
    const meanAbsDev1 = absDev1.reduce((a, b) => a + b, 0) / absDev1.length;
    const meanAbsDev2 = absDev2.reduce((a, b) => a + b, 0) / absDev2.length;
    
    // Calculate grand mean of absolute deviations
    const grandMean = (meanAbsDev1 * absDev1.length + meanAbsDev2 * absDev2.length) / (absDev1.length + absDev2.length);
    
    // Calculate sum of squares
    const ssBetween = absDev1.length * Math.pow(meanAbsDev1 - grandMean, 2) + 
                     absDev2.length * Math.pow(meanAbsDev2 - grandMean, 2);
    const ssWithin = absDev1.reduce((a, b) => a + Math.pow(b - meanAbsDev1, 2), 0) +
                    absDev2.reduce((a, b) => a + Math.pow(b - meanAbsDev2, 2), 0);
    
    // Calculate F-statistic
    const dfBetween = 1; // Number of groups - 1
    const dfWithin = absDev1.length + absDev2.length - 2;
    const msBetween = ssBetween / dfBetween;
    const msWithin = ssWithin / dfWithin;
    const fStat = msBetween / msWithin;
    
    // Calculate p-value using F-distribution
    const pValue = 1 - Math.exp(-fStat);
    
    return {
        fStatistic: fStat,
        pValue: pValue,
        equalVariance: pValue > 0.05
    };
};

// Student's t-test (equal variance)
const studentsTTest = (group1Data, group2Data) => {
    const n1 = group1Data.length;
    const n2 = group2Data.length;
    const m1 = calculateMean(group1Data);
    const m2 = calculateMean(group2Data);
    const s1 = calculateStdDev(group1Data);
    const s2 = calculateStdDev(group2Data);
    
    // Calculate pooled standard deviation
    const sp = Math.sqrt(((n1 - 1) * s1 * s1 + (n2 - 1) * s2 * s2) / (n1 + n2 - 2));
    
    // Calculate standard error
    const se = sp * Math.sqrt((1/n1) + (1/n2));
    
    // Calculate t-statistic
    const t = (m1 - m2) / se;
    
    // Calculate degrees of freedom
    const df = n1 + n2 - 2;
    
    // Calculate p-value using jStat
    const pValue = 2 * (1 - jStat.studentt.cdf(Math.abs(t), df));
    
    return {
        tStatistic: t,
        degreesOfFreedom: df,
        pValue: pValue,
        groupStats: {
            group1: { mean: m1, stdDev: s1, sampleSize: n1 },
            group2: { mean: m2, stdDev: s2, sampleSize: n2 }
        }
    };
};

// Welch's t-test (unequal variance)
const welchsTTest = (group1Data, group2Data) => {
    const n1 = group1Data.length;
    const n2 = group2Data.length;
    const m1 = calculateMean(group1Data);
    const m2 = calculateMean(group2Data);
    const s1 = calculateStdDev(group1Data);
    const s2 = calculateStdDev(group2Data);
    
    // Calculate standard error
    const se = Math.sqrt((s1 * s1 / n1) + (s2 * s2 / n2));
    
    // Calculate t-statistic
    const t = (m1 - m2) / se;
    
    // Calculate degrees of freedom (Welch-Satterthwaite equation)
    const df = Math.pow((s1 * s1 / n1) + (s2 * s2 / n2), 2) /
              (Math.pow(s1 * s1 / n1, 2) / (n1 - 1) + Math.pow(s2 * s2 / n2, 2) / (n2 - 1));
    
    // Calculate p-value using jStat
    const pValue = 2 * (1 - jStat.studentt.cdf(Math.abs(t), df));
    
    return {
        tStatistic: t,
        degreesOfFreedom: df,
        pValue: pValue,
        groupStats: {
            group1: { mean: m1, stdDev: s1, sampleSize: n1 },
            group2: { mean: m2, stdDev: s2, sampleSize: n2 }
        }
    };
};

// Helper function to validate paired data
const validatePairedData = (data, metricColumn, groupingColumn, pairingKey) => {
    // Get unique groups
    const uniqueGroups = Array.from(new Set(data.map(row => row[groupingColumn])))
        .filter(group => group !== null && group !== undefined);

    // Check if there are exactly 2 groups
    if (uniqueGroups.length !== 2) {
        throw new Error('The grouping column must contain exactly 2 unique groups (e.g., "Before" and "After").');
    }

    // Group data by pairing key
    const groupedData = {};
    data.forEach(row => {
        if (!groupedData[row[pairingKey]]) {
            groupedData[row[pairingKey]] = [];
        }
        groupedData[row[pairingKey]].push(row);
    });

    // Check if each pairing key has exactly 2 rows
    const invalidPairs = Object.entries(groupedData)
        .filter(([_, rows]) => rows.length !== 2);

    if (invalidPairs.length > 0) {
        throw new Error(`Each pairing key must have exactly 2 rows. Invalid keys: ${invalidPairs.map(([key]) => key).join(', ')}`);
    }

    return { uniqueGroups, groupedData };
};

// Helper function to reshape paired data
const reshapePairedData = (groupedData, metricColumn, groupingColumn, uniqueGroups) => {
    const pairedData = [];

    Object.entries(groupedData).forEach(([pairKey, rows]) => {
        // Sort rows by group to ensure consistent order
        rows.sort((a, b) => a[groupingColumn].localeCompare(b[groupingColumn]));
        
        const group1Value = rows[0][metricColumn];
        const group2Value = rows[1][metricColumn];

        // Skip if either value is not a valid number
        if (typeof group1Value === 'number' && typeof group2Value === 'number' &&
            !isNaN(group1Value) && !isNaN(group2Value)) {
            pairedData.push({
                pairingKey: pairKey,
                group1Value,
                group2Value,
                difference: group1Value - group2Value
            });
        }
    });

    return {
        pairedData,
        group1Name: uniqueGroups[0],
        group2Name: uniqueGroups[1]
    };
};

// Paired t-test implementation
const pairedTTest = (pairedData) => {
    const differences = pairedData.map(pair => pair.difference);
    const n = differences.length;
    
    if (n < 2) {
        throw new Error('At least 2 valid pairs are required for a paired t-test.');
    }

    // Calculate mean of differences
    const meanDiff = calculateMean(differences);
    
    // Calculate standard deviation of differences
    const stdDevDiff = calculateStdDev(differences);
    
    // Calculate t-statistic
    const t = meanDiff / (stdDevDiff / Math.sqrt(n));
    
    // Degrees of freedom
    const df = n - 1;
    
    // Calculate p-value using jStat
    const pValue = 2 * (1 - jStat.studentt.cdf(Math.abs(t), df));

    return {
        tStatistic: t,
        degreesOfFreedom: df,
        pValue: pValue,
        meanDifference: meanDiff,
        stdDevDifference: stdDevDiff,
        sampleSize: n
    };
};

// One-sample t-test implementation following the specified steps
const oneSampleTTest = (data, populationMean, significanceLevel) => {
    // Step 3: Calculate sample statistics
    const n = data.length;
    const sampleMean = calculateMean(data);
    const sampleStdDev = calculateStdDev(data);
    
    // Step 4: Calculate standard error
    const standardError = sampleStdDev / Math.sqrt(n);
    
    // Step 5: Calculate t-statistic
    const tStatistic = (sampleMean - populationMean) / standardError;
    
    // Step 6: Determine degrees of freedom
    const degreesOfFreedom = n - 1;
    
    // Step 7: Calculate p-value (two-tailed)
    const pValue = 2 * (1 - jStat.studentt.cdf(Math.abs(tStatistic), degreesOfFreedom));
    
    // Step 8: Calculate 95% confidence interval
    const tCritical = jStat.studentt.inv(0.975, degreesOfFreedom); // 95% CI, so alpha = 0.05, two-tailed
    const confidenceInterval = {
        lower: sampleMean - (tCritical * standardError),
        upper: sampleMean + (tCritical * standardError)
    };
    
    // Step 9: Make conclusion based on significance level
    const rejectNull = pValue < significanceLevel;
    
    return {
        sampleMean,
        sampleStdDev,
        sampleSize: n,
        standardError,
        tStatistic,
        degreesOfFreedom,
        pValue,
        confidenceInterval,
        rejectNull,
        populationMean
    };
};

// Perform T-Test (copied and adapted from TTest.tsx)
const performTTest = (data, metricColumn, groupingColumn, pairingKey, populationMean, significanceLevel, testType, controlGroup, treatmentGroups) => {
    try {
        // Get unique groups if not provided
        const uniqueGroups = Array.from(new Set(data.map(row => row[groupingColumn])))
            .filter(group => group !== null && group !== undefined);

        if (uniqueGroups.length < 2) {
            throw new Error('The grouping column must contain at least 2 unique groups.');
        }

        // For one-sample t-test
        if (testType === 'oneSample') {
            return oneSampleTTest(data.map(row => row[metricColumn]), populationMean, significanceLevel);
        }

        // For paired t-test
        if (testType === 'paired') {
            const validation = validatePairedData(data, metricColumn, groupingColumn, pairingKey);
            const pairedData = reshapePairedData(validation.groupedData, metricColumn, groupingColumn, validation.uniqueGroups);
            return pairedTTest(pairedData);
        }

        // For independent t-test with multiple groups
        const results = [];
        const numComparisons = treatmentGroups.length; // For Bonferroni correction
        const adjustedAlpha = significanceLevel / numComparisons;

        // Get control group data
        const controlData = data
            .filter(row => row[groupingColumn] === controlGroup)
            .map(row => row[metricColumn])
            .filter(val => val !== null && val !== undefined);

        // Perform tests for each treatment group vs control
        treatmentGroups.forEach(treatmentGroup => {
            const treatmentData = data
                .filter(row => row[groupingColumn] === treatmentGroup)
                .map(row => row[metricColumn])
                .filter(val => val !== null && val !== undefined);

            // Perform Levene's test
            const leveneResult = levenesTest(controlData, treatmentData);

            // Choose appropriate t-test based on Levene's result
            const tTestResult = leveneResult.equalVariance ? 
                studentsTTest(controlData, treatmentData) :
                welchsTTest(controlData, treatmentData);

            // Add test details to results
            results.push({
                controlGroup,
                treatmentGroup,
                testType: 'independent',
                metricType: typeof data[0][metricColumn] === 'number' ? 'continuous' : 'binary',
                equalVariance: leveneResult.equalVariance,
                levenePValue: leveneResult.pValue,
                tTestUsed: leveneResult.equalVariance ? 'Student\'s t-test' : 'Welch\'s t-test',
                tStatistic: tTestResult.tStatistic,
                degreesOfFreedom: tTestResult.degreesOfFreedom,
                pValue: tTestResult.pValue,
                adjustedAlpha,
                significanceLevel,
                conclusion: tTestResult.pValue < adjustedAlpha ? 'Reject null hypothesis' : 'Fail to reject null hypothesis',
                interpretation: `Using ${leveneResult.equalVariance ? 'Student\'s' : 'Welch\'s'} t-test (based on Levene's test p=${leveneResult.pValue.toFixed(4)}), ` +
                    `the difference between ${controlGroup} and ${treatmentGroup} is ` +
                    `${tTestResult.pValue < adjustedAlpha ? 'statistically significant' : 'not statistically significant'} ` +
                    `at the Bonferroni-adjusted significance level of ${adjustedAlpha.toFixed(4)} (original α=${significanceLevel})`,
                groupStats: {
                    [controlGroup]: tTestResult.groupStats.group1,
                    [treatmentGroup]: tTestResult.groupStats.group2
                }
            });
        });

        return results;
    } catch (error) {
        throw new Error(`Error performing t-test: ${error.message}`);
    }
};

// Handle messages from the main thread
self.onmessage = async (event) => {
    try {
        const { type, payload } = event.data;

        if (type === 'FILE_UPLOAD') {
            try {
                const result = await processCSVFile(payload);
                self.postMessage({ type: 'FILE_PROCESSED', payload: result });
            } catch (error) {
                self.postMessage({ type: 'ERROR', payload: { message: error.message } });
            }
        } else if (type === 'PERFORM_TEST') {
            try {
                const result = performTTest(
                    payload.data,
                    payload.metricColumn,
                    payload.groupingColumn,
                    payload.pairingKey,
                    payload.populationMean,
                    payload.significanceLevel,
                    payload.testType,
                    payload.controlGroup,
                    payload.treatmentGroups
                );
                self.postMessage({ type: 'TEST_COMPLETE', payload: result });
            } catch (error) {
                self.postMessage({ type: 'ERROR', payload: { message: error.message } });
            }
        }
    } catch (error) {
        self.postMessage({ type: 'ERROR', payload: { message: error.message } });
    }
}; 