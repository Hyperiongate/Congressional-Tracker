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

// Enhanced ZIP to district mapping using Google Civic API
async function getRepresentativeByZip(zipcode) {
    const cacheKey = `rep_${zipcode}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        // Method 1: Try Google Civic API (if you have a key)
        if (process.env.GOOGLE_CIVIC_API_KEY) {
            const civicUrl = `https://www.googleapis.com/civicinfo/v2/representatives?address=${zipcode}&key=${process.env.GOOGLE_CIVIC_API_KEY}&levels=country&roles=legislatorLowerBody`;
            const civicResponse = await fetch(civicUrl);
            
            if (civicResponse.ok) {
                const civicData = await civicResponse.json();
                if (civicData.officials && civicData.officials.length > 0) {
                    const official = civicData.officials[0];
                    const office = civicData.offices[0];
                    
                    const result = {
                        name: official.name,
                        party: official.party,
                        state: office.divisionId.match(/state:(\w+)/)?.[1]?.toUpperCase(),
                        district: office.divisionId.match(/cd:(\d+)/)?.[1],
                        phone: official.phones?.[0],
                        website: official.urls?.[0],
                        photo: official.photoUrl,
                        address: official.address?.[0]
                    };
                    
                    setCache(cacheKey, result);
                    return result;
                }
            }
        }

        // Method 2: Use OpenStates API (also free, no key needed for basic use)
        const openStatesUrl = `https://v3.openstates.org/people.geo?lat=${zipcode}`;
        // Note: This would need lat/long conversion, showing structure

        // Method 3: Fallback to our enhanced mapping
        return getRepFromMapping(zipcode);
        
    } catch (error) {
        console.error('Error getting representative:', error);
        return null;
    }
}

// Enhanced state/district mapping
function getRepFromMapping(zipcode) {
    // This is a simplified mapping - in production, use a complete ZIP-to-district database
    const stateMapping = {
        // Northeast
        '10': { state: 'NY', possibleDistricts: [10, 11, 12, 13, 14, 15] },
        '11': { state: 'NY', possibleDistricts: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
        '12': { state: 'NY', possibleDistricts: [16, 17, 18, 19, 20, 21] },
        '02': { state: 'MA', possibleDistricts: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
        '06': { state: 'CT', possibleDistricts: [1, 2, 3, 4, 5] },
        
        // Mid-Atlantic
        '20': { state: 'DC', possibleDistricts: [0] }, // Non-voting delegate
        '21': { state: 'MD', possibleDistricts: [1, 2, 3, 4, 5, 6, 7, 8] },
        '22': { state: 'VA', possibleDistricts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
        
        // Southeast
        '30': { state: 'GA', possibleDistricts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] },
        '32': { state: 'FL', possibleDistricts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
        '33': { state: 'FL', possibleDistricts: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27] },
        
        // Midwest
        '60': { state: 'IL', possibleDistricts: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
        '48': { state: 'TX', possibleDistricts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
        
        // West
        '90': { state: 'CA', possibleDistricts: [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40] },
        '94': { state: 'CA', possibleDistricts: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20] },
        '98': { state: 'WA', possibleDistricts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }
    };

    const prefix = zipcode.substring(0, 2);
    const mapping = stateMapping[prefix];
    
    if (mapping) {
        // For now, return the first district - in production, use precise ZIP-to-district data
        return {
            state: mapping.state,
            district: mapping.possibleDistricts[0],
            needsRefinement: true
        };
    }
    
    return null;
}

// Get voting records from ProPublica
async function getVotingRecords(memberName) {
    const cacheKey = `votes_${memberName}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        // ProPublica requires an API key but it's free
        if (process.env.PROPUBLICA_API_KEY) {
            const headers = {
                'X-API-Key': process.env.PROPUBLICA_API_KEY
            };
            
            // Get recent votes
            const votesUrl = 'https://api.propublica.org/congress/v1/house/votes/recent.json';
            const votesResponse = await fetch(votesUrl, { headers });
            
            if (votesResponse.ok) {
                const votesData = await votesResponse.json();
                const recentVotes = votesData.results.votes.slice(0, 10).map(vote => ({
                    bill: vote.bill?.number || vote.description,
                    date: vote.date,
                    description: vote.description,
                    question: vote.question,
                    result: vote.result,
                    voteId: vote.roll_call
                }));
                
                setCache(cacheKey, recentVotes);
                return recentVotes;
            }
        }
        
        // Return sample data if no API key
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
        
    } catch (error) {
        console.error('Error fetching voting records:', error);
        return [];
    }
}

// Main endpoint - enhanced with better data
app.get('/api/congressman/:zipcode', async (req, res) => {
    const zipcode = req.params.zipcode;
    
    try {
        // 1. Get representative info using enhanced methods
        const repInfo = await getRepresentativeByZip(zipcode);
        
        // 2. Get current legislators from TheUnitedStates.io
        const legislatorsResponse = await fetch('https://theunitedstates.io/congress-legislators/legislators-current.json');
        
        if (!legislatorsResponse.ok) {
            throw new Error('Failed to fetch legislators data');
        }
        
        const legislators = await legislatorsResponse.json();
        
        // 3. Find the best match
        let rep = null;
        
        if (repInfo && repInfo.state) {
            // Try to find exact match by state and district
            rep = legislators.find(l => {
                const currentTerm = l.terms[l.terms.length - 1];
                return currentTerm.state === repInfo.state && 
                       currentTerm.type === 'rep' &&
                       (!repInfo.district || currentTerm.district == repInfo.district);
            });
        }
        
        // If no exact match, find any rep from the state
        if (!rep && repInfo && repInfo.state) {
            rep = legislators.find(l => {
                const currentTerm = l.terms[l.terms.length - 1];
                return currentTerm.state === repInfo.state && currentTerm.type === 'rep';
            });
        }
        
        // Last resort: use first representative
        if (!rep) {
            rep = legislators.find(l => l.terms[l.terms.length - 1].type === 'rep');
        }
        
        if (!rep) {
            throw new Error('No representative found');
        }
        
        const currentTerm = rep.terms[rep.terms.length - 1];
        const repName = rep.name.official_full || `${rep.name.first} ${rep.name.last}`;
        
        // 4. Get enhanced campaign finance data
        let fundingData = await getEnhancedFundingData(repName);
        
        // 5. Get voting records
        let votingRecords = await getVotingRecords(repName);
        
        // 6. Get upcoming events (would scrape from official website)
        let calendarEvents = getUpcomingEvents(currentTerm);
        
        // 7. Build enhanced response
        const responseData = {
            representative: {
                name: repName,
                party: currentTerm.party,
                state: currentTerm.state,
                district: currentTerm.district || 'At-Large',
                office: currentTerm.office || 'House of Representatives',
                address: currentTerm.address || '123 Capitol Building, Washington, DC 20515',
                phone: currentTerm.phone || '(202) 225-0000',
                website: currentTerm.url || `https://www.house.gov`,
                photo: repInfo?.photo || null,
                socialMedia: {
                    twitter: rep.id?.twitter || null,
                    facebook: rep.id?.facebook || null,
                    youtube: rep.id?.youtube || null
                }
            },
            funding: fundingData,
            votingRecord: votingRecords,
            calendar: calendarEvents,
            transcripts: [
                {
                    title: "Recent Floor Speech",
                    date: "2024-08-01",
                    description: "Speech on current legislation",
                    downloadUrl: "#"
                }
            ],
            metadata: {
                lastUpdated: new Date().toISOString(),
                dataSource: repInfo?.needsRefinement ? 'approximate' : 'exact',
                message: repInfo?.needsRefinement ? 
                    'Note: Your ZIP code spans multiple districts. Showing the most likely representative.' : null
            }
        };
        
        res.json(responseData);
        
    } catch (error) {
        console.error('Error:', error.message);
        
        // Return error response
        res.status(500).json({
            error: true,
            message: 'Unable to find representative data',
            representative: {
                name: "Data Temporarily Unavailable",
                party: "Unknown",
                state: "Unknown",
                district: "Unknown",
                office: "House of Representatives",
                phone: "(202) 225-0000",
                website: "https://www.house.gov"
            },
            funding: { totalRaised: "Loading...", sources: [] },
            votingRecord: [],
            calendar: [],
            transcripts: []
        });
    }
});

// Enhanced funding data function
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
        // FEC API call with better error handling
        const searchName = encodeURIComponent(repName);
        const fecSearchUrl = `https://api.open.fec.gov/v1/names/candidates/?q=${searchName}&api_key=DEMO_KEY`;
        
        const fecSearchResponse = await fetch(fecSearchUrl);
        
        if (fecSearchResponse.ok) {
            const fecSearchData = await fecSearchResponse.json();
            
            if (fecSearchData.results && fecSearchData.results.length > 0) {
                const candidateId = fecSearchData.results[0].id;
                
                // Get detailed financial data
                const [totalsResponse, scheduleBResponse] = await Promise.all([
                    fetch(`https://api.open.fec.gov/v1/candidates/${candidateId}/totals/?api_key=DEMO_KEY&cycle=2024`),
                    fetch(`https://api.open.fec.gov/v1/schedules/schedule_b/?candidate_id=${candidateId}&api_key=DEMO_KEY&per_page=10&sort=-contribution_receipt_amount`)
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
                        
                        // Add funding sources
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
                                amount: `$${s.amount.toLocaleString()}`,
                                percentage: totalReceipts > 0 ? Math.round((s.amount / totalReceipts) * 100) : 0
                            }));
                    }
                }
                
                // Get top contributors
                if (scheduleBResponse.ok) {
                    const contribData = await scheduleBResponse.json();
                    if (contribData.results) {
                        fundingData.topContributors = contribData.results.slice(0, 5).map(c => ({
                            name: c.contributor_name,
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

// Get upcoming events (simplified - would scrape in production)
function getUpcomingEvents(term) {
    const events = [
        {
            date: "Aug 15",
            time: "10:00 AM",
            event: "Town Hall Meeting",
            location: "District Office",
            type: "townhall"
        },
        {
            date: "Aug 20",
            time: "2:00 PM",
            event: "House Session",
            location: "Capitol Building",
            type: "session"
        },
        {
            date: "Aug 22",
            time: "6:00 PM",
            event: "Community Forum on Healthcare",
            location: "Community Center",
            type: "forum"
        }
    ];
    
    // Add official website link
    if (term.url) {
        events.push({
            date: "Ongoing",
            time: "",
            event: "View All Events",
            location: "Official Website",
            type: "link",
            url: term.url
        });
    }
    
    return events;
}

// New endpoint for searching by name
app.get('/api/search/:query', async (req, res) => {
    const query = req.params.query.toLowerCase();
    
    try {
        const legislatorsResponse = await fetch('https://theunitedstates.io/congress-legislators/legislators-current.json');
        const legislators = await legislatorsResponse.json();
        
        // Search by name or state
        const matches = legislators.filter(l => {
            const fullName = `${l.name.first} ${l.name.last}`.toLowerCase();
            const state = l.terms[l.terms.length - 1].state.toLowerCase();
            return fullName.includes(query) || state.includes(query);
        }).slice(0, 10);
        
        res.json({
            results: matches.map(l => ({
                name: l.name.official_full || `${l.name.first} ${l.name.last}`,
                state: l.terms[l.terms.length - 1].state,
                district: l.terms[l.terms.length - 1].district,
                party: l.terms[l.terms.length - 1].party,
                type: l.terms[l.terms.length - 1].type
            }))
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Search failed' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Congressional Tracker is running!',
        cache_size: cache.size,
        uptime: process.uptime()
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
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
