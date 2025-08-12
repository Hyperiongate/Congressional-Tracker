const express = require('express');
const path = require('path');
const app = express();

// Middleware
app.use(express.static('.'));
app.use(express.json());

// Cache for API responses
const cache = new Map();
const CACHE_DURATION = 3600000; // 1 hour

// Helper function to get cached data
function getCached(key) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }
    return null;
}

// Helper function to set cache
function setCache(key, data) {
    cache.set(key, { data, timestamp: Date.now() });
}

// More accurate ZIP to state AND district mapping for California
const zipToDistrict = {
    // Northern California
    '94': { state: 'CA', region: 'north', districts: [2, 4, 5, 11, 12, 13, 14] }, // Bay Area
    '95': { state: 'CA', region: 'north', districts: [1, 3, 4, 6, 7, 8, 9] }, // Sacramento area
    // Southern California  
    '90': { state: 'CA', region: 'south', districts: [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40] },
    '91': { state: 'CA', region: 'south', districts: [27, 28, 29, 30, 31, 32, 35, 38, 39, 40] },
    '92': { state: 'CA', region: 'south', districts: [48, 49, 50, 51, 52] }, // San Diego area
    '93': { state: 'CA', region: 'south', districts: [24, 25, 26] }, // Ventura/Santa Barbara
    
    // Other states (simplified)
    '10': { state: 'NY', region: 'all', districts: [] },
    '11': { state: 'NY', region: 'all', districts: [] },
    '20': { state: 'DC', region: 'all', districts: [0] },
    '30': { state: 'GA', region: 'all', districts: [] },
    '60': { state: 'IL', region: 'all', districts: [] },
    '98': { state: 'WA', region: 'all', districts: [] }
};

// Helper function to get state and region from ZIP
function getLocationFromZip(zipcode) {
    const prefix = zipcode.substring(0, 2);
    return zipToDistrict[prefix] || null;
}

// Main endpoint
app.get('/api/congressman/:zipcode', async (req, res) => {
    const zipcode = req.params.zipcode;
    console.log(`Request for ZIP: ${zipcode}`);
    
    try {
        // Use GitHub Pages hosted URL (the correct one!)
        const legislatorsUrl = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
        console.log('Fetching from:', legislatorsUrl);
        
        const legislatorsResponse = await fetch(legislatorsUrl);
        
        if (!legislatorsResponse.ok) {
            throw new Error(`GitHub API returned ${legislatorsResponse.status}`);
        }
        
        const legislators = await legislatorsResponse.json();
        console.log(`Found ${legislators.length} legislators`);
        
        // Find representative by state and region
        const location = getLocationFromZip(zipcode);
        console.log(`ZIP ${zipcode} -> Location:`, location);
        
        let rep = null;
        
        if (location) {
            // For California, prioritize Northern CA districts for 94xxx ZIPs
            if (location.state === 'CA' && location.region === 'north') {
                // Find reps from Northern California districts
                const northernCalReps = legislators.filter(l => {
                    const currentTerm = l.terms[l.terms.length - 1];
                    return currentTerm.state === 'CA' && 
                           currentTerm.type === 'rep' &&
                           location.districts.includes(parseInt(currentTerm.district));
                });
                
                console.log(`Found ${northernCalReps.length} Northern California representatives`);
                
                // For 94903 (Marin County), prefer district 2 or 4
                if (zipcode.startsWith('949')) {
                    rep = northernCalReps.find(r => {
                        const district = parseInt(r.terms[r.terms.length - 1].district);
                        return district === 2 || district === 4;
                    }) || northernCalReps[0];
                } else {
                    rep = northernCalReps[0];
                }
            } else if (location) {
                // For other states or regions
                rep = legislators.find(l => {
                    const currentTerm = l.terms[l.terms.length - 1];
                    return currentTerm.state === location.state && currentTerm.type === 'rep';
                });
            }
        }
        
        if (!rep) {
            // Fallback
            rep = legislators.find(l => l.terms[l.terms.length - 1].type === 'rep');
        }
        
        if (!rep) {
            throw new Error('No representative found');
        }
        
        const currentTerm = rep.terms[rep.terms.length - 1];
        const repName = rep.name.official_full || `${rep.name.first} ${rep.name.last}`;
        
        // Get campaign finance data
        let fundingData = {
            totalRaised: 'Loading...',
            sources: []
        };
        
        try {
            const apiKey = process.env.FEC_API_KEY || 'DEMO_KEY';
            const searchName = encodeURIComponent(repName);
            const fecUrl = `https://api.open.fec.gov/v1/names/candidates/?q=${searchName}&api_key=${apiKey}`;
            
            const fecResponse = await fetch(fecUrl);
            
            if (fecResponse.ok) {
                const fecData = await fecResponse.json();
                
                if (fecData.results && fecData.results.length > 0) {
                    const candidateId = fecData.results[0].id;
                    
                    const totalsUrl = `https://api.open.fec.gov/v1/candidates/${candidateId}/totals/?api_key=${apiKey}&cycle=2024`;
                    const totalsResponse = await fetch(totalsUrl);
                    
                    if (totalsResponse.ok) {
                        const totalsData = await totalsResponse.json();
                        
                        if (totalsData.results && totalsData.results.length > 0) {
                            const finances = totalsData.results[0];
                            const totalReceipts = finances.receipts || 0;
                            
                            fundingData = {
                                totalRaised: `$${totalReceipts.toLocaleString()}`,
                                totalSpent: `$${(finances.disbursements || 0).toLocaleString()}`,
                                cashOnHand: `$${(finances.cash_on_hand_end_period || 0).toLocaleString()}`,
                                sources: []
                            };
                            
                            const sources = [
                                {
                                    name: "Individual Contributions",
                                    amount: finances.individual_contributions || 0,
                                    icon: "👤"
                                },
                                {
                                    name: "PAC Contributions",
                                    amount: finances.other_political_committee_contributions || 0,
                                    icon: "🏢"
                                },
                                {
                                    name: "Party Contributions",
                                    amount: finances.party_committee_contributions || 0,
                                    icon: "🏛️"
                                }
                            ];
                            
                            fundingData.sources = sources
                                .filter(s => s.amount > 0)
                                .map(s => ({
                                    ...s,
                                    amount: `$${s.amount.toLocaleString()}`,
                                    percentage: totalReceipts > 0 ? Math.round((s.amount / totalReceipts) * 100) : 0
                                }));
                        }
                    }
                }
            }
        } catch (fecError) {
            console.error('FEC error:', fecError);
        }
        
        // Get voting records
        let votingRecords = [];
        
        try {
            const congressKey = process.env.CONGRESS_API_KEY || 'DEMO_KEY';
            const billsUrl = `https://api.data.gov/congress/v3/bill/118?api_key=${congressKey}&limit=5&sort=updateDate+desc`;
            
            const billsResponse = await fetch(billsUrl);
            
            if (billsResponse.ok) {
                const billsData = await billsResponse.json();
                
                votingRecords = billsData.bills?.slice(0, 5).map(bill => ({
                    bill: `${bill.type} ${bill.number} - ${bill.title || 'No title'}`,
                    date: bill.updateDateIncludingText || 'Unknown',
                    vote: 'See Details',
                    description: bill.title || 'Description not available',
                    status: bill.latestAction?.text || 'In progress'
                })) || [];
            }
        } catch (voteError) {
            console.error('Voting records error:', voteError);
            votingRecords = [
                {
                    bill: "Recent voting data coming soon",
                    date: new Date().toISOString().split('T')[0],
                    vote: "N/A",
                    description: "Connect Congress.gov API for real voting records"
                }
            ];
        }
        
        // Build response
        const responseData = {
            representative: {
                name: repName,
                party: currentTerm.party,
                state: currentTerm.state,
                district: currentTerm.district || 'At-Large',
                office: `${currentTerm.office || 'Representative'}, Washington, DC`,
                phone: currentTerm.phone || '(202) 225-0000',
                website: currentTerm.url || 'https://www.house.gov',
                socialMedia: {
                    twitter: rep.id?.twitter || null,
                    facebook: rep.id?.facebook || null,
                    youtube: rep.id?.youtube || null
                }
            },
            funding: fundingData,
            votingRecord: votingRecords,
            calendar: [
                {
                    date: "Visit Website",
                    time: "",
                    event: "Check Official Website for Events",
                    location: currentTerm.url || "house.gov"
                }
            ],
            transcripts: [
                {
                    title: "Congressional Record",
                    date: new Date().toISOString().split('T')[0],
                    description: "View speeches in the Congressional Record",
                    downloadUrl: "https://www.congress.gov/congressional-record"
                }
            ]
        };
        
        res.json(responseData);
        
    } catch (error) {
        console.error('Error:', error.message);
        
        res.json({
            error: true,
            message: `Unable to load data: ${error.message}`,
            representative: {
                name: "Error Loading Data",
                party: "Unknown",
                state: getStateFromZip(zipcode) || "Unknown",
                district: "Unknown",
                office: "House of Representatives",
                phone: "(202) 225-0000",
                website: "https://www.house.gov"
            },
            funding: { totalRaised: "N/A", sources: [] },
            votingRecord: [],
            calendar: [],
            transcripts: []
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK',
        apis: {
            congress: process.env.CONGRESS_API_KEY ? 'Configured' : 'No key',
            fec: process.env.FEC_API_KEY ? 'Configured' : 'No key'
        },
        cache_size: cache.size
    });
});

// Debug endpoint
app.get('/debug/test', async (req, res) => {
    try {
        const url = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
        const response = await fetch(url);
        const data = await response.json();
        
        res.json({
            success: true,
            legislators_count: data.length,
            first_legislator: data[0]?.name
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Running on port ${PORT}`);
});
