const express = require('express');
const path = require('path');
const app = express();

// Configuration
const CONFIG = {
    PORT: process.env.PORT || 3000,
    CACHE_DURATION: 60 * 60 * 1000, // 1 hour
    API_TIMEOUT: 10000, // 10 seconds
    FEC_API_KEY: process.env.FEC_API_KEY || 'DEMO_KEY',
    CONGRESS_API_KEY: process.env.CONGRESS_API_KEY || null,
    GOOGLE_CIVIC_API_KEY: process.env.GOOGLE_CIVIC_API_KEY || null
};

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Services
class CongressionalDataService {
    constructor() {
        this.cache = new Map();
        this.legislators = null;
        this.lastLegislatorUpdate = 0;
    }

    // Fetch and cache legislator data
    async getLegislators() {
        const now = Date.now();
        // Refresh legislator data every 24 hours
        if (this.legislators && now - this.lastLegislatorUpdate < 24 * 60 * 60 * 1000) {
            return this.legislators;
        }

        try {
            const response = await fetch('https://theunitedstates.io/congress-legislators/legislators-current.json', {
                signal: AbortSignal.timeout(CONFIG.API_TIMEOUT)
            });
            
            if (!response.ok) throw new Error('Failed to fetch legislators');
            
            this.legislators = await response.json();
            this.lastLegislatorUpdate = now;
            return this.legislators;
        } catch (error) {
            console.error('Error fetching legislators:', error);
            // Return cached data if available
            if (this.legislators) return this.legislators;
            throw error;
        }
    }

    // Find representatives by location
    async findRepresentativesByLocation(state, district = null) {
        const legislators = await this.getLegislators();
        
        return legislators.filter(legislator => {
            const currentTerm = legislator.terms[legislator.terms.length - 1];
            
            // Must match state
            if (currentTerm.state !== state) return false;
            
            // If district specified, return matching House member
            if (district && currentTerm.type === 'rep') {
                return currentTerm.district === parseInt(district);
            }
            
            // Otherwise return all representatives for the state
            return true;
        });
    }

    // Get campaign finance data
    async getCampaignFinance(legislator) {
        const cacheKey = `finance-${legislator.id.bioguide}-${new Date().getFullYear()}`;
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_DURATION) {
            return cached.data;
        }

        try {
            // Clean up name for FEC search
            const searchName = legislator.name.official_full
                .replace(/\s+Jr\.?$|\s+Sr\.?$|\s+III?$/, '')
                .trim();

            // Search for candidate
            const searchUrl = `https://api.open.fec.gov/v1/names/candidates/?q=${encodeURIComponent(searchName)}&api_key=${CONFIG.FEC_API_KEY}`;
            const searchResponse = await fetch(searchUrl, {
                signal: AbortSignal.timeout(CONFIG.API_TIMEOUT)
            });

            if (!searchResponse.ok) {
                throw new Error(`FEC API error: ${searchResponse.status}`);
            }

            const searchData = await searchResponse.json();
            
            if (!searchData.results || searchData.results.length === 0) {
                return this.getEmptyFinanceData();
            }

            // Find the most relevant candidate
            const currentTerm = legislator.terms[legislator.terms.length - 1];
            const officeCode = currentTerm.type === 'sen' ? 'S' : 'H';
            
            const candidate = searchData.results.find(c => 
                c.office_sought === officeCode
            ) || searchData.results[0];

            // Get financial data
            const financeUrl = `https://api.open.fec.gov/v1/candidates/${candidate.id}/totals/?api_key=${CONFIG.FEC_API_KEY}&cycle=2024`;
            const financeResponse = await fetch(financeUrl, {
                signal: AbortSignal.timeout(CONFIG.API_TIMEOUT)
            });

            if (!financeResponse.ok) {
                throw new Error(`FEC API error: ${financeResponse.status}`);
            }

            const financeData = await financeResponse.json();
            
            if (!financeData.results || financeData.results.length === 0) {
                return this.getEmptyFinanceData();
            }

            const finances = financeData.results[0];
            const result = this.formatFinanceData(finances);

            // Cache the result
            this.cache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });

            return result;

        } catch (error) {
            console.error('Error fetching campaign finance:', error);
            return this.getEmptyFinanceData();
        }
    }

    formatFinanceData(finances) {
        const total = finances.receipts || 0;
        const sources = [];

        const addSource = (name, amount) => {
            if (amount > 0) {
                sources.push({
                    name,
                    amount: `$${amount.toLocaleString()}`,
                    percentage: total > 0 ? Math.round((amount / total) * 100) : 0
                });
            }
        };

        addSource('Individual Contributions', finances.individual_contributions);
        addSource('PAC Contributions', finances.other_political_committee_contributions);
        addSource('Party Contributions', finances.party_committee_contributions);
        addSource('Self-Funding', finances.candidate_contribution);

        return {
            totalRaised: `$${total.toLocaleString()}`,
            sources,
            lastReport: finances.coverage_end_date || 'Not available'
        };
    }

    getEmptyFinanceData() {
        return {
            totalRaised: 'Data not available',
            sources: [],
            lastReport: 'Not available'
        };
    }
}

// Location service for ZIP code lookups
class LocationService {
    constructor() {
        this.cache = new Map();
    }

    async getLocationFromZip(zipcode) {
        // Check cache
        const cached = this.cache.get(zipcode);
        if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_DURATION * 24) { // Cache for 24 hours
            return cached.data;
        }

        // Try Google Civic API if available
        if (CONFIG.GOOGLE_CIVIC_API_KEY) {
            try {
                const location = await this.googleCivicLookup(zipcode);
                this.cache.set(zipcode, {
                    data: location,
                    timestamp: Date.now()
                });
                return location;
            } catch (error) {
                console.error('Google Civic API error:', error);
            }
        }

        // Fallback to basic ZIP mapping
        return this.basicZipLookup(zipcode);
    }

    async googleCivicLookup(zipcode) {
        const url = `https://www.googleapis.com/civicinfo/v2/representatives?address=${zipcode}&key=${CONFIG.GOOGLE_CIVIC_API_KEY}`;
        const response = await fetch(url, {
            signal: AbortSignal.timeout(CONFIG.API_TIMEOUT)
        });

        if (!response.ok) {
            throw new Error(`Google Civic API error: ${response.status}`);
        }

        const data = await response.json();
        
        // Parse the response to find congressional district
        // This is simplified - full implementation would parse all offices
        const offices = data.offices || [];
        const congressionalOffice = offices.find(office => 
            office.name.includes('United States House of Representatives')
        );

        if (congressionalOffice && congressionalOffice.divisionId) {
            // Parse division ID like "ocd-division/country:us/state:ca/cd:12"
            const parts = congressionalOffice.divisionId.split('/');
            const statePart = parts.find(p => p.startsWith('state:'));
            const districtPart = parts.find(p => p.startsWith('cd:'));
            
            if (statePart) {
                return {
                    state: statePart.split(':')[1].toUpperCase(),
                    district: districtPart ? parseInt(districtPart.split(':')[1]) : null
                };
            }
        }

        // Fallback
        return this.basicZipLookup(zipcode);
    }

    basicZipLookup(zipcode) {
        // ZIP code ranges by state (simplified - real implementation would use full database)
        const zipRanges = {
            'AL': [[35000, 36999]],
            'AK': [[99500, 99999]],
            'AZ': [[85000, 86999]],
            'AR': [[71600, 72999], [75500, 75599]],
            'CA': [[90000, 96199]],
            'CO': [[80000, 81999]],
            'CT': [[6000, 6999]],
            'DE': [[19700, 19999]],
            'FL': [[32000, 34999]],
            'GA': [[30000, 31999], [39800, 39999]],
            'HI': [[96700, 96899]],
            'ID': [[83200, 83999]],
            'IL': [[60000, 62999]],
            'IN': [[46000, 47999]],
            'IA': [[50000, 52999]],
            'KS': [[66000, 67999]],
            'KY': [[40000, 42999]],
            'LA': [[70000, 71599]],
            'ME': [[3900, 4999]],
            'MD': [[20600, 21999]],
            'MA': [[1000, 2799], [5500, 5599]],
            'MI': [[48000, 49999]],
            'MN': [[55000, 56799]],
            'MS': [[38600, 39999]],
            'MO': [[63000, 65999]],
            'MT': [[59000, 59999]],
            'NE': [[68000, 69999]],
            'NV': [[88900, 89999]],
            'NH': [[3000, 3899]],
            'NJ': [[7000, 8999]],
            'NM': [[87000, 88499]],
            'NY': [[10000, 14999], [6390, 6390]],
            'NC': [[27000, 28999]],
            'ND': [[58000, 58999]],
            'OH': [[43000, 45999]],
            'OK': [[73000, 74999]],
            'OR': [[97000, 97999]],
            'PA': [[15000, 19699]],
            'RI': [[2800, 2999]],
            'SC': [[29000, 29999]],
            'SD': [[57000, 57999]],
            'TN': [[37000, 38599]],
            'TX': [[75000, 79999], [88500, 88599]],
            'UT': [[84000, 84999]],
            'VT': [[5000, 5999]],
            'VA': [[20100, 20199], [22000, 24699]],
            'WA': [[98000, 99499]],
            'WV': [[24700, 26999]],
            'WI': [[53000, 54999]],
            'WY': [[82000, 83199]]
        };

        const zip = parseInt(zipcode);
        
        for (const [state, ranges] of Object.entries(zipRanges)) {
            for (const [min, max] of ranges) {
                if (zip >= min && zip <= max) {
                    return { state, district: null };
                }
            }
        }

        // Default fallback
        return { state: 'CA', district: null };
    }
}

// Initialize services
const congressionalService = new CongressionalDataService();
const locationService = new LocationService();

// API Routes
app.get('/api/congressman/:zipcode', async (req, res) => {
    const zipcode = req.params.zipcode;
    
    // Validate ZIP code
    if (!/^\d{5}$/.test(zipcode)) {
        return res.status(400).json({
            error: 'Invalid ZIP code',
            message: 'Please provide a valid 5-digit ZIP code'
        });
    }

    try {
        // Get location from ZIP
        const location = await locationService.getLocationFromZip(zipcode);
        
        // Find representatives
        const representatives = await congressionalService.findRepresentativesByLocation(
            location.state,
            location.district
        );

        if (representatives.length === 0) {
            return res.status(404).json({
                error: 'No representatives found',
                message: 'Could not find representatives for this ZIP code'
            });
        }

        // For now, return the first representative (House member preferred)
        const houseRep = representatives.find(r => 
            r.terms[r.terms.length - 1].type === 'rep'
        );
        const representative = houseRep || representatives[0];

        // Get campaign finance data
        const fundingData = await congressionalService.getCampaignFinance(representative);

        // Format response
        const currentTerm = representative.terms[representative.terms.length - 1];
        const response = {
            representative: {
                name: representative.name.official_full,
                party: currentTerm.party === 'Democrat' ? 'Democratic' : currentTerm.party,
                state: currentTerm.state,
                district: currentTerm.district || 'At-Large',
                type: currentTerm.type === 'sen' ? 'Senator' : 'Representative',
                office: currentTerm.office || 'Capitol Building, Washington, DC',
                phone: currentTerm.phone || 'Not available',
                website: currentTerm.url || 'Not available',
                bioguideId: representative.id.bioguide
            },
            funding: fundingData,
            votingRecord: await getVotingRecord(representative),
            calendar: await getCalendarEvents(representative),
            transcripts: await getTranscripts(representative)
        };

        res.json(response);

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Unable to fetch representative data. Please try again later.'
        });
    }
});

// Placeholder functions for future features
async function getVotingRecord(representative) {
    // TODO: Implement when Congress.gov API is available
    return [{
        bill: "Voting records coming soon",
        date: new Date().toISOString().split('T')[0],
        vote: "—",
        description: "Voting records will be available once Congress.gov API access is granted"
    }];
}

async function getCalendarEvents(representative) {
    // TODO: Implement calendar scraping
    return [{
        date: "TBD",
        time: "TBD",
        event: "Check representative's website",
        location: representative.terms[representative.terms.length - 1].url || "Official website"
    }];
}

async function getTranscripts(representative) {
    // TODO: Implement GovInfo API integration
    return [{
        title: "Transcripts coming soon",
        date: new Date().toISOString().split('T')[0],
        description: "Congressional transcripts will be available soon",
        downloadUrl: "#"
    }];
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        config: {
            hasFecApiKey: CONFIG.FEC_API_KEY !== 'DEMO_KEY',
            hasCongressApiKey: !!CONFIG.CONGRESS_API_KEY,
            hasGoogleCivicApiKey: !!CONFIG.GOOGLE_CIVIC_API_KEY
        }
    });
});

// Serve HTML - handle both root structure and templates directory
app.get('/', (req, res) => {
    // Try templates directory first
    const templatesPath = path.join(__dirname, 'templates', 'index.html');
    const rootPath = path.join(__dirname, 'index.html');
    
    // Check which file exists
    const fs = require('fs');
    if (fs.existsSync(templatesPath)) {
        res.sendFile(templatesPath);
    } else if (fs.existsSync(rootPath)) {
        res.sendFile(rootPath);
    } else {
        res.status(404).send('index.html not found. Please ensure it exists in either the root directory or templates/ directory.');
    }
});

// Start server
app.listen(CONFIG.PORT, () => {
    console.log(`Congressional Tracker API`);
    console.log(`=====================`);
    console.log(`Server running on port ${CONFIG.PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`API Keys configured:`);
    console.log(`- FEC: ${CONFIG.FEC_API_KEY === 'DEMO_KEY' ? 'Using DEMO_KEY (limited)' : 'Custom key set'}`);
    console.log(`- Congress.gov: ${CONFIG.CONGRESS_API_KEY ? 'Configured' : 'Not set'}`);
    console.log(`- Google Civic: ${CONFIG.GOOGLE_CIVIC_API_KEY ? 'Configured' : 'Not set'}`);
    console.log(`\nVisit http://localhost:${CONFIG.PORT}`);
});
