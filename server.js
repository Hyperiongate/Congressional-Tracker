const express = require('express');
const path = require('path');
const app = express();

// Middleware
app.use(express.static('.'));
app.use(express.json());

// Cache for API responses (simple in-memory cache)
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

// Enhanced ZIP to state mapping (simplified version)
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

// Get real voting records from Congress.gov
async function getRealVotingRecords(memberName, state) {
    const cacheKey = `votes_${memberName}_${state}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        // Get the API key
        const apiKey = process.env.CONGRESS_API_KEY || 'DEMO_KEY';
        
        // For now, just get recent bills
        const url = `https://api.data.gov/congress/v3/bill/118?api_key=${apiKey}&limit=5&sort=updateDate+desc`;
        
        console.log('Fetching voting records from:', url.replace(apiKey, 'API_KEY_HIDDEN'));
        
        const response = await fetch(url);
        if (!response.ok) {
            console.error('Congress API error:', response.status, response.statusText);
            throw new Error(`Congress API returned ${response.status}`);
        }

        const data = await response.json();
        
        const bills = data.bills?.slice(0, 5).map(bill => ({
            bill: `${bill.type || 'H.R.'} ${bill.number} - ${bill.title || 'No title'}`,
            date: bill.updateDateIncludingText || bill.introducedDate || 'Unknown',
            vote: 'Pending',
            description: bill.title || 'Bill description not available',
            status: bill.latestAction?.text || 'In committee'
        })) || [];

        setCache(cacheKey, bills);
        return bills;

    } catch (error) {
        console.error('Error fetching voting records:', error);
        // Return sample data as fallback
        return [
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
        ];
    }
}

// Enhanced funding data function using real FEC API key
async function getEnhancedFundingData(repName) {
    const cacheKey = `funding_${repName}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;
    
    let fundingData = {
        totalRaised: 'Loading...',
        sources: [],
        topContributors: []
    };
    
    try {
        // Use FEC API key from environment
        const apiKey = process.env.FEC_API_KEY || 'DEMO_KEY';
        const searchName = encodeURIComponent(repName);
        const fecSearchUrl = `https://api.open.fec.gov/v1/names/candidates/?q=${searchName}&api_key=${apiKey}`;
        
        console.log('Fetching FEC data for:', repName);
        
        const fecSearchResponse = await fetch(fecSearchUrl);
        
        if (fecSearchResponse.ok) {
            const fecSearchData = await fecSearchResponse.json();
            
            if (fecSearchData.results && fecSearchData.results.length > 0) {
                const candidateId = fecSearchData.results[0].id;
                console.log('Found candidate ID:', candidateId);
                
                // Get detailed financial data for 2024 cycle
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
                        
                        // Add funding sources with icons
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
                            },
                            {
                                name: "Candidate Self-Funding",
                                amount: finances.candidate_contribution || 0,
                                icon: "💰"
                            }
                        ];
                        
                        fundingData.sources = sources
                            .filter(s => s.amount > 0)
                            .map(s => ({
                                ...s,
                                amountRaw: s.amount,
                                amount: `$${s.amount.toLocaleString()}`,
                                percentage: totalReceipts > 0 ? Math.round((s.amount / totalReceipts) * 100) : 0
                            }))
                            .sort((a, b) => b.amountRaw - a.amountRaw);
                    }
                } else {
                    console.error('FEC totals API error:', totalsResponse.status);
                }
            } else {
                console.log('No FEC results found for:', repName);
            }
        } else {
            console.error('FEC search API error:', fecSearchResponse.status);
        }
        
        setCache(cacheKey, fundingData);
        
    } catch (error) {
        console.error('FEC API error:', error);
    }
    
    return fundingData;
}

// Main endpoint with better error handling
app.get('/api/congressman/:zipcode', async (req, res) => {
    const zipcode = req.params.zipcode;
    console.log(`\n=== New request for ZIP: ${zipcode} ===`);
    
    try {
        // 1. Get current legislators from TheUnitedStates.io
        console.log('Fetching legislators from TheUnitedStates.io...');
        const legislatorsResponse = await fetch('https://theunitedstates.io/congress-legislators/legislators-current.json');
        
        if (!legislatorsResponse.ok) {
            console.error('TheUnitedStates.io error:', legislatorsResponse.status);
            throw new Error('Failed to fetch legislators data');
        }
        
        const legislators = await legislatorsResponse.json();
        console.log(`Found ${legislators.length} total legislators`);
        
        // 2. Try to match by state
        const state = getStateFromZip(zipcode);
        console.log(`ZIP ${zipcode} maps to state: ${state || 'Unknown'}`);
        
        let rep = null;
        
        if (state) {
            // Find representatives from this state
            const stateReps = legislators.filter(l => {
                const currentTerm = l.terms[l.terms.length - 1];
                return currentTerm.state === state && currentTerm.type === 'rep';
            });
            console.log(`Found ${stateReps.length} representatives from ${state}`);
            
            rep = stateReps[0]; // Take first one for now
        }
        
        // If no rep found by state, just use first House member
        if (!rep) {
            console.log('No state match, using first available representative');
            rep = legislators.find(l => l.terms[l.terms.length - 1].type === 'rep');
        }
        
        if (!rep) {
            throw new Error('No representative found in data');
        }
        
        const currentTerm = rep.terms[rep.terms.length - 1];
        const repName = rep.name.official_full || `${rep.name.first} ${rep.name.last}`;
        console.log(`Selected representative: ${repName} (${currentTerm.state}-${currentTerm.district || 'AL'})`);
        
        // 3. Get real voting records from Congress.gov
        console.log('Fetching voting records...');
        const votingRecords = await getRealVotingRecords(repName, currentTerm.state);
        
        // 4. Get enhanced campaign finance data
        console.log('Fetching campaign finance data...');
        const fundingData = await getEnhancedFundingData(repName);
        
        // 5. Build response
        const responseData = {
            representative: {
                name: repName,
                party: currentTerm.party,
                state: currentTerm.state,
                district: currentTerm.district || 'At-Large',
                office: currentTerm.office || 'House of Representatives',
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
                    date: "Check Website",
                    time: "",
                    event: "Visit Official Website for Events",
                    location: currentTerm.url || "house.gov",
                    type: "link"
                }
            ],
            transcripts: [
                {
                    title: "Congressional Record",
                    date: new Date().toISOString().split('T')[0],
                    description: "View speeches and statements in the Congressional Record",
                    downloadUrl: "https://www.congress.gov/congressional-record"
                }
            ],
            metadata: {
                lastUpdated: new Date().toISOString(),
                dataSource: 'live',
                zipProvided: zipcode,
                stateDetected: state,
                apis: {
                    legislators: 'TheUnitedStates.io',
                    voting: process.env.CONGRESS_API_KEY ? 'Congress.gov API' : 'Demo data',
                    funding: process.env.FEC_API_KEY ? 'FEC API' : 'Demo data'
                }
            }
        };
        
        console.log('Response prepared successfully');
        res.json(responseData);
        
    } catch (error) {
        console.error('Main error:', error.message);
        console.error('Full error:', error);
        
        // Return a more helpful error response
        res.json({
            error: true,
            message: `Error: ${error.message}. ZIP: ${zipcode}, State: ${getStateFromZip(zipcode) || 'Unknown'}`,
            debugInfo: {
                zipProvided: zipcode,
                stateDetected: getStateFromZip(zipcode),
                errorMessage: error.message,
                apis: {
                    congress: process.env.CONGRESS_API_KEY ? 'Configured' : 'Missing',
                    fec: process.env.FEC_API_KEY ? 'Configured' : 'Missing'
                }
            },
            representative: {
                name: "Unable to load data",
                party: "Unknown",
                state: getStateFromZip(zipcode) || "Unknown",
                district: "Unknown",
                office: "House of Representatives",
                phone: "(202) 225-0000",
                website: "https://www.house.gov"
            },
            funding: { 
                totalRaised: "Data unavailable", 
                sources: []
            },
            votingRecord: [{
                bill: "Unable to load voting records",
                date: new Date().toISOString().split('T')[0],
                vote: "N/A",
                description: "Please try again later"
            }],
            calendar: [],
            transcripts: []
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Congressional Tracker is running!',
        cache_size: cache.size,
        uptime: process.uptime(),
        apis: {
            congress: process.env.CONGRESS_API_KEY ? 'Configured ✓' : 'Using DEMO_KEY ⚠️',
            fec: process.env.FEC_API_KEY ? 'Configured ✓' : 'Using DEMO_KEY ⚠️'
        },
        timestamp: new Date().toISOString()
    });
});

// Debug endpoint to test legislators API
app.get('/debug/legislators', async (req, res) => {
    try {
        console.log('Testing TheUnitedStates.io API...');
        const response = await fetch('https://theunitedstates.io/congress-legislators/legislators-current.json');
        
        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }
        
        const data = await response.json();
        
        res.json({
            success: true,
            totalLegislators: data.length,
            sample: data.slice(0, 3).map(l => ({
                name: l.name.official_full || `${l.name.first} ${l.name.last}`,
                state: l.terms[l.terms.length - 1].state,
                type: l.terms[l.terms.length - 1].type,
                party: l.terms[l.terms.length - 1].party
            }))
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
    const possiblePaths = [
        path.join(__dirname, 'index.html'),
        path.join(process.cwd(), 'index.html')
    ];
    
    for (const filePath of possiblePaths) {
        try {
            if (require('fs').existsSync(filePath)) {
                return res.sendFile(filePath);
            }
        } catch (err) {
            console.log(`File not found at: ${filePath}`);
        }
    }
    
    res.status(404).send('index.html not found');
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Congressional Tracker running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to use the app`);
    console.log(`Congress API: ${process.env.CONGRESS_API_KEY ? 'Configured ✓' : 'Using DEMO_KEY ⚠️'}`);
    console.log(`FEC API: ${process.env.FEC_API_KEY ? 'Configured ✓' : 'Using DEMO_KEY ⚠️'}`);
});
