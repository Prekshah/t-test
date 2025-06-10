import { FC } from 'react';

interface HistogramPlotProps {
  data: number[];
  groupName: string;
}

declare const HistogramPlot: FC<HistogramPlotProps>;

export default HistogramPlot; 