// Ensure we always return something
        if (representatives.length === 0) {
            // At minimum, return a message to the user
            representatives.push({
                name: 'Unable to load representatives',
                type: 'Error',
                party: 'N/A',
                state: getStateFromAddress(address),
                district: 'N/A',
                phone: 'Please try again',
                website: 'https://www.house.gov/representatives/find-your-representative',
                office: 'Data temporarily unavailable',
                note: 'The congressional data service is temporarily unavailable. Please try again in a few moments or use the House.gov lookup tool.'
            });
        }
        
        console.log(`Returning ${representatives.length} representatives for ${address}`);const express = require('express');
const path = require('path');
const app = express();

// Middleware
app.use(express.static('.'));
app.use(express.json());

// Configuration
const CONFIG = {
    PORT: process.env.PORT || 3000,
    GOOGLE_CIVIC_API_KEY: process.env.GOOGLE_CIVIC_API_KEY || null,
    FEC_API_KEY: process.env.FEC_API_KEY || 'DEMO_KEY',
    CONGRESS_API_KEY: process.env.CONGRESS_API_KEY || null
};

// Cache for API responses
const cache = new Map();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Get representatives by address using Google Civic API
async function getRepresentativesByAddress(address) {
    // Check cache first
    const cacheKey = `reps-${address}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }

    const representatives = [];

    try {
        // If Google Civic API key is available, use it
        if (CONFIG.GOOGLE_CIVIC_API_KEY) {
            const url = `https://www.googleapis.com/civicinfo/v2/representatives?address=${encodeURIComponent(address)}&key=${CONFIG.GOOGLE_CIVIC_API_KEY}&levels=country&roles=legislatorUpperBody&roles=legislatorLowerBody`;
            
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                
                // Parse Google Civic API response
                if (data.officials && data.offices) {
                    data.offices.forEach(office => {
                        if (office.name.includes('United States Senate') || 
                            office.name.includes('United States House')) {
                            
                            office.officialIndices.forEach(index => {
                                const official = data.officials[index];
                                const isHouse = office.name.includes('House');
                                
                                // Extract district number if House member
                                let district = null;
                                if (isHouse) {
                                    const districtMatch = office.name.match(/District (\d+)/);
                                    district = districtMatch ? districtMatch[1] : null;
                                }
                                
                                representatives.push({
                                    name: official.name,
                                    type: isHouse ? 'Representative' : 'Senator',
                                    party: official.party === 'Democratic Party' ? 'Democrat' : 
                                           official.party === 'Republican Party' ? 'Republican' : 
                                           official.party,
                                    state: getStateFromAddress(address),
                                    district: district,
                                    phone: official.phones ? official.phones[0] : 'Not available',
                                    website: official.urls ? official.urls[0] : 'Not available',
                                    office: official.address ? formatAddress(official.address[0]) : 'Capitol Building, Washington, DC',
                                    photoUrl: official.photoUrl || null,
                                    channels: official.channels || []
                                });
                            });
                        }
                    });
                }
            }
        }
        
        // Fallback: Use TheUnitedStates.io data with state lookup
        if (representatives.length === 0) {
            const state = getStateFromAddress(address);
            // Use GitHub raw content URL to avoid SSL certificate issues
            const legislatorsResponse = await fetch('https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.json');
            
            if (legislatorsResponse.ok) {
                const legislators = await legislatorsResponse.json();
                
                // Get all legislators for the state
                const stateReps = legislators.filter(leg => {
                    const currentTerm = leg.terms[leg.terms.length - 1];
                    return currentTerm.state === state;
                });
                
                // Add senators
                stateReps.forEach(rep => {
                    const currentTerm = rep.terms[rep.terms.length - 1];
                    if (currentTerm.type === 'sen') {
                        representatives.push({
                            name: rep.name.official_full,
                            type: 'Senator',
                            party: currentTerm.party === 'Democrat' ? 'Democrat' : currentTerm.party,
                            state: currentTerm.state,
                            district: null,
                            phone: currentTerm.phone || 'Not available',
                            website: currentTerm.url || 'Not available',
                            office: currentTerm.office || 'Senate Office Building, Washington, DC',
                            bioguideId: rep.id.bioguide,
                            fecId: rep.id.fec ? rep.id.fec[0] : null
                        });
                    }
                });
                
                // Add note about House member
                if (stateReps.some(r => r.terms[r.terms.length - 1].type === 'rep')) {
                    // Without precise district info, we can't determine exact House member
                    representatives.push({
                        name: 'House Representative',
                        type: 'Representative',
                        party: 'Unknown',
                        state: state,
                        district: 'Unknown',
                        phone: 'Use address lookup for accurate info',
                        website: 'https://www.house.gov/representatives/find-your-representative',
                        office: 'House Office Building, Washington, DC',
                        note: 'For accurate House representative info, please enable Google Civic API'
                    });
                }
            }
        }
        
        // Ensure we always return something
        if (representatives.length === 0) {
            // At minimum, return a message to the user
            representatives.push({
                name: 'Unable to load representatives',
                type: 'Error',
                party: 'N/A',
                state: getStateFromAddress(address),
                district: 'N/A',
                phone: 'Please try again',
                website: 'https://www.house.gov/representatives/find-your-representative',
                office: 'Data temporarily unavailable',
                note: 'The congressional data service is temporarily unavailable. Please try again in a few moments or use the House.gov lookup tool.'
            });
        }
        
        console.log(`Returning ${representatives.length} representatives for ${address}`);
        
        // Cache the results
        cache.set(cacheKey, {
            data: representatives,
            timestamp: Date.now()
        });
        
        return representatives;
        
    } catch (error) {
        console.error('Error fetching representatives:', error);
        throw error;
    }
}

// Helper function to extract state from address
function getStateFromAddress(address) {
    // Simple regex to find state abbreviation
    const stateMatch = address.match(/\b([A-Z]{2})\b(?:\s+\d{5})?$/);
    return stateMatch ? stateMatch[1] : 'CA'; // Default to CA
}

// Helper function to format address
function formatAddress(addr) {
    if (!addr) return 'Capitol Building, Washington, DC';
    return `${addr.line1}${addr.line2 ? ', ' + addr.line2 : ''}, ${addr.city}, ${addr.state} ${addr.zip}`;
}

// API Routes
app.get('/api/representatives', async (req, res) => {
    const address = req.query.address;
    
    if (!address) {
        return res.status(400).json({
            error: 'Address parameter is required'
        });
    }
    
    try {
        const representatives = await getRepresentativesByAddress(address);
        console.log(`Found ${representatives.length} representatives for address: ${address}`);
        res.json({ representatives });
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({
            error: 'Unable to fetch representatives',
            message: 'Please check your address and try again'
        });
    }
});

// Voting record endpoint (placeholder)
app.get('/api/voting-record/:bioguideId', async (req, res) => {
    const bioguideId = req.params.bioguideId;
    
    // TODO: Implement with Congress.gov API when key is available
    res.json({
        votes: [
            {
                bill: {
                    number: 'H.R. 1234',
                    title: 'Infrastructure Investment Act'
                },
                description: 'A bill to provide funding for national infrastructure improvements',
                date: '2024-03-15',
                position: 'Yes'
            },
            {
                bill: {
                    number: 'S. 5678',
                    title: 'Healthcare Reform Act'
                },
                description: 'A bill to expand healthcare access',
                date: '2024-02-28',
                position: 'No'
            }
        ]
    });
});

// Campaign finance endpoint
app.get('/api/campaign-finance/:identifier', async (req, res) => {
    const identifier = req.params.identifier;
    
    try {
        // Search for candidate in FEC database
        const searchUrl = `https://api.open.fec.gov/v1/names/candidates/?q=${encodeURIComponent(identifier)}&api_key=${CONFIG.FEC_API_KEY}`;
        const searchResponse = await fetch(searchUrl);
        
        if (!searchResponse.ok) {
            throw new Error('FEC API error');
        }
        
        const searchData = await searchResponse.json();
        
        if (searchData.results && searchData.results.length > 0) {
            const candidateId = searchData.results[0].id;
            
            // Get financial summary
            const financeUrl = `https://api.open.fec.gov/v1/candidates/${candidateId}/totals/?api_key=${CONFIG.FEC_API_KEY}&cycle=2024`;
            const financeResponse = await fetch(financeUrl);
            
            if (financeResponse.ok) {
                const financeData = await financeResponse.json();
                
                if (financeData.results && financeData.results.length > 0) {
                    const finances = financeData.results[0];
                    
                    res.json({
                        summary: {
                            totalRaised: `$${(finances.receipts || 0).toLocaleString()}`,
                            totalSpent: `$${(finances.disbursements || 0).toLocaleString()}`,
                            cashOnHand: `$${(finances.cash_on_hand_end_period || 0).toLocaleString()}`,
                            lastReport: finances.coverage_end_date || 'Not available'
                        },
                        sources: [
                            {
                                name: 'Individual Contributions',
                                amount: `$${(finances.individual_contributions || 0).toLocaleString()}`,
                                percentage: finances.receipts ? Math.round((finances.individual_contributions / finances.receipts) * 100) : 0
                            },
                            {
                                name: 'PAC Contributions',
                                amount: `$${(finances.other_political_committee_contributions || 0).toLocaleString()}`,
                                percentage: finances.receipts ? Math.round((finances.other_political_committee_contributions / finances.receipts) * 100) : 0
                            }
                        ]
                    });
                    return;
                }
            }
        }
        
        // No data found
        res.json({
            summary: null,
            sources: []
        });
        
    } catch (error) {
        console.error('Campaign finance error:', error);
        res.json({
            summary: null,
            sources: []
        });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        apis: {
            googleCivic: CONFIG.GOOGLE_CIVIC_API_KEY ? 'configured' : 'not configured',
            fec: CONFIG.FEC_API_KEY !== 'DEMO_KEY' ? 'configured' : 'using demo key',
            congress: CONFIG.CONGRESS_API_KEY ? 'configured' : 'not configured'
        }
    });
});

// Serve HTML
app.get('/', (req, res) => {
    // Check both root and templates directory
    const fs = require('fs');
    const templatesPath = path.join(__dirname, 'templates', 'index.html');
    const rootPath = path.join(__dirname, 'index.html');
    
    if (fs.existsSync(rootPath)) {
        res.sendFile(rootPath);
    } else if (fs.existsSync(templatesPath)) {
        res.sendFile(templatesPath);
    } else {
        res.status(404).send('index.html not found');
    }
});

// Start server
app.listen(CONFIG.PORT, () => {
    console.log(`Congressional Tracker`);
    console.log(`===================`);
    console.log(`Server running on port ${CONFIG.PORT}`);
    console.log(`Visit http://localhost:${CONFIG.PORT}`);
    console.log('\nAPI Status:');
    console.log(`- Google Civic: ${CONFIG.GOOGLE_CIVIC_API_KEY ? '✓ Configured' : '✗ Not configured (limited accuracy)'}`);
    console.log(`- FEC: ${CONFIG.FEC_API_KEY !== 'DEMO_KEY' ? '✓ Configured' : '⚠ Using DEMO_KEY'}`);
    console.log(`- Congress.gov: ${CONFIG.CONGRESS_API_KEY ? '✓ Configured' : '✗ Not configured'}`);
});
