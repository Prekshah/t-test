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
    if (!data.length || !svgRef.current) return;

    // Clear previous plot
    d3.select(svgRef.current).selectAll("*").remove();

    // Set dimensions with increased margins and overall size
    const margin = { top: 50, right: 30, bottom: 40, left: 50 };
    const width = 500 - margin.left - margin.right;
    const height = 300 - margin.top - margin.bottom;

    // Create SVG with responsive container
    const svg = d3.select(svgRef.current)
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Create histogram bins with optimized bin count
    const binCount = Math.min(Math.ceil(Math.sqrt(data.length)), 15); // Limit maximum bins
    const histogram = d3.histogram<number, number>()
      .domain(d3.extent(data) as [number, number])
      .thresholds(d3.thresholdScott)(data);

    // Create scales with padding
    const x = d3.scaleLinear()
      .domain([
        d3.min(data) || 0 - Math.abs((d3.min(data) || 0) * 0.1),
        d3.max(data) || 1 + Math.abs((d3.max(data) || 1) * 0.1)
      ])
      .range([0, width]);

    const y = d3.scaleLinear()
      .domain([0, (d3.max(histogram, (d: HistogramBin) => d.length) || 1) * 1.1]) // Add 10% padding
      .range([height, 0]);

    // Add bars with improved styling
    svg.selectAll("rect")
      .data(histogram)
      .enter()
      .append("rect")
      .attr("x", (d: HistogramBin) => x(d.x0 || 0))
      .attr("y", (d: HistogramBin) => y(d.length))
      .attr("width", (d: HistogramBin) => Math.max(0, x(d.x1 || 0) - x(d.x0 || 0) - 1)) // Add 1px gap
      .attr("height", (d: HistogramBin) => height - y(d.length))
      .style("fill", "#69b3a2")
      .style("opacity", 0.8);

    // Add x-axis with improved labels
    svg.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x))
      .selectAll("text")
      .style("font-size", "12px");

    // Add x-axis label
    svg.append("text")
      .attr("text-anchor", "middle")
      .attr("x", width / 2)
      .attr("y", height + margin.bottom - 5)
      .style("font-size", "12px")
      .text("Value");

    // Add y-axis with improved labels
    svg.append("g")
      .call(d3.axisLeft(y))
      .selectAll("text")
      .style("font-size", "12px");

    // Add y-axis label
    svg.append("text")
      .attr("text-anchor", "middle")
      .attr("transform", "rotate(-90)")
      .attr("y", -margin.left + 15)
      .attr("x", -height / 2)
      .style("font-size", "12px")
      .text("Frequency");

    // Add title with improved positioning and styling
    svg.append("text")
      .attr("x", width / 2)
      .attr("y", -margin.top / 2)
      .attr("text-anchor", "middle")
      .style("font-size", "14px")
      .style("font-weight", "500")
      .text(`Distribution for ${groupName}`);

  }, [data, groupName]);

  // Add responsive container
  return (
    <div style={{ width: '100%', height: '100%', minHeight: '300px', padding: '10px 0' }}>
      <svg ref={svgRef} style={{ maxWidth: '100%', height: 'auto' }}></svg>
    </div>
  );
};

export default HistogramPlot; 