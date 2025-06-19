import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface HistogramPlotProps {
  data: number[];
  groupName: string;
}

interface HistogramBin extends d3.Bin<number, number> {
  x0: number | undefined;
  x1: number | undefined;
  length: number;
}

const HistogramPlot: React.FC<HistogramPlotProps> = ({ data, groupName }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!data || data.length === 0 || !svgRef.current) return;

    // Filter out invalid data
    const validData = data.filter(d => typeof d === 'number' && !isNaN(d) && isFinite(d));
    if (validData.length === 0) return;

    // Clear previous plot
    d3.select(svgRef.current).selectAll("*").remove();

    // Set dimensions with increased margins and overall size
    const margin = { top: 50, right: 30, bottom: 60, left: 60 };
    const width = 500 - margin.left - margin.right;
    const height = 350 - margin.top - margin.bottom;

    // Create SVG with proper sizing
    const svg = d3.select(svgRef.current)
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
      .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%")
      .style("height", "auto")
      .style("max-width", "100%");

    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Calculate optimal bin count
    const binCount = Math.max(3, Math.min(Math.ceil(Math.sqrt(validData.length)), 20));
    
    // Create histogram bins with proper thresholds
    const extent = d3.extent(validData) as [number, number];
    const histogram = d3.histogram<number, number>()
      .domain(extent)
      .thresholds(binCount)
      (validData);

    // Ensure we have valid bins
    if (!histogram || histogram.length === 0) return;

    // Create scales with proper domains
    const xDomain = extent;
    
    const x = d3.scaleLinear()
      .domain([xDomain[0] - (xDomain[1] - xDomain[0]) * 0.05, xDomain[1] + (xDomain[1] - xDomain[0]) * 0.05])
      .range([0, width]);

    const maxCount = d3.max(histogram, (d: HistogramBin) => d.length) || 1;
    const y = d3.scaleLinear()
      .domain([0, maxCount * 1.1])
      .range([height, 0]);

    // Add bars with improved styling
    g.selectAll("rect")
      .data(histogram)
      .enter()
      .append("rect")
      .attr("x", (d: HistogramBin) => x(d.x0 || 0))
      .attr("y", (d: HistogramBin) => y(d.length))
      .attr("width", (d: HistogramBin) => {
        const width = x(d.x1 || 0) - x(d.x0 || 0);
        return Math.max(0, width - 2); // 2px gap between bars
      })
      .attr("height", (d: HistogramBin) => height - y(d.length))
      .style("fill", "#69b3a2")
      .style("opacity", 0.8)
      .style("stroke", "#ffffff")
      .style("stroke-width", 1);

    // Add x-axis with improved formatting
    const xAxis = d3.axisBottom(x)
      .ticks(Math.min(8, binCount))
      .tickFormat(d3.format(".2f"));

    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(xAxis)
      .selectAll("text")
      .style("font-size", "11px")
      .style("font-family", "Arial, sans-serif");

    // Add x-axis label
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("x", width / 2)
      .attr("y", height + 40)
      .style("font-size", "12px")
      .style("font-family", "Arial, sans-serif")
      .style("fill", "#333")
      .text("Value");

    // Add y-axis with improved formatting
    const yAxis = d3.axisLeft(y)
      .ticks(6)
      .tickFormat(d3.format("d"));

    g.append("g")
      .call(yAxis)
      .selectAll("text")
      .style("font-size", "11px")
      .style("font-family", "Arial, sans-serif");

    // Add y-axis label
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("transform", "rotate(-90)")
      .attr("y", -40)
      .attr("x", -height / 2)
      .style("font-size", "12px")
      .style("font-family", "Arial, sans-serif")
      .style("fill", "#333")
      .text("Frequency");

    // Add title with improved positioning and styling
    g.append("text")
      .attr("x", width / 2)
      .attr("y", -20)
      .attr("text-anchor", "middle")
      .style("font-size", "14px")
      .style("font-weight", "600")
      .style("font-family", "Arial, sans-serif")
      .style("fill", "#333")
      .text(`Distribution for ${groupName}`);

    // Add statistics text
    const mean = d3.mean(validData) || 0;
    const stdDev = d3.deviation(validData) || 0;
    
    g.append("text")
      .attr("x", width - 10)
      .attr("y", 20)
      .attr("text-anchor", "end")
      .style("font-size", "10px")
      .style("font-family", "Arial, sans-serif")
      .style("fill", "#666")
      .text(`n=${validData.length}, μ=${mean.toFixed(2)}, σ=${stdDev.toFixed(2)}`);

  }, [data, groupName]);

  // Add responsive container with better error handling
  return (
    <div style={{ 
      width: '100%', 
      height: '100%', 
      minHeight: '350px', 
      padding: '10px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      {(!data || data.length === 0) ? (
        <div style={{ 
          padding: '20px', 
          textAlign: 'center', 
          color: '#666',
          fontSize: '14px'
        }}>
          No data available for visualization
        </div>
      ) : (
        <svg 
          ref={svgRef} 
          style={{ 
            maxWidth: '100%', 
            height: 'auto',
            minHeight: '300px',
            display: 'block'
          }}
        />
      )}
    </div>
  );
};

export default HistogramPlot; 