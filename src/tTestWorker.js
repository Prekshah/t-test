/* eslint-env worker */
/* global jStat */
// tTestWorker.js

// Import necessary libraries within the worker
const Papa = require('papaparse');
const ttest = require('ttest');
importScripts('https://cdnjs.cloudflare.com/ajax/libs/jstat/1.9.6/jstat.min.js');

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

// Process CSV File (adapted from TTest.tsx)
const processCSVFile = (file) => {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
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
const performTTest = (data, metricColumn, groupingColumn, pairingKey, populationMean, significanceLevel, testType, selectedGroups, showGroupSelection, availableGroups) => {
    if (!data || !metricColumn) {
        return { error: 'Data and metric column are required.' };
    }

    let dataToAnalyze = data;
    let calculatedResult = null;
    let error = null;

    try {
        if (testType === 'one-sample') {
            if (populationMean === undefined || populationMean === null) {
                error = 'Please provide a population mean for the one-sample test.';
            } else {
                const metricData = dataToAnalyze
                    .map(row => row[metricColumn])
                    .filter(value => value !== null && value !== undefined && typeof value === 'number');
                    
                if (metricData.length === 0) {
                    error = 'No numeric data found in the metric column.';
                } else {
                    const testResult = oneSampleTTest(metricData, populationMean, significanceLevel);
                    
                    calculatedResult = {
                        testType: 'One-Sample T-Test',
                        metricType: 'Continuous',
                        groupStats: {
                            'Sample': {
                                mean: testResult.sampleMean,
                                stdDev: testResult.sampleStdDev,
                                sampleSize: testResult.sampleSize
                            }
                        },
                        populationMean: testResult.populationMean,
                        tStatistic: testResult.tStatistic,
                        degreesOfFreedom: testResult.degreesOfFreedom,
                        pValue: testResult.pValue,
                        standardError: testResult.standardError,
                        confidenceInterval: testResult.confidenceInterval,
                        confidenceLevel: 1 - significanceLevel,
                        conclusion: testResult.rejectNull ? 'Reject null hypothesis' : 'Fail to reject null hypothesis',
                        interpretation: testResult.rejectNull ?
                            `There is significant evidence that the population mean differs from ${populationMean} (p < ${significanceLevel})` :
                            `There is not enough evidence to conclude that the population mean differs from ${populationMean} (p ≥ ${significanceLevel})`
                    };
                }
            }
        } else if (testType === 'independent') {
            if (!groupingColumn) {
                error = 'Please select a grouping column for the independent test.';
            } else {
                // Get unique groups from the data
                const uniqueGroups = Array.from(new Set(data.map(row => row[groupingColumn])))
                    .filter(group => group !== null && group !== undefined);

                // Determine which groups to compare
                let groupsToCompare;
                if (showGroupSelection) {
                    // If group selection is enabled, use the selected groups
                    if (selectedGroups.length !== 2) {
                        error = 'Please select exactly two groups to compare.';
                        return { error };
                    }
                    groupsToCompare = selectedGroups;
                } else {
                    // If no group selection, check if there are exactly two groups
                    if (uniqueGroups.length !== 2) {
                        error = 'Please select exactly two groups to compare.';
                        return { error };
                    }
                    groupsToCompare = uniqueGroups;
                }

                // Filter data to include only rows with the selected groups
                dataToAnalyze = data.filter(row => groupsToCompare.includes(row[groupingColumn]));

                // Extract metric data for each group
                const group1Data = dataToAnalyze
                    .filter(row => row[groupingColumn] === groupsToCompare[0])
                    .map(row => row[metricColumn])
                    .filter(value => value !== null && value !== undefined && typeof value === 'number');

                const group2Data = dataToAnalyze
                    .filter(row => row[groupingColumn] === groupsToCompare[1])
                    .map(row => row[metricColumn])
                    .filter(value => value !== null && value !== undefined && typeof value === 'number');

                if (group1Data.length < 2 || group2Data.length < 2) {
                    error = 'Each group must have at least 2 data points for an independent t-test.';
                } else {
                    // Perform Levene's test
                    const leveneResult = levenesTest(group1Data, group2Data);
                    
                    // Perform appropriate t-test based on Levene's result
                    const testResult = leveneResult.equalVariance ? 
                        studentsTTest(group1Data, group2Data) : 
                        welchsTTest(group1Data, group2Data);

                    calculatedResult = {
                        testType: leveneResult.equalVariance ? "Student's t-test" : "Welch's t-test",
                        metricType: 'Continuous',
                        equalVariance: leveneResult.equalVariance,
                        levenePValue: leveneResult.pValue,
                        groupStats: {
                            [groupsToCompare[0]]: testResult.groupStats.group1,
                            [groupsToCompare[1]]: testResult.groupStats.group2
                        },
                        tStatistic: testResult.tStatistic,
                        degreesOfFreedom: testResult.degreesOfFreedom,
                        pValue: testResult.pValue,
                        confidenceLevel: 1 - significanceLevel,
                        conclusion: testResult.pValue < significanceLevel ? 'Reject null hypothesis' : 'Fail to reject null hypothesis',
                        interpretation: testResult.pValue < significanceLevel ? 
                            'Statistically significant difference between the groups' : 
                            'No statistically significant difference between the groups'
                    };
                }
            }
        } else if (testType === 'paired') {
            if (!pairingKey || !groupingColumn) {
                error = 'Please select both a pairing key column and a grouping column for the paired test.';
            } else {
                try {
                    // Validate and prepare the data
                    const { uniqueGroups, groupedData } = validatePairedData(data, metricColumn, groupingColumn, pairingKey);
                    
                    // Reshape the data into paired format
                    const { pairedData, group1Name, group2Name } = reshapePairedData(groupedData, metricColumn, groupingColumn, uniqueGroups);
                    
                    // Perform the paired t-test
                    const testResult = pairedTTest(pairedData);

                    // Calculate group statistics
                    const group1Values = pairedData.map(pair => pair.group1Value);
                    const group2Values = pairedData.map(pair => pair.group2Value);

                    calculatedResult = {
                        testType: 'Paired T-Test',
                        metricType: 'Continuous',
                        groupStats: {
                            [group1Name]: {
                                mean: calculateMean(group1Values),
                                stdDev: calculateStdDev(group1Values),
                                sampleSize: group1Values.length
                            },
                            [group2Name]: {
                                mean: calculateMean(group2Values),
                                stdDev: calculateStdDev(group2Values),
                                sampleSize: group2Values.length
                            }
                        },
                        tStatistic: testResult.tStatistic,
                        degreesOfFreedom: testResult.degreesOfFreedom,
                        pValue: testResult.pValue,
                        confidenceLevel: 1 - significanceLevel,
                        meanDifference: testResult.meanDifference,
                        stdDevDifference: testResult.stdDevDifference,
                        conclusion: testResult.pValue < significanceLevel ? 'Reject null hypothesis' : 'Fail to reject null hypothesis',
                        interpretation: testResult.pValue < significanceLevel ? 
                            'There is a statistically significant difference between the paired measurements' : 
                            'There is no statistically significant difference between the paired measurements'
                    };
                } catch (err) {
                    error = err.message;
                }
            }
        }
    } catch (err) {
        error = err instanceof Error ? err.message : 'An error occurred during the test calculation';
    }
    
    return { result: calculatedResult, error: error };
};

// Web Worker message handler
// eslint-disable-next-line no-restricted-globals
self.onmessage = async (event) => {
    const { type, payload } = event.data;

    if (type === 'PROCESS_FILE') {
        try {
            const parsedData = await processCSVFile(payload.file);
            // eslint-disable-next-line no-restricted-globals
            self.postMessage({ type: 'FILE_PROCESSED', payload: parsedData });
        } catch (error) {
            // eslint-disable-next-line no-restricted-globals
            self.postMessage({ type: 'ERROR', payload: { message: error.message } });
        }
    } else if (type === 'PERFORM_TEST') {
        const { data, metricColumn, groupingColumn, pairingKey, populationMean, significanceLevel, testType, selectedGroups, showGroupSelection, availableGroups } = payload;
        const { result, error } = performTTest(data, metricColumn, groupingColumn, pairingKey, populationMean, significanceLevel, testType, selectedGroups, showGroupSelection, availableGroups);
        if (error) {
            // eslint-disable-next-line no-restricted-globals
            self.postMessage({ type: 'ERROR', payload: { message: error } });
        } else {
            // eslint-disable-next-line no-restricted-globals
            self.postMessage({ type: 'TEST_COMPLETE', payload: result });
        }
    }
}; 