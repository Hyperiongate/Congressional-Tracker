const express = require('express');
const path = require('path');
const app = express();

// Middleware
app.use(express.static('.'));
app.use(express.json());

// ZIP to State mapping (simplified - in production use full district mapping)
const zipToState = {
    // California examples
    '94901': { state: 'CA', district: 2 },  // San Rafael
    '94903': { state: 'CA', district: 2 },
    '90210': { state: 'CA', district: 36 }, // Beverly Hills
    '94102': { state: 'CA', district: 11 }, // San Francisco
    // Add more as needed - this is just for demo
    // In production, use census.gov data or Google Civic API
};

// Simple ZIP to state fallback (first 3 digits)
const zipPrefixToState = {
    '946': 'CA', '947': 'CA', '948': 'CA', '949': 'CA',
    '100': 'NY', '101': 'NY', '102': 'NY', '103': 'NY',
    '200': 'DC', '201': 'VA', '202': 'DC',
    // Add more prefixes
};

// Cache for API responses (simple in-memory cache)
const cache = new Map();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Helper function to get state from ZIP
function getStateFromZip(zip) {
    // Check exact match first
    if (zipToState[zip]) {
        return zipToState[zip];
    }
    
    // Check prefix
    const prefix = zip.substring(0, 3);
    const state = zipPrefixToState[prefix];
    
    if (state) {
        return { state, district: null }; // Will return senators
    }
    
    // Default fallback
    return { state: 'CA', district: null };
}

// Main endpoint
app.get('/api/congressman/:zipcode', async (req, res) => {
    const zipcode = req.params.zipcode;
    
    // Check cache first
    const cacheKey = `rep-${zipcode}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return res.json(cached.data);
    }
    
    try {
        // 1. Get location info from ZIP
        const location = getStateFromZip(zipcode);
        
        // 2. Get current legislators
        const legislatorsResponse = await fetch('https://theunitedstates.io/congress-legislators/legislators-current.json');
        const legislators = await legislatorsResponse.json();
        
        // 3. Find representatives for this location
        let representatives = legislators.filter(leg => {
            const currentTerm = leg.terms[leg.terms.length - 1];
            
            // Match by state
            if (currentTerm.state !== location.state) return false;
            
            // If we have a district, match House members
            if (location.district && currentTerm.type === 'rep' && currentTerm.district == location.district) {
                return true;
            }
            
            // If no district, return senators
            if (!location.district && currentTerm.type === 'sen') {
                return true;
            }
            
            return false;
        });
        
        // If no exact match, get senators as fallback
        if (representatives.length === 0) {
            representatives = legislators.filter(leg => {
                const currentTerm = leg.terms[leg.terms.length - 1];
                return currentTerm.state === location.state && currentTerm.type === 'sen';
            });
        }
        
        // Pick first representative (in production, let user choose if multiple)
        const rep = representatives[0] || legislators[0]; // Ultimate fallback
        
        // 4. Get campaign finance data
        let fundingData = {
            totalRaised: 'Data unavailable',
            sources: []
        };
        
        try {
            // Search for candidate in FEC database
            const cleanName = rep.name.official_full.replace(/\s+Jr\.?$|\s+Sr\.?$|\s+III?$/, '');
            const fecSearchUrl = `https://api.open.fec.gov/v1/names/candidates/?q=${encodeURIComponent(cleanName)}&api_key=DEMO_KEY`;
            
            const fecSearchResponse = await fetch(fecSearchUrl);
            if (fecSearchResponse.ok) {
                const fecSearchData = await fecSearchResponse.json();
                
                if (fecSearchData.results && fecSearchData.results.length > 0) {
                    // Find best match
                    const candidate = fecSearchData.results.find(c => 
                        c.office_sought === 'H' && rep.terms[rep.terms.length - 1].type === 'rep' ||
                        c.office_sought === 'S' && rep.terms[rep.terms.length - 1].type === 'sen'
                    ) || fecSearchData.results[0];
                    
                    const candidateId = candidate.id;
                    
                    // Get financial data
                    const fecFinanceUrl = `https://api.open.fec.gov/v1/candidates/${candidateId}/totals/?api_key=DEMO_KEY&cycle=2024`;
                    const fecFinanceResponse = await fetch(fecFinanceUrl);
                    
                    if (fecFinanceResponse.ok) {
                        const fecFinanceData = await fecFinanceResponse.json();
                        
                        if (fecFinanceData.results && fecFinanceData.results.length > 0) {
                            const finances = fecFinanceData.results[0];
                            const totalReceipts = finances.receipts || 0;
                            const individualContrib = finances.individual_contributions || 0;
                            const pacContrib = finances.other_political_committee_contributions || 0;
                            const partyContrib = finances.party_committee_contributions || 0;
                            const candidateContrib = finances.candidate_contribution || 0;
                            
                            fundingData = {
                                totalRaised: `$${totalReceipts.toLocaleString()}`,
                                sources: []
                            };
                            
                            if (individualContrib > 0) {
                                fundingData.sources.push({
                                    name: "Individual Contributions",
                                    amount: `$${individualContrib.toLocaleString()}`,
                                    percentage: totalReceipts ? Math.round((individualContrib / totalReceipts) * 100) : 0
                                });
                            }
                            
                            if (pacContrib > 0) {
                                fundingData.sources.push({
                                    name: "PAC Contributions",
                                    amount: `$${pacContrib.toLocaleString()}`,
                                    percentage: totalReceipts ? Math.round((pacContrib / totalReceipts) * 100) : 0
                                });
                            }
                            
                            if (partyContrib > 0) {
                                fundingData.sources.push({
                                    name: "Party Contributions",
                                    amount: `$${partyContrib.toLocaleString()}`,
                                    percentage: totalReceipts ? Math.round((partyContrib / totalReceipts) * 100) : 0
                                });
                            }
                            
                            if (candidateContrib > 0) {
                                fundingData.sources.push({
                                    name: "Self-Funding",
                                    amount: `$${candidateContrib.toLocaleString()}`,
                                    percentage: totalReceipts ? Math.round((candidateContrib / totalReceipts) * 100) : 0
                                });
                            }
                        }
                    }
                }
            }
        } catch (fecError) {
            console.error('FEC API error:', fecError);
            // Keep default funding data
        }
        
        // 5. Build response
        const currentTerm = rep.terms[rep.terms.length - 1];
        const responseData = {
            representative: {
                name: rep.name.official_full,
                party: currentTerm.party === 'Democrat' ? 'Democratic' : currentTerm.party,
                state: currentTerm.state,
                district: currentTerm.district || 'At-Large',
                type: currentTerm.type === 'sen' ? 'Senator' : 'Representative',
                office: currentTerm.office || `${currentTerm.type === 'sen' ? 'Senate' : 'House'} Office Building, Washington, DC`,
                phone: currentTerm.phone || 'Not available',
                website: currentTerm.url || 'Not available'
            },
            funding: fundingData,
            // Sample data for now - will be replaced with real APIs
            votingRecord: [
                {
                    bill: "Recent Infrastructure Bill",
                    date: new Date().toISOString().split('T')[0],
                    vote: "Yes",
                    description: "Voting records will be available once Congress.gov API is integrated"
                }
            ],
            calendar: [
                {
                    date: "Coming Soon",
                    time: "TBD",
                    event: "Town Hall Meeting",
                    location: "Check representative's website for events"
                }
            ],
            transcripts: [
                {
                    title: "Transcripts Coming Soon",
                    date: new Date().toISOString().split('T')[0],
                    description: "Transcripts will be available once GovInfo API is integrated",
                    downloadUrl: "#"
                }
            ]
        };
        
        // Cache the response
        cache.set(cacheKey, {
            data: responseData,
            timestamp: Date.now()
        });
        
        res.json(responseData);
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            error: 'Unable to fetch representative data',
            message: 'Please try again later'
        });
    }
});

// Serve the HTML file from templates directory
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

// Serve static files from templates directory
app.use(express.static('templates'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Congressional Tracker running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to use the app`);
});
