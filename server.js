const express = require('express');
const path = require('path');
const app = express();

// Middleware
app.use(express.static('.'));
app.use(express.json());

// Simple ZIP to state mapping (for demo - expand this in production)
const zipToState = {
    '10': 'NY', '11': 'NY', '12': 'NY', '13': 'NY', '14': 'NY',
    '20': 'DC', '21': 'MD', '22': 'VA', '23': 'VA', '24': 'VA',
    '30': 'GA', '31': 'GA', '32': 'FL', '33': 'FL', '34': 'FL',
    '40': 'KY', '41': 'KY', '42': 'KY', '43': 'OH', '44': 'OH',
    '50': 'VT', '51': 'MA', '52': 'MA', '53': 'MA', '54': 'MA',
    '60': 'IL', '61': 'IL', '62': 'IL', '63': 'MO', '64': 'MO',
    '70': 'LA', '71': 'LA', '72': 'AR', '73': 'OK', '74': 'OK',
    '80': 'CO', '81': 'CO', '82': 'WY', '83': 'ID', '84': 'UT',
    '90': 'CA', '91': 'CA', '92': 'CA', '93': 'CA', '94': 'CA',
    '95': 'CA', '96': 'CA', '97': 'OR', '98': 'WA', '99': 'AK'
};

// Helper function to get state from ZIP
function getStateFromZip(zipcode) {
    const prefix = zipcode.substring(0, 2);
    return zipToState[prefix] || null;
}

// Main endpoint - works without any API keys!
app.get('/api/congressman/:zipcode', async (req, res) => {
    const zipcode = req.params.zipcode;
    
    try {
        // 1. Get current legislators from TheUnitedStates.io (NO KEY NEEDED)
        const legislatorsResponse = await fetch('https://theunitedstates.io/congress-legislators/legislators-current.json');
        
        if (!legislatorsResponse.ok) {
            throw new Error('Failed to fetch legislators data');
        }
        
        const legislators = await legislatorsResponse.json();
        
        // 2. Try to match by state (simple approach for now)
        const state = getStateFromZip(zipcode);
        let rep = null;
        
        if (state) {
            // Find a representative from this state
            rep = legislators.find(l => {
                const currentTerm = l.terms[l.terms.length - 1];
                return currentTerm.state === state && currentTerm.type === 'rep';
            });
        }
        
        // If no rep found by state, just use first House member
        if (!rep) {
            rep = legislators.find(l => l.terms[l.terms.length - 1].type === 'rep');
        }
        
        if (!rep) {
            throw new Error('No representative found');
        }
        
        const currentTerm = rep.terms[rep.terms.length - 1];
        
        // 3. Get campaign finance from FEC using DEMO_KEY
        let fundingData = {
            totalRaised: 'Loading...',
            sources: []
        };
        
        try {
            // Search for candidate by name
            const searchName = rep.name.official_full || `${rep.name.first} ${rep.name.last}`;
            const fecSearchUrl = `https://api.open.fec.gov/v1/names/candidates/?q=${encodeURIComponent(searchName)}&api_key=DEMO_KEY`;
            
            const fecSearchResponse = await fetch(fecSearchUrl);
            
            if (fecSearchResponse.ok) {
                const fecSearchData = await fecSearchResponse.json();
                
                if (fecSearchData.results && fecSearchData.results.length > 0) {
                    const candidateId = fecSearchData.results[0].id;
                    
                    // Get financial data
                    const fecFinanceUrl = `https://api.open.fec.gov/v1/candidates/${candidateId}/totals/?api_key=DEMO_KEY&cycle=2024`;
                    const fecFinanceResponse = await fetch(fecFinanceUrl);
                    
                    if (fecFinanceResponse.ok) {
                        const fecFinanceData = await fecFinanceResponse.json();
                        
                        if (fecFinanceData.results && fecFinanceData.results.length > 0) {
                            const finances = fecFinanceData.results[0];
                            const totalReceipts = finances.receipts || 0;
                            const individualContributions = finances.individual_contributions || 0;
                            const pacContributions = finances.other_political_committee_contributions || 0;
                            const partyContributions = finances.party_committee_contributions || 0;
                            
                            fundingData = {
                                totalRaised: `$${totalReceipts.toLocaleString()}`,
                                sources: []
                            };
                            
                            if (individualContributions > 0) {
                                fundingData.sources.push({
                                    name: "Individual Contributions",
                                    amount: `$${individualContributions.toLocaleString()}`,
                                    percentage: totalReceipts > 0 ? Math.round((individualContributions / totalReceipts) * 100) : 0
                                });
                            }
                            
                            if (pacContributions > 0) {
                                fundingData.sources.push({
                                    name: "PAC Contributions",
                                    amount: `$${pacContributions.toLocaleString()}`,
                                    percentage: totalReceipts > 0 ? Math.round((pacContributions / totalReceipts) * 100) : 0
                                });
                            }
                            
                            if (partyContributions > 0) {
                                fundingData.sources.push({
                                    name: "Party Contributions",
                                    amount: `$${partyContributions.toLocaleString()}`,
                                    percentage: totalReceipts > 0 ? Math.round((partyContributions / totalReceipts) * 100) : 0
                                });
                            }
                        }
                    }
                }
            }
        } catch (fecError) {
            console.error('FEC API error:', fecError);
            // Continue with default funding data
        }
        
        // 4. Build response
        const responseData = {
            representative: {
                name: rep.name.official_full || `${rep.name.first} ${rep.name.last}`,
                party: currentTerm.party === 'Democrat' ? 'Democrat' : currentTerm.party === 'Republican' ? 'Republican' : currentTerm.party,
                state: currentTerm.state,
                district: currentTerm.district || 'At-Large',
                office: `${currentTerm.office || 'House of Representatives'}, Washington, DC`,
                phone: currentTerm.phone || '(202) 225-0000',
                website: currentTerm.url || `https://www.house.gov`
            },
            funding: fundingData,
            // Sample data for other sections - these would come from other APIs
            votingRecord: [
                {
                    bill: "H.R. 1234 - Infrastructure Investment Act",
                    date: "2024-03-15",
                    vote: "Yes",
                    description: "A bill to provide funding for national infrastructure improvements"
                },
                {
                    bill: "H.R. 5678 - Healthcare Reform Act",
                    date: "2024-02-28",
                    vote: "No",
                    description: "A bill to reform healthcare insurance regulations"
                }
            ],
            calendar: [
                {
                    date: "Aug 15",
                    time: "10:00 AM",
                    event: "Town Hall Meeting",
                    location: "District Office"
                },
                {
                    date: "Aug 20",
                    time: "2:00 PM",
                    event: "Committee Meeting",
                    location: "Capitol Building"
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
        console.error('Error:', error.message);
        
        // Return sample data if APIs fail
        res.json({
            representative: {
                name: "Data Temporarily Unavailable",
                party: "Unknown",
                state: getStateFromZip(zipcode) || "Unknown",
                district: "Unknown",
                office: "House of Representatives, Washington, DC",
                phone: "(202) 225-0000",
                website: "https://www.house.gov"
            },
            funding: {
                totalRaised: "Data loading...",
                sources: [
                    { name: "Check back later for funding data", amount: "$0", percentage: 0 }
                ]
            },
            votingRecord: [
                {
                    bill: "Voting records will be available soon",
                    date: "Coming soon",
                    vote: "N/A",
                    description: "We're working on connecting to voting record databases"
                }
            ],
            calendar: [],
            transcripts: []
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Congressional Tracker is running!' });
});

// Serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).send('Page not found');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Congressional Tracker running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to use the app`);
});
