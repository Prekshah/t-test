import React from 'react';
import { Container, Box } from '@mui/material';
import StatisticalAnalysis from './components/StatisticalAnalysis';

const App: React.FC = () => {
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box>
        <StatisticalAnalysis />
      </Box>
    </Container>
  );
};

export default App;
