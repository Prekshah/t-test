import React from 'react';
import { Container, Typography, Box, Paper } from '@mui/material';
import FileUpload from './components/FileUpload';

const App: React.FC = () => {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box>
        <FileUpload />
      </Box>
    </Container>
  );
};

export default App;
