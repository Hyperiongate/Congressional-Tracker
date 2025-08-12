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

// ZIP to state mapping
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
        
        // Find representative by state
        const state = getStateFromZip(zipcode);
        console.log(`ZIP ${zipcode} -> State: ${state}`);
        
        let rep = null;
        
        if (state) {
            rep = legislators.find(l => {
                const currentTerm = l.terms[l.terms.length - 1];
                return currentTerm.state === state && currentTerm.type === 'rep';
            });
        }
        
        if (!rep) {
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
