const express = require('express');
const path = require('path');
const app = express();

// Serve static files
app.use(express.static('.'));

// API endpoint for getting congressman data (example)
app.get('/api/congressman/:zipcode', async (req, res) => {
    const zipcode = req.params.zipcode;
    
    // This is where you'd call real APIs
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
