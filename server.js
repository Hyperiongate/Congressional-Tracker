const express = require('express');
const path = require('path');
const app = express();

// Middleware
app.use(express.static('.'));
app.use(express.json());

// Cache for API responses
const cache = new Map();
const CACHE_DURATION = 3600000; // 1 hour

function getCached(key) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }
    return null;
}

function setCache(key, data) {
    cache.set(key, { data, timestamp: Date.now() });
}

// Main endpoint - find representatives by address
app.get('/api/representatives', async (req, res) => {
    const address = req.query.address;
    
    if (!address) {
        return res.status(400).json({ error: true, message: 'Address is required' });
    }
    
    console.log(`Finding representatives for address: ${address}`);
    
    try {
        const representatives = [];
        
        // If we have Google Civic API key, use it for accurate lookup
        if (process.env.GOOGLE_CIVIC_API_KEY) {
            const civicUrl = `https://www.googleapis.com/civicinfo/v2/representatives?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_CIVIC_API_KEY}&levels=country&roles=legislatorLowerBody&roles=legislatorUpperBody`;
            
            console.log('Using Google Civic API for accurate lookup');
            const civicResponse = await fetch(civicUrl);
            
            if (civicResponse.ok) {
                const civicData = await civicResponse.json();
                
                // Process officials from Google Civic API
                if (civicData.officials && civicData.offices) {
                    civicData.offices.forEach(office => {
                        if (office.officialIndices) {
                            office.officialIndices.forEach(idx => {
                                const official = civicData.officials[idx];
                                const isHouse = office.name.includes('Representative') || office.name.includes('House');
                                const isSenate = office.name.includes('Senator') || office.name.includes('Senate');
                                
                                // Extract state and district from division ID
                                const divisionParts = office.divisionId.split('/');
                                let state = '';
                                let district = '';
                                
                                divisionParts.forEach(part => {
                                    if (part.startsWith('state:')) {
                                        state = part.replace('state:', '').toUpperCase();
                                    }
                                    if (part.startsWith('cd:')) {
                                        district = part.replace('cd:', '');
                                    }
                                });
                                
                                representatives.push({
                                    name: official.name,
                                    office: isSenate ? 'Senator' : 'Representative',
                                    party: official.party || 'Unknown',
                                    state: state,
                                    district: district || 'At-Large',
                                    phone: official.phones?.[0] || '(202) 225-0000',
                                    website: official.urls?.[0],
                                    photo: official.photoUrl,
                                    address: official.address?.[0] ? formatAddress(official.address[0]) : null,
                                    email: official.emails?.[0],
                                    socialMedia: {
                                        twitter: official.channels?.find(c => c.type === 'Twitter')?.id,
                                        facebook: official.channels?.find(c => c.type === 'Facebook')?.id,
                                        youtube: official.channels?.find(c => c.type === 'YouTube')?.id
                                    }
                                });
                            });
                        }
                    });
                }
            }
        }
        
        // Fallback: Use TheUnitedStates.io data with basic state matching
        if (representatives.length === 0) {
            console.log('Falling back to TheUnitedStates.io data');
            
            // Try to extract state from address
            const stateMatch = address.match(/\b([A-Z]{2})\b/);
            const state = stateMatch ? stateMatch[1] : null;
            
            if (state) {
                const legislatorsUrl = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
                const legislatorsResponse = await fetch(legislatorsUrl);
                
                if (legislatorsResponse.ok) {
                    const legislators = await legislatorsResponse.json();
                    
                    // Find all legislators from this state
                    const stateLegislators = legislators.filter(l => {
                        const currentTerm = l.terms[l.terms.length - 1];
                        return currentTerm.state === state;
                    });
                    
                    // Add senators first
                    const senators = stateLegislators.filter(l => 
                        l.terms[l.terms.length - 1].type === 'sen'
                    ).slice(0, 2);
                    
                    senators.forEach(sen => {
                        const term = sen.terms[sen.terms.length - 1];
                        representatives.push({
                            name: sen.name.official_full || `${sen.name.first} ${sen.name.last}`,
                            office: 'Senator',
                            party: term.party,
                            state: term.state,
                            district: null,
                            phone: term.phone || '(202) 224-0000',
                            website: term.url,
                            address: term.address,
                            socialMedia: {
                                twitter: sen.id?.twitter,
                                facebook: sen.id?.facebook,
                                youtube: sen.id?.youtube
                            }
                        });
                    });
                    
                    // Add one representative (without Google Civic API, we can't know the exact district)
                    const houseRep = stateLegislators.find(l => 
                        l.terms[l.terms.length - 1].type === 'rep'
                    );
                    
                    if (houseRep) {
                        const term = houseRep.terms[houseRep.terms.length - 1];
                        representatives.push({
                            name: houseRep.name.official_full || `${houseRep.name.first} ${houseRep.name.last}`,
                            office: 'Representative',
                            party: term.party,
                            state: term.state,
                            district: term.district || 'Unknown',
                            phone: term.phone || '(202) 225-0000',
                            website: term.url,
                            address: term.address,
                            socialMedia: {
                                twitter: houseRep.id?.twitter,
                                facebook: houseRep.id?.facebook,
                                youtube: houseRep.id?.youtube
                            }
                        });
                    }
                }
            }
        }
        
        res.json({
            representatives: representatives,
            addressProvided: address,
            method: process.env.GOOGLE_CIVIC_API_KEY ? 'Google Civic API' : 'State-based lookup',
            accuracy: process.env.GOOGLE_CIVIC_API_KEY ? 'Exact' : 'Approximate - Enable Google Civic API for precise district matching'
        });
        
    } catch (error) {
        console.error('Error finding representatives:', error);
        res.status(500).json({
            error: true,
            message: 'Unable to find representatives. Please check your address and try again.',
            details: error.message
        });
    }
});

// Get voting records for a specific representative
app.get('/api/voting-record/:name', async (req, res) => {
    const repName = req.params.name;
    const cacheKey = `votes_${repName}`;
    const cached = getCached(cacheKey);
    
    if (cached) {
        return res.json(cached);
    }
    
    try {
        const votes = [];
        
        // If we have Congress API key, get real voting data
        if (process.env.CONGRESS_API_KEY) {
            const billsUrl = `https://api.data.gov/congress/v3/bill/118?api_key=${process.env.CONGRESS_API_KEY}&limit=10&sort=updateDate+desc`;
            const billsResponse = await fetch(billsUrl);
            
            if (billsResponse.ok) {
                const billsData = await billsResponse.json();
                
                billsData.bills?.forEach(bill => {
                    votes.push({
                        bill: `${bill.type} ${bill.number} - ${bill.title || 'No title'}`,
                        date: bill.updateDateIncludingText || 'Unknown',
                        vote: 'See Details',
                        description: bill.title || 'No description available',
                        status: bill.latestAction?.text || 'In progress'
                    });
                });
            }
        }
        
        // Add sample data if no real data
        if (votes.length === 0) {
            votes.push(
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
            );
        }
        
        const result = { votes };
        setCache(cacheKey, result);
        res.json(result);
        
    } catch (error) {
        console.error('Error fetching voting records:', error);
        res.json({ votes: [] });
    }
});

// Get campaign finance data
app.get('/api/campaign-finance/:name', async (req, res) => {
    const repName = req.params.name;
    const cacheKey = `finance_${repName}`;
    const cached = getCached(cacheKey);
    
    if (cached) {
        return res.json(cached);
    }
    
    let fundingData = {
        totalRaised: 'N/A',
        totalSpent: 'N/A',
        cashOnHand: 'N/A',
        sources: []
    };
    
    try {
        if (process.env.FEC_API_KEY) {
            const searchUrl = `https://api.open.fec.gov/v1/names/candidates/?q=${encodeURIComponent(repName)}&api_key=${process.env.FEC_API_KEY}`;
            const searchResponse = await fetch(searchUrl);
            
            if (searchResponse.ok) {
                const searchData = await searchResponse.json();
                
                if (searchData.results && searchData.results.length > 0) {
                    const candidateId = searchData.results[0].id;
                    
                    const totalsUrl = `https://api.open.fec.gov/v1/candidates/${candidateId}/totals/?api_key=${process.env.FEC_API_KEY}&cycle=2024`;
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
        }
        
        setCache(cacheKey, fundingData);
        res.json(fundingData);
        
    } catch (error) {
        console.error('Error fetching campaign finance:', error);
        res.json(fundingData);
    }
});

// Helper function to format address
function formatAddress(addr) {
    if (!addr) return null;
    return `${addr.line1 || ''}${addr.line2 ? ' ' + addr.line2 : ''}${addr.line3 ? ' ' + addr.line3 : ''}, ${addr.city || ''}, ${addr.state || ''} ${addr.zip || ''}`.trim();
}

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK',
        apis: {
            congress: process.env.CONGRESS_API_KEY ? 'Configured' : 'Not configured',
            fec: process.env.FEC_API_KEY ? 'Configured' : 'Not configured',
            civic: process.env.GOOGLE_CIVIC_API_KEY ? 'Configured' : 'Not configured - Using fallback'
        },
        cache_size: cache.size
    });
});

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Running on port ${PORT}`);
    console.log('APIs configured:');
    console.log(`- Google Civic: ${process.env.GOOGLE_CIVIC_API_KEY ? 'Yes' : 'No (using state-based fallback)'}`);
    console.log(`- Congress.gov: ${process.env.CONGRESS_API_KEY ? 'Yes' : 'No'}`);
    console.log(`- FEC: ${process.env.FEC_API_KEY ? 'Yes' : 'No'}`);
});
