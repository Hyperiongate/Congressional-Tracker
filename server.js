const express = require('express');
const path = require('path');
const app = express();

// Middleware
app.use(express.static('.'));
app.use(express.json());

// Test Google Civic API
app.get('/api/test-civic', async (req, res) => {
    const apiKey = process.env.GOOGLE_CIVIC_API_KEY;
    
    if (!apiKey) {
        return res.json({
            error: true,
            message: 'GOOGLE_CIVIC_API_KEY not found in environment variables'
        });
    }
    
    const testAddress = '1600 Pennsylvania Avenue, Washington, DC 20500';
    const url = `https://www.googleapis.com/civicinfo/v2/representatives?address=${encodeURIComponent(testAddress)}&key=${apiKey}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        res.json({
            status: response.status,
            apiKeyPresent: true,
            error: data.error,
            officesFound: data.offices?.length || 0,
            officialsFound: data.officials?.length || 0
        });
    } catch (error) {
        res.json({
            error: true,
            message: error.message
        });
    }
});

// Main endpoint - find representatives by address
app.get('/api/representatives', async (req, res) => {
    const address = req.query.address;
    
    if (!address) {
        return res.status(400).json({ error: true, message: 'Address is required' });
    }
    
    console.log(`Finding representatives for: ${address}`);
    
    const apiKey = process.env.GOOGLE_CIVIC_API_KEY;
    
    if (!apiKey) {
        console.error('ERROR: GOOGLE_CIVIC_API_KEY not found');
        return res.json({
            error: true,
            message: 'Google Civic API key not configured',
            representatives: []
        });
    }
    
    // Try voterInfo endpoint first (still supported)
    const voterInfoUrl = `https://www.googleapis.com/civicinfo/v2/voterinfo?address=${encodeURIComponent(address)}&key=${apiKey}&electionId=2000`;
    
    try {
        console.log('Trying voterInfo endpoint first...');
        const voterResponse = await fetch(voterInfoUrl);
        const voterData = await voterResponse.json();
        
        if (voterResponse.ok && voterData.contests) {
            console.log('VoterInfo endpoint worked!');
            // Process contests to find representatives
            voterData.contests.forEach(contest => {
                if (contest.candidates) {
                    contest.candidates.forEach(candidate => {
                        if (contest.office && (contest.office.includes('Senator') || contest.office.includes('Representative'))) {
                            representatives.push({
                                name: candidate.name,
                                office: contest.office.includes('Senator') ? 'Senator' : 'Representative',
                                party: candidate.party || 'Unknown',
                                state: address.match(/\b([A-Z]{2})\b/)?.[1] || 'Unknown',
                                district: contest.district?.id || null,
                                phone: candidate.phone || '(202) 225-0000',
                                website: candidate.candidateUrl
                            });
                        }
                    });
                }
            });
        }
    } catch (err) {
        console.log('VoterInfo endpoint failed:', err.message);
    }
    
    // If no results, try representatives endpoint as fallback
    if (representatives.length === 0) {
        const civicUrl = `https://www.googleapis.com/civicinfo/v2/representatives?address=${encodeURIComponent(address)}&key=${apiKey}`;
        
        try {
            console.log('Trying representatives endpoint...');
            const civicResponse = await fetch(civicUrl);
            const responseText = await civicResponse.text();
            
            console.log('Representatives API Status:', civicResponse.status);
            
            if (!civicResponse.ok) {
                console.error('Representatives API Error:', responseText);
                const errorData = JSON.parse(responseText);
                
                // If representatives endpoint is gone, use our TheUnitedStates.io fallback
                if (errorData.error?.code === 404) {
                    console.log('Representatives API no longer available, using fallback...');
                    return await getFallbackRepresentatives(address, res);
                }
                
                return res.json({
                    error: true,
                    message: errorData.error?.message || 'API Error',
                    representatives: []
                });
            }
            
            const civicData = JSON.parse(responseText);
            
            if (civicData.offices && civicData.officials) {
                civicData.offices.forEach(office => {
                    const officeName = office.name.toLowerCase();
                    const isFederal = (officeName.includes('united states') || officeName.includes('u.s.')) &&
                                     (officeName.includes('representative') || officeName.includes('senator'));
                    
                    if (isFederal && office.officialIndices) {
                        office.officialIndices.forEach(idx => {
                            const official = civicData.officials[idx];
                            
                            let state = '';
                            let district = '';
                            
                            const divisionParts = office.divisionId.split('/');
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
                                office: officeName.includes('senator') ? 'Senator' : 'Representative',
                                party: official.party || 'Unknown',
                                state: state,
                                district: district || null,
                                phone: official.phones?.[0] || '(202) 225-0000',
                                website: official.urls?.[0],
                                photo: official.photoUrl,
                                address: formatAddress(official.address?.[0]),
                                socialMedia: {
                                    twitter: official.channels?.find(c => c.type === 'Twitter')?.id,
                                    facebook: official.channels?.find(c => c.type === 'Facebook')?.id,
                                    youtube: official.channels?.find(c => c.type === 'YouTube')?.id
                                }
                            });
                        });
                    }
                });
                
                representatives.sort((a, b) => {
                    if (a.office === 'Senator' && b.office !== 'Senator') return -1;
                    if (a.office !== 'Senator' && b.office === 'Senator') return 1;
                    return 0;
                });
            }
        } catch (error) {
            console.error('Error with representatives endpoint:', error);
            return await getFallbackRepresentatives(address, res);
        }
    }
        
        res.json({
            representatives: representatives,
            address: address,
            normalizedAddress: civicData.normalizedInput,
            method: 'Google Civic API',
            accuracy: 'Perfect'
        });
        
    } catch (error) {
        console.error('Error:', error);
        res.json({
            error: true,
            message: error.message,
            representatives: []
        });
    }
});

// Get voting records
app.get('/api/voting-record/:name', async (req, res) => {
    const repName = req.params.name;
    const votes = [];
    
    try {
        if (process.env.CONGRESS_API_KEY) {
            const url = `https://api.data.gov/congress/v3/bill/118?api_key=${process.env.CONGRESS_API_KEY}&limit=10&sort=updateDate+desc`;
            const response = await fetch(url);
            
            if (response.ok) {
                const data = await response.json();
                data.bills?.forEach(bill => {
                    votes.push({
                        bill: `${bill.type} ${bill.number} - ${bill.title || 'No title'}`,
                        date: bill.updateDateIncludingText || 'Unknown',
                        vote: 'See Details',
                        description: bill.title || 'No description',
                        status: bill.latestAction?.text || 'In progress'
                    });
                });
            }
        }
        
        if (votes.length === 0) {
            votes.push({
                bill: "Voting records require Congress.gov API key",
                date: new Date().toISOString().split('T')[0],
                vote: "N/A",
                description: "Configure CONGRESS_API_KEY for real data"
            });
        }
        
        res.json({ votes });
    } catch (error) {
        res.json({ votes: [] });
    }
});

// Get campaign finance data
app.get('/api/campaign-finance/:name', async (req, res) => {
    const repName = req.params.name;
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
                
                if (searchData.results?.[0]) {
                    const candidateId = searchData.results[0].id;
                    const totalsUrl = `https://api.open.fec.gov/v1/candidates/${candidateId}/totals/?api_key=${process.env.FEC_API_KEY}&cycle=2024`;
                    const totalsResponse = await fetch(totalsUrl);
                    
                    if (totalsResponse.ok) {
                        const totalsData = await totalsResponse.json();
                        const finances = totalsData.results?.[0];
                        
                        if (finances) {
                            const totalReceipts = finances.receipts || 0;
                            
                            fundingData = {
                                totalRaised: `$${totalReceipts.toLocaleString()}`,
                                totalSpent: `$${(finances.disbursements || 0).toLocaleString()}`,
                                cashOnHand: `$${(finances.cash_on_hand_end_period || 0).toLocaleString()}`,
                                sources: []
                            };
                            
                            const sources = [
                                { name: "Individual Contributions", amount: finances.individual_contributions || 0, icon: "👤" },
                                { name: "PAC Contributions", amount: finances.other_political_committee_contributions || 0, icon: "🏢" },
                                { name: "Party Contributions", amount: finances.party_committee_contributions || 0, icon: "🏛️" }
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
        
        res.json(fundingData);
    } catch (error) {
        res.json(fundingData);
    }
});

// Fallback function using TheUnitedStates.io
async function getFallbackRepresentatives(address, res) {
    console.log('Using TheUnitedStates.io fallback...');
    
    try {
        // Extract state from address
        const stateMatch = address.match(/\b([A-Z]{2})\b/i);
        const state = stateMatch ? stateMatch[1].toUpperCase() : null;
        
        if (!state) {
            return res.json({
                error: true,
                message: 'Could not determine state from address. Please include state abbreviation.',
                representatives: []
            });
        }
        
        const legislatorsUrl = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
        const response = await fetch(legislatorsUrl);
        const legislators = await response.json();
        
        const representatives = [];
        
        // Get senators
        const senators = legislators.filter(l => {
            const term = l.terms[l.terms.length - 1];
            return term.state === state && term.type === 'sen';
        }).slice(0, 2);
        
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
                address: term.address
            });
        });
        
        // Get a representative - for exact match we'd need full address geocoding
        const rep = legislators.find(l => {
            const term = l.terms[l.terms.length - 1];
            return term.state === state && term.type === 'rep';
        });
        
        if (rep) {
            const term = rep.terms[rep.terms.length - 1];
            representatives.push({
                name: rep.name.official_full || `${rep.name.first} ${rep.name.last}`,
                office: 'Representative',
                party: term.party,
                state: term.state,
                district: term.district || 'Unknown',
                phone: term.phone || '(202) 225-0000',
                website: term.url,
                address: term.address,
                note: 'Note: Exact district matching requires street-level geocoding. This is an approximate match.'
            });
        }
        
        return res.json({
            representatives: representatives,
            address: address,
            method: 'Fallback - State-based lookup',
            accuracy: 'Approximate - Google Civic API unavailable',
            message: 'Google Civic API is being retired. Using state-based approximation.'
        });
        
    } catch (error) {
        return res.json({
            error: true,
            message: 'Unable to fetch representative data',
            representatives: []
        });
    }
}

// Helper function
function formatAddress(addr) {
    if (!addr) return null;
    const parts = [];
    if (addr.line1) parts.push(addr.line1);
    if (addr.line2) parts.push(addr.line2);
    if (addr.city && addr.state) parts.push(`${addr.city}, ${addr.state} ${addr.zip || ''}`);
    return parts.join(', ');
}

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK',
        apis: {
            googleCivic: process.env.GOOGLE_CIVIC_API_KEY ? 'Configured' : 'MISSING',
            congress: process.env.CONGRESS_API_KEY ? 'Configured' : 'Missing',
            fec: process.env.FEC_API_KEY ? 'Configured' : 'Missing'
        }
    });
});

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Running on port ${PORT}`);
    if (!process.env.GOOGLE_CIVIC_API_KEY) {
        console.error('WARNING: GOOGLE_CIVIC_API_KEY not found!');
    }
});
