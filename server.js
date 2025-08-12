const express = require('express');
const path = require('path');
const app = express();

// Middleware
app.use(express.static('.'));
app.use(express.json());

// Main endpoint - works without any API keys!
app.get('/api/congressman/:zipcode', async (req, res) => {
    const zipcode = req.params.zipcode;
    
    try {
        // 1. Get current legislators from TheUnitedStates.io (NO KEY NEEDED)
        const legislatorsResponse = await fetch('https://theunitedstates.io/congress-legislators/legislators-current.json');
        const legislators = await legislatorsResponse.json();
        
        // 2. For demo, return first legislator (in production, match by ZIP)
        const rep = legislators[0];
        
        // 3. Get campaign finance from FEC using DEMO_KEY
        let fundingData = null;
        try {
            const fecSearchUrl = `https://api.open.fec.gov/v1/names/candidates/?q=${encodeURIComponent(rep.name.official_full)}&api_key=DEMO_KEY`;
            const fecSearchResponse = await fetch(fecSearchUrl);
            const fecSearchData = await fecSearchResponse.json();
            
            if (fecSearchData.results && fecSearchData.results.length > 0) {
                const candidateId = fecSearchData.results[0].id;
                const fecFinanceUrl = `https://api.open.fec.gov/v1/candidates/${candidateId}/totals/?api_key=DEMO_KEY`;
                const fecFinanceResponse = await fetch(fecFinanceUrl);
                const fecFinanceData = await fecFinanceResponse.json();
                
                if (fecFinanceData.results && fecFinanceData.results.length > 0) {
                    const finances = fecFinanceData.results[0];
                    fundingData = {
                        totalRaised: `$${(finances.receipts || 0).toLocaleString()}`,
                        sources: [
                            {
                                name: "Individual Contributions",
                                amount: `$${(finances.individual_contributions || 0).toLocaleString()}`,
                                percentage: finances.receipts ? Math.round((finances.individual_contributions / finances.receipts) * 100) : 0
                            },
                            {
                                name: "PAC Contributions", 
                                amount: `$${(finances.other_political_committee_contributions || 0).toLocaleString()}`,
                                percentage: finances.receipts ? Math.round((finances.other_political_committee_contributions / finances.receipts) * 100) : 0
                            }
                        ]
                    };
                }
            }
        } catch (fecError) {
            console.error('FEC API error:', fecError);
        }
        
        // 4. Build response
        const responseData = {
            representative: {
                name: rep.name.official_full,
                party: rep.terms[rep.terms.length - 1].party,
                state: rep.terms[rep.terms.length - 1].state,
                district: rep.terms[rep.terms.length - 1].district || 'At-Large',
                office: `${rep.terms[rep.terms.length - 1].office}, Washington, DC`,
                phone: rep.terms[rep.terms.length - 1].phone || 'Not available',
                website: rep.terms[rep.terms.length - 1].url || 'Not available'
            },
            funding: fundingData || {
                totalRaised: 'Loading...',
                sources: []
            },
            // Sample data for other sections - replace with real data later
            votingRecord: [
                {
                    bill: "H.R. 1234 - Infrastructure Investment Act",
                    date: "2024-03-15",
                    vote: "Yes",
                    description: "A bill to provide funding for national infrastructure improvements"
                }
            ],
            calendar: [
                {
                    date: "Aug 15",
                    time: "10:00 AM",
                    event: "Town Hall Meeting",
                    location: "District Office"
                }
            ],
            transcripts: [
                {
                    title: "Recent Floor Speech",
                    date: "2024-08-01",
                    description: "Speech on current legislation",
                    downloadUrl: "#"
                }
            ]
        };
        
        res.json(responseData);
        
    } catch (error) {
        console.error('Error:', error);
        
        // Return sample data if APIs fail
        res.json({
            representative: {
                name: "Sample Representative",
                party: "Independent",
                state: "CA",
                district: "12",
                office: "123 Capitol Building, Washington, DC 20515",
                phone: "(202) 555-0123",
                website: "https://www.house.gov"
            },
            funding: {
                totalRaised: "$2,345,678",
                sources: [
                    { name: "Individual Contributions", amount: "$1,234,567", percentage: 52.6 },
                    { name: "PAC Contributions", amount: "$876,543", percentage: 37.4 }
                ]
            },
            votingRecord: [],
            calendar: [],
            transcripts: []
        });
    }
});

// Serve index.html for all routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
