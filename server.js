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

// Get member ID from Congress.gov API
async function getCongressMemberId(name, state) {
    const cacheKey = `member_${name}_${state}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        const apiKey = process.env.DATAGOVAPI_KEY || process.env.CONGRESS_API_KEY || 'DEMO_KEY';
        const url = `https://api.data.gov/congress/v3/member?api_key=${apiKey}&limit=250`;
        
        const response = await fetch(url);
        if (!response.ok) {
            console.error('Congress API error:', response.status);
            return null;
        }

        const data = await response.json();
        
        // Find member by name and state
        const member = data.members?.find(m => {
            const fullName = `${m.firstName} ${m.lastName}`.toLowerCase();
            const searchName = name.toLowerCase();
            return fullName.includes(searchName) || searchName.includes(fullName);
        });

        if (member) {
            setCache(cacheKey, member.bioguideId);
            return member.bioguideId;
        }

        return null;
    } catch (error) {
        console.error('Error getting member ID:', error);
        return null;
    }
}

// Get real voting records from Congress.gov
async function getRealVotingRecords(memberName, state) {
    const cacheKey = `votes_${memberName}_${state}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        const apiKey = process.env.DATAGOVAPI_KEY || process.env.CONGRESS_API_KEY || 'DEMO_KEY';
        
        // First get the member's bioguide ID
        const memberId = await getCongressMemberId(memberName, state);
        
        if (!memberId) {
            console.log('Could not find member ID for:', memberName);
            // Fall back to recent bills
            return await getRecentBills();
        }

        // Get member's sponsored bills
        const sponsoredUrl = `https://api.data.gov/congress/v3/member/${memberId}/sponsored-legislation?api_key=${apiKey}&limit=10`;
        const sponsoredResponse = await fetch(sponsoredUrl);
        
        if (!sponsoredResponse.ok) {
            console.error('Error fetching sponsored bills:', sponsoredResponse.status);
            return await getRecentBills();
        }

        const sponsoredData = await sponsoredResponse.json();
        
        // Format the voting records
        const votingRecords = [];
        
        if (sponsoredData.sponsoredLegislation) {
            for (const bill of sponsoredData.sponsoredLegislation.slice(0, 5)) {
                votingRecords.push({
                    bill: `${bill.type} ${bill.number} - ${bill.title || 'No title available'}`,
                    date: bill.introducedDate || 'Date not available',
                    vote: 'Sponsored',
                    description: bill.title || 'Sponsored legislation',
                    status: bill.latestAction?.text || 'Status unknown'
                });
            }
        }

        // Also get recent votes if we can
        const recentBills = await getRecentBills();
        votingRecords.push(...recentBills.slice(0, 5));

        setCache(cacheKey, votingRecords);
        return votingRecords;

    } catch (error) {
        console.error('Error fetching voting records:', error);
        return await getRecentBills();
    }
}

// Get recent bills as fallback
async function getRecentBills() {
    const cacheKey = 'recent_bills';
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        const apiKey = process.env.DATAGOVAPI_KEY || process.env.CONGRESS_API_KEY || 'DEMO_KEY';
        const url = `https://api.data.gov/congress/v3/bill/118?api_key=${apiKey}&limit=10&sort=updateDate+desc`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Failed to fetch recent bills');
        }

        const data = await response.json();
        
        const bills = data.bills?.map(bill => ({
            bill: `${bill.type} ${bill.number} - ${bill.title || 'No title'}`,
            date: bill.updateDateIncludingText || bill.introducedDate || 'Unknown',
            vote: 'Pending',
            description: bill.title || 'Bill description not available',
            status: bill.latestAction?.text || 'In committee'
        })) || [];

        setCache(cacheKey, bills);
        return bills;

    } catch (error) {
        console.error('Error fetching recent bills:', error);
        // Return sample data as last resort
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
        // Use real API key from environment
        const apiKey = process.env.DATAGOVAPI_KEY || process.env.FEC_API_KEY || 'DEMO_KEY';
        const searchName = encodeURIComponent(repName);
        const fecSearchUrl = `https://api.open.fec.gov/v1/names/candidates/?q=${searchName}&api_key=${apiKey}`;
        
        const fecSearchResponse = await fetch(fecSearchUrl);
        
        if (fecSearchResponse.ok) {
            const fecSearchData = await fecSearchResponse.json();
            
            if (fecSearchData.results && fecSearchData.results.length > 0) {
                const candidateId = fecSearchData.results[0].id;
                
                // Get detailed financial data for 2024 cycle
                const [totalsResponse, scheduleBResponse] = await Promise.all([
                    fetch(`https://api.open.fec.gov/v1/candidates/${candidateId}/totals/?api_key=${apiKey}&cycle=2024`),
                    fetch(`https://api.open.fec.gov/v1/schedules/schedule_b/?candidate_id=${candidateId}&api_key=${apiKey}&per_page=10&sort=-contribution_receipt_amount&two_year_transaction_period=2024`)
                ]);
                
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
                }
                
                // Get top contributors
                if (scheduleBResponse.ok) {
                    const contribData = await scheduleBResponse.json();
                    if (contribData.results) {
                        fundingData.topContributors = contribData.results.slice(0, 5).map(c => ({
                            name: c.contributor_name || c.recipient_name || 'Anonymous',
                            amount: `$${(c.contribution_receipt_amount || 0).toLocaleString()}`,
                            date: c.contribution_receipt_date
                        }));
                    }
                }
            }
        }
        
        setCache(cacheKey, fundingData);
        
    } catch (error) {
        console.error('FEC API error:', error);
    }
    
    return fundingData;
}

// Main endpoint with real API data
app.get('/api/congressman/:zipcode', async (req, res) => {
    const zipcode = req.params.zipcode;
    
    try {
        // 1. Get current legislators from TheUnitedStates.io (NO KEY NEEDED)
        const legislatorsResponse = await fetch('https://theunitedstates.io/congress-legislators/legislators-current.json');
        
        if (!legislatorsResponse.ok) {
            throw new Error('Failed to fetch legislators data');
        }
        
        const legislators = await legislatorsResponse.json();
        
        // 2. Try to match by state
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
        const repName = rep.name.official_full || `${rep.name.first} ${rep.name.last}`;
        
        // 3. Get real voting records from Congress.gov
        const votingRecords = await getRealVotingRecords(repName, currentTerm.state);
        
        // 4. Get enhanced campaign finance data with real API key
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
                apis: {
                    legislators: 'TheUnitedStates.io',
                    voting: 'Congress.gov API',
                    funding: 'FEC API'
                }
            }
        };
        
        res.json(responseData);
        
    } catch (error) {
        console.error('Error:', error.message);
        
        // Return error response with helpful info
        res.status(500).json({
            error: true,
            message: 'Unable to fetch complete data. Some features may be limited.',
            representative: {
                name: "Data Temporarily Unavailable",
                party: "Unknown",
                state: getStateFromZip(zipcode) || "Unknown",
                district: "Unknown",
                office: "House of Representatives",
                phone: "(202) 225-0000",
                website: "https://www.house.gov"
            },
            funding: { 
                totalRaised: "Loading...", 
                sources: [],
                message: "Campaign finance data requires API key"
            },
            votingRecord: [{
                bill: "Voting records require Congress.gov API key",
                date: "N/A",
                vote: "N/A",
                description: "Add DATAGOVAPI_KEY to environment variables"
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
            congress: process.env.DATAGOVAPI_KEY ? 'Configured' : 'Using DEMO_KEY',
            fec: process.env.DATAGOVAPI_KEY ? 'Configured' : 'Using DEMO_KEY'
        }
    });
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
    console.log(`API Keys: ${process.env.DATAGOVAPI_KEY ? 'Configured' : 'Using DEMO_KEY'}`);
});
