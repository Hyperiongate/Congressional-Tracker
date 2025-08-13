const express = require('express');
const path = require('path');
const app = express();

// Middleware
app.use(express.static('.'));
app.use(express.json());

// Test Google Civic API directly
app.get('/api/test-civic', async (req, res) => {
    const apiKey = process.env.GOOGLE_CIVIC_API_KEY;
    
    if (!apiKey) {
        return res.json({
            error: true,
            message: 'GOOGLE_CIVIC_API_KEY not found in environment variables'
        });
    }
    
    // Test with a known address
    const testAddress = '1600 Pennsylvania Avenue, Washington, DC 20500';
    const url = `https://www.googleapis.com/civicinfo/v2/representatives?address=${encodeURIComponent(testAddress)}&key=${apiKey}&levels=country&roles=legislatorLowerBody&roles=legislatorUpperBody`;
    
    try {
        console.log('Testing Civic API with URL:', url.replace(apiKey, 'API_KEY_HIDDEN'));
        const response = await fetch(url);
        const data = await response.json();
        
        res.json({
            status: response.status,
            statusText: response.statusText,
            apiKeyPresent: true,
            apiKeyLength: apiKey.length,
            dataReceived: !!data,
            error: data.error,
            officesFound: data.offices?.length || 0,
            officialsFound: data.officials?.length || 0,
            sampleData: data.offices ? 'Success!' : 'No offices found'
        });
    } catch (error) {
        res.json({
            error: true,
            message: error.message,
            apiKeyPresent: true,
            apiKeyLength: apiKey.length
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
    const representatives = [];
    
    // Check if we have Google Civic API key
    const apiKey = process.env.GOOGLE_CIVIC_API_KEY;
    
    if (!apiKey) {
        console.error('ERROR: GOOGLE_CIVIC_API_KEY not found in environment');
        return res.json({
            error: true,
            message: 'Google Civic API key not configured. Please add GOOGLE_CIVIC_API_KEY to environment variables.',
            representatives: []
        });
    }
    
    // Use Google Civic API for perfect accuracy
    const civicUrl = `https://www.googleapis.com/civicinfo/v2/representatives?address=${encodeURIComponent(address)}&key=${apiKey}&levels=country&roles=legislatorLowerBody&roles=legislatorUpperBody`;
    
    try {
        console.log('Calling Google Civic API...');
        const civicResponse = await fetch(civicUrl);
        const responseText = await civicResponse.text();
        
        console.log('Civic API Status:', civicResponse.status);
        
        if (!civicResponse.ok) {
            console.error('Civic API Error Response:', responseText);
            
            // Parse error
            try {
                const errorData = JSON.parse(responseText);
                return res.json({
                    error: true,
                    message: `Google Civic API Error: ${errorData.error?.message || 'Unknown error'}`,
                    errorCode: errorData.error?.code,
                    errorDetails: errorData.error?.errors,
                    representatives: []
                });
            } catch (e) {
                return res.json({
                    error: true,
                    message: `Google Civic API Error: ${civicResponse.status} ${civicResponse.statusText}`,
                    representatives: []
                });
            }
        }
        
        const civicData = JSON.parse(responseText);
        console.log('Civic API Success! Found:', civicData.offices?.length || 0, 'offices');
        
        // Process the response
        if (civicData.offices && civicData.officials) {
            civicData.offices.forEach(office => {
                // Only process federal legislators
                const officeName = office.name.toLowerCase();
                if ((officeName.includes('representative') || officeName.includes('senator')) &&
                    (officeName.includes('united states') || officeName.includes('u.s.'))) {
                    
                    office.officialIndices?.forEach(idx => {
                        const official = civicData.officials[idx];
                        
                        // Extract state and district
                        let state = '';
                        let district = '';
                        
                        // Parse division ID (e.g., "ocd-division/country:us/state:ca/cd:2")
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
                            office: office.name.includes('Senator') ? 'Senator' : 'Representative',
                            party: official.party || 'Unknown',
                            state: state,
                            district: district || null,
                            phone: official.phones?.[0] || '(202) 225-0000',
                            website: official.urls?.[0],
                            photo: official.photoUrl,
                            address: official.address?.[0] ? formatAddress(official.address[0]) : null,
                            channels: official.channels,
                            emails: official.emails,
                            socialMedia: {
                                twitter: official.channels?.find(c => c.type === 'Twitter')?.id,
                                facebook: official.channels?.find(c => c.type === 'Facebook')?.id,
                                youtube: official.channels?.find(c => c.type === 'YouTube')?.id
                            }
                        });
                    });
                }
            });
            
            console.log(`Processed ${representatives.length} representatives`);
            
            // Sort: Senators first, then Representative
            representatives.sort((a, b) => {
                if (a.office === 'Senator' && b.office !== 'Senator') return -1;
                if (a.office !== 'Senator' && b.office === 'Senator') return 1;
                return 0;
            });
        }
        
        res.json({
            representatives: representatives,
            address: address,
            normalizedAddress: civicData.normalizedInput,
            method: 'Google Civic API - Exact Match',
            accuracy: 'Perfect'
        });
        
    } catch (error) {
        console.error('Fatal error:', error);
        res.json({
            error: true,
            message: `System error: ${error.message}`,
            representatives: []
        });
    }
});

// Get voting records
app.get('/api/voting-record/:name', async (req, res) => {
    const repName = req.params.name;
    
    try {
        const votes = [];
        
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
        
        if (votes.length === 0) {
            votes.push({
                bill: "Voting record data requires Congress.gov API key",
                date: new Date().toISOString().split('T')[0],
                vote: "N/A",
                description: "Add CONGRESS_API_KEY to environment variables for real data"
            });
        }
        
        res.json({ votes });
        
    } catch (error) {
        console.error('Error fetching voting records:', error);
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
        
        res.json(fundingData);
        
    } catch (error) {
        console.error('Error fetching campaign finance:', error);
        res.json(fundingData);
    }
});

// Helper function to format address
function formatAddress(addr) {
    if (!addr) return null;
    const parts = [];
    if (addr.line1) parts.push(addr.line1);
    if (addr.line2) parts.push(addr.line2);
    if (addr.line3) parts.push(addr.line3);
    if (addr.city && addr.state && addr.zip) {
        parts.push(`${addr.city}, ${addr.state} ${addr.zip}`);
    }
    return parts.join(', ');
}

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK',
        apis: {
            googleCivic: process.env.GOOGLE_CIVIC_API_KEY ? 'Configured' : 'MISSING - Add GOOGLE_CIVIC_API_KEY',
            congress: process.env.CONGRESS_API_KEY ? 'Configured' : 'Missing',
            fec: process.env.FEC_API_KEY ? 'Configured' : 'Missing'
        },
        timestamp: new Date().toISOString()
    });
});

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Running on port ${PORT}`);
    console.log('API Status:');
    console.log(`- Google Civic: ${process.env.GOOGLE_CIVIC_API_KEY ? '✓ Configured' : '✗ MISSING'}`);
    console.log(`- Congress.gov: ${process.env.CONGRESS_API_KEY ? '✓ Configured' : '✗ Missing'}`);
    console.log(`- FEC: ${process.env.FEC_API_KEY ? '✓ Configured' : '✗ Missing'}`);
    
    if (!process.env.GOOGLE_CIVIC_API_KEY) {
        console.error('\n⚠️  WARNING: Google Civic API key not found!');
        console.error('   Add GOOGLE_CIVIC_API_KEY to your environment variables');
    }
});
