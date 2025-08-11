const express = require('express');
const path = require('path');
const app = express();

// Middleware
app.use(express.static('.'));
app.use(express.json());

// Environment variables for API keys (set these in Render dashboard)
const API_KEYS = {
    PROPUBLICA: process.env.PROPUBLICA_API_KEY || 'your-key-here',
    OPENSECRETS: process.env.OPENSECRETS_API_KEY || 'your-key-here',
    GOOGLE_CIVIC: process.env.GOOGLE_CIVIC_API_KEY || 'your-key-here'
};

// API endpoint for getting congressman data
app.get('/api/congressman/:zipcode', async (req, res) => {
    const zipcode = req.params.zipcode;
    
    try {
        // TODO: Add real API calls here
        // Example for when you have keys:
        /*
        // Find representative using Google Civic API
        const civicUrl = `https://www.googleapis.com/civicinfo/v2/representatives?address=${zipcode}&key=${API_KEYS.GOOGLE_CIVIC}`;
        const civicResponse = await fetch(civicUrl);
        const civicData = await civicResponse.json();
        
        // Get voting record from ProPublica
        const propublicaHeaders = { 'X-API-Key': API_KEYS.PROPUBLICA };
        // ... make ProPublica API calls
        */
        
        // For now, returning sample data
        const sampleData = {
        representative: {
            name: "John Doe",
            party: "Independent",
            state: "CA",
            district: "12",
            office: "123 Capitol Building, Washington, DC 20515",
            phone: "(202) 555-0123"
        },
        votingRecord: [
            {
                bill: "H.R. 1234 - Infrastructure Investment Act",
                date: "2024-03-15",
                vote: "Yes",
                description: "A bill to provide funding for national infrastructure improvements"
            }
        ]
    };
    
    res.json(sampleData);
});

// Serve index.html for all routes (single page app)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
